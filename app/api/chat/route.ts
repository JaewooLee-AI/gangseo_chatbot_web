import { supabase } from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  applyTone,
  checkGuardrailBlock,
  classifyInquiry,
  cosineSimilarity,
  extractContactAndSummary,
  generateChatAnswer,
  generateEmbedding,
  generateInquirySummary,
  isNoAnswerResponse,
  parseEmbedding,
  STRICTNESS_THRESHOLD,
  wantsHuman,
  type BotSettings,
} from "@/lib/rag";

const DEFAULT_SETTINGS: BotSettings = {
  tone: "친절한 상담원",
  block_medical: true,
  block_legal: true,
  block_privacy: true,
  strictness_level: 5,
};

const HANDOVER_HINT = "**[📞 담당자에게 메시지 남기기]** 버튼을 눌러 접수해 주십시오.";

function streamPlainText(text: string) {
  const encoder = new TextEncoder();
  const words = text.split(" ");
  const stream = new ReadableStream({
    async start(controller) {
      for (const word of words) {
        controller.enqueue(encoder.encode(word + " "));
        await new Promise((r) => setTimeout(r, 40));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();
    const prompt: string = messages?.[messages.length - 1]?.content ?? "";

    if (!prompt.trim()) {
      return streamPlainText("문의 내용을 입력해 주세요.");
    }

    // 1. Explicit handover intent — route to counselor_inquiries immediately.
    if (wantsHuman(prompt)) {
      const { name, contact, summary: fallbackSummary } = extractContactAndSummary(prompt);

      if (contact !== "연락처 미기재 (원문 확인 필요)") {
        const category = classifyInquiry(prompt);

        // Fallback if the LLM call is unavailable/fails — same naive slice as before.
        let summary = fallbackSummary;
        const { data: geminiKeyForSummary } = await supabaseAdmin.rpc("get_llm_api_key", {
          p_vendor_id: "gemini",
        });
        if (geminiKeyForSummary) {
          const { data: providerRows } = await supabaseAdmin
            .from("llm_providers")
            .select("model_name")
            .eq("vendor_id", "gemini");
          const geminiModel = providerRows?.[0]?.model_name || "gemini-3.1-flash-lite";
          const aiSummary = await generateInquirySummary(prompt, geminiKeyForSummary, geminiModel);
          if (aiSummary) summary = aiSummary;
        }

        // No .select() chain — anon can INSERT into counselor_inquiries but
        // cannot SELECT it back, so a return=representation read would fail.
        await supabase.from("counselor_inquiries").insert({
          user_name: name,
          contact_info: contact,
          inquiry_summary: summary,
          raw_message: prompt,
          input_type: "text",
          category,
          status: "pending",
        });

        return streamPlainText(
          `📞 **[담당자 접수 완료]**\n입력하신 문장에서 연락처(${contact})가 감지되어 담당자에게 즉시 전달되었습니다.\n- 요약: ${summary}\n\n실무 담당자가 확인 후 빠른 시일 내에 연락드리겠습니다. 추가 문의가 있으시면 편하게 남겨주세요!`
        );
      }

      return streamPlainText(
        "불편을 드려 죄송합니다. 담당자가 확인 후 연락드릴 수 있도록 성함과 연락처(예: 010-XXXX-XXXX)를 함께 남겨주시거나, 상단의 [📞 담당자에게 메시지 남기기] 버튼을 이용해 주세요."
      );
    }

    // 2. Load dynamic bot settings (public read).
    const { data: settingsRows } = await supabase
      .from("bot_settings")
      .select("*")
      .eq("id", 1);
    const settings: BotSettings = (settingsRows?.[0] as BotSettings) ?? DEFAULT_SETTINGS;

    // 3. Compliance guardrail — blocks before any LLM call.
    const blockReason = checkGuardrailBlock(prompt, settings);
    if (blockReason) {
      const response = applyTone(
        `🚨 **[Fallback 발동]** ${blockReason}\n상세한 안내는 보건소나 센터로 직접 문의 부탁드리며, ${HANDOVER_HINT}`,
        settings.tone
      );
      return streamPlainText(response);
    }

    // 4. RAG: needs the Gemini key (Vault, service_role only) and current model name.
    const { data: geminiKey } = await supabaseAdmin.rpc("get_llm_api_key", {
      p_vendor_id: "gemini",
    });

    if (!geminiKey) {
      return streamPlainText(
        applyTone(
          `🚨 현재 AI 상담 엔진 연결에 문제가 있습니다. ${HANDOVER_HINT}`,
          settings.tone
        )
      );
    }

    const userVec = await generateEmbedding(prompt, geminiKey);
    if (!userVec) {
      return streamPlainText(
        applyTone(
          `🚨 현재 AI 상담 엔진 연결에 문제가 있습니다. ${HANDOVER_HINT}`,
          settings.tone
        )
      );
    }

    const { data: docs } = await supabase
      .from("rag_documents")
      .select("content, category, embedding");

    const matches = (docs ?? [])
      .map((doc) => {
        const docVec = parseEmbedding(doc.embedding);
        if (!docVec || docVec.length !== userVec.length) return null;
        return { sim: cosineSimilarity(userVec, docVec), content: doc.content as string, category: doc.category as string };
      })
      .filter((m): m is { sim: number; content: string; category: string } => m !== null)
      .sort((a, b) => b.sim - a.sim);

    const threshold = STRICTNESS_THRESHOLD[settings.strictness_level] ?? 0.7;

    if (matches.length === 0 || matches[0].sim < threshold) {
      return streamPlainText(
        applyTone(
          `🚨 **[상담사 연결 권장]** 현재 엄격도 설정 기준(유사도 ${threshold.toFixed(2)} 이상)을 충족하는 지식베이스 정보를 찾지 못했습니다.\n${HANDOVER_HINT}`,
          settings.tone
        )
      );
    }

    // 임계치를 넘는 상위 문서(최대 5개)를 컨텍스트로 모은다. 행 단위(원자적) 청킹 이후에는
    // 복합 질문 하나에 필요한 사실이 3개를 넘는 경우가 있어 top-3로는 근거가 밀려날 수 있다.
    const topMatches = matches.slice(0, 5).filter((m) => m.sim >= threshold);

    // "1구간", "8구간"처럼 사용자가 특정 값을 콕 집어 물으면, 벡터 유사도만으로는 원하는 구간이
    // top-5 밖으로 밀릴 수 있다(본인부담금표처럼 서로 거의 같은 구조의 행이 많은 경우). 질문에
    // 명시된 구간 번호가 있으면 순위와 무관하게 정확매칭으로 강제 포함한다.
    const exactTerms = Array.from(new Set(prompt.match(/\d+구간/g) ?? []));
    if (exactTerms.length > 0) {
      const already = new Set(topMatches.map((m) => m.content));
      for (const m of matches) {
        if (!already.has(m.content) && exactTerms.some((term) => m.content.includes(term))) {
          topMatches.push(m);
          already.add(m.content);
        }
      }
    }

    const contextChunks = topMatches.map((m) => m.content);
    const sourceCategories = Array.from(new Set(topMatches.map((m) => m.category))).sort().join(", ");
    const topScore = topMatches[0].sim;

    const { data: providerRows } = await supabaseAdmin
      .from("llm_providers")
      .select("model_name")
      .eq("vendor_id", "gemini");
    const geminiModel = providerRows?.[0]?.model_name || "gemini-3.1-flash-lite";

    const llmAnswer = await generateChatAnswer(prompt, contextChunks, settings.tone, geminiKey, geminiModel);

    let response: string;
    if (llmAnswer && isNoAnswerResponse(llmAnswer)) {
      // Passed the similarity threshold but the LLM itself says it can't
      // answer from the retrieved context — flag for human review instead
      // of showing a confident-looking non-answer.
      await supabase.from("fallback_logs").insert({ user_query: prompt, status: "pending" });
      response = `${llmAnswer}\n\n🚨 **[상담사 연결 권장]** 지식베이스에서 확실한 근거를 찾지 못해 관리자 검토 목록에 등록했습니다. 빠른 확인이 필요하시면 ${HANDOVER_HINT}`;
    } else if (llmAnswer) {
      response = `${llmAnswer}\n\n**[출처]:** [${sourceCategories}] (유사도 Score: ${topScore.toFixed(2)} / 기준 ${threshold.toFixed(2)})`;
    } else {
      // Gemini call failed — fall back to the raw top-matched chunk so the
      // user still gets a grounded answer instead of an error.
      const top = topMatches[0];
      response = `${top.content}\n\n**[출처]:** [${top.category}] (유사도 Score: ${top.sim.toFixed(2)} / 기준 ${threshold.toFixed(2)})`;
    }

    return streamPlainText(applyTone(response, settings.tone));
  } catch (error) {
    console.error("Chat route error:", error);
    return new Response(
      JSON.stringify({ error: "내부 서버 오류가 발생했습니다." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

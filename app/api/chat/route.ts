import { supabase } from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  applyTone,
  checkGuardrailBlock,
  classifyInquiry,
  CONTEXT_THRESHOLD,
  cosineSimilarity,
  extractContactAndSummary,
  extractHitlAnswer,
  FAILURE_TYPE_HUMAN_REQUESTED,
  FAILURE_TYPE_LOW_CONFIDENCE,
  FAILURE_TYPE_NO_MATCH,
  generateChatAnswer,
  generateEmbedding,
  generateInquirySummary,
  HITL_CACHE_THRESHOLD,
  isNoAnswerResponse,
  normalizeQuery,
  parseEmbedding,
  PERSONA_CATEGORIES,
  STRICTNESS_THRESHOLD,
  wantsHuman,
  type BotSettings,
  type ChatHistoryMessage,
} from "@/lib/rag";

const DEFAULT_SETTINGS: BotSettings = {
  tone: "친절한 상담원",
  block_medical: true,
  block_legal: true,
  block_privacy: true,
  strictness_level: 5,
};

const HANDOVER_HINT = "**[📞 담당자에게 메시지 남기기]** 버튼을 눌러 접수해 주십시오.";

type MatchRow = { sim: number; content: string; category: string };

// 서버사이드 하이브리드 검색(RPC, admin_match_documents — gangseo_chatbot_admin의
// supabase/005~006 마이그레이션에서 이 프로젝트와 같은 Supabase DB에 생성됨).
// pgvector ivfflat 인덱스를 활용한 벡터 후보군과, pg_trgm 트라이그램 유사도로 찾은
// 키워드 후보군을 함께 받아온다. 후자는 "3구간"처럼 벡터 유사도만으로는 순위가
// 밀리기 쉬운 특정 값/고유명사 질의를 구제하기 위함이다.
// RPC가 아직 배포되지 않았거나 호출이 실패하면, 기존 방식인 "전량 조회 후
// 클라이언트 사이드 코사인 계산"으로 안전하게 대체(fallback)한다.
async function hybridSearch(
  queryText: string,
  queryVec: number[],
  matchCount = 30,
  categories: string[] | null = null
): Promise<{ vectorMatches: MatchRow[]; keywordMatches: MatchRow[] }> {
  const { data, error } = await supabase.rpc("admin_match_documents", {
    query_embedding: queryVec,
    query_text: queryText,
    match_count: matchCount,
    filter_categories: categories,
  });

  if (!error && data) {
    const vectorMatches: MatchRow[] = [];
    const keywordMatches: MatchRow[] = [];
    for (const row of data as Array<Record<string, unknown>>) {
      const m: MatchRow = {
        sim: row.similarity as number,
        content: row.content as string,
        category: row.category as string,
      };
      if (row.match_source === "vector") vectorMatches.push(m);
      else keywordMatches.push(m);
    }
    vectorMatches.sort((a, b) => b.sim - a.sim);
    return { vectorMatches, keywordMatches };
  }

  let fallbackQuery = supabase.from("rag_documents").select("content, category, embedding");
  if (categories && categories.length > 0) {
    fallbackQuery = fallbackQuery.in("category", categories);
  }
  const { data: docs } = await fallbackQuery;

  const vectorMatches = (docs ?? [])
    .map((doc) => {
      const docVec = parseEmbedding(doc.embedding);
      if (!docVec || docVec.length !== queryVec.length) return null;
      return {
        sim: cosineSimilarity(queryVec, docVec),
        content: doc.content as string,
        category: doc.category as string,
      };
    })
    .filter((m): m is MatchRow => m !== null)
    .sort((a, b) => b.sim - a.sim);

  return { vectorMatches, keywordMatches: [] };
}

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
    const { messages, persona } = await req.json();
    const prompt: string = messages?.[messages.length - 1]?.content ?? "";
    const history: ChatHistoryMessage[] = Array.isArray(messages) ? messages.slice(0, -1) : [];
    // 진입 화면에서 선택한 문의 유형. 미선택(또는 알 수 없는 값)이면 전체 검색.
    const personaCategories: string[] | null =
      (typeof persona === "string" && PERSONA_CATEGORIES[persona]) || null;

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

      // 연락처가 없어 counselor_inquiries에는 적재할 수 없지만, 질문 자체가 유실되지
      // 않도록 fallback_logs에라도 남겨 관리자가 검토할 수 있게 한다.
      await supabase.from("fallback_logs").insert({
        user_query: prompt,
        status: "pending",
        failure_type: FAILURE_TYPE_HUMAN_REQUESTED,
      });

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

    // 3. Gemini 키를 먼저 확보한다: 질의 정규화(4단계)가 가드레일 검사보다 먼저
    // 실행되며 이 키가 필요하기 때문이다.
    const { data: geminiKey } = await supabaseAdmin.rpc("get_llm_api_key", {
      p_vendor_id: "gemini",
    });

    // 4. 질의 정규화: 오탈자 교정 + 축약된 단문을 완전한 문장으로 보완하고, 이전 대화를
    // 참고해 "그럼 2구간은요?" 같은 생략형 후속 질문을 독립적인 질문으로 풀어쓴다.
    // 키가 없거나 호출이 실패하면 원문이 그대로 반환되므로 안전하다.
    const normalizedPrompt = geminiKey ? await normalizeQuery(prompt, geminiKey, history) : prompt;

    // 5. Compliance guardrail — 키워드 1차 필터 + LLM 의도 판정(2단계). 오탈자로
    // 키워드 탐지가 회피되지 않도록 원문+보정문을 함께 검사한다.
    const blockReason = await checkGuardrailBlock(`${prompt} ${normalizedPrompt}`, settings, geminiKey);
    if (blockReason) {
      const response = applyTone(
        `🚨 **[Fallback 발동]** ${blockReason}\n상세한 안내는 보건소나 센터로 직접 문의 부탁드리며, ${HANDOVER_HINT}`,
        settings.tone
      );
      return streamPlainText(response);
    }

    if (!geminiKey) {
      return streamPlainText(
        applyTone(
          `🚨 현재 AI 상담 엔진 연결에 문제가 있습니다. ${HANDOVER_HINT}`,
          settings.tone
        )
      );
    }

    const userVec = await generateEmbedding(normalizedPrompt, geminiKey);
    if (!userVec) {
      return streamPlainText(
        applyTone(
          `🚨 현재 AI 상담 엔진 연결에 문제가 있습니다. ${HANDOVER_HINT}`,
          settings.tone
        )
      );
    }

    // 서버사이드 하이브리드 검색(RPC): 벡터 후보군(matches)은 기존과 동일하게 코사인
    // 임계치 게이트에 사용하고, 키워드 후보군(keywordMatches)은 "3구간"처럼 특정
    // 값/고유명사 질의를 순위와 무관하게 구제하는 용도다.
    let { vectorMatches: matches, keywordMatches } = await hybridSearch(
      normalizedPrompt, userVec, 30, personaCategories
    );

    const gateThreshold = STRICTNESS_THRESHOLD[settings.strictness_level] ?? 0.7;

    // 사용자가 진입 유형을 잘못 골랐을 수 있으므로, 필터 검색이 게이트를 통과하지 못하면
    // 전체 검색으로 한 번 더 시도한다(하드 필터 때문에 답을 잃지 않게 하는 안전장치).
    let widened = false;
    if (personaCategories && !(matches.length > 0 && matches[0].sim >= gateThreshold)) {
      const wide = await hybridSearch(normalizedPrompt, userVec, 30, null);
      if (wide.vectorMatches.length > 0 && wide.vectorMatches[0].sim >= gateThreshold) {
        matches = wide.vectorMatches;
        keywordMatches = wide.keywordMatches;
        widened = true;
      }
    }

    // HITL 시맨틱 캐시: 관리자가 이미 검증한 모범 정답과 거의 동일한 질문이면, LLM
    // 재호출 없이 검증 답변을 즉시 반환한다(속도/비용 절감 + 정답 신뢰도 보장).
    const hitlCacheHit = matches.find(
      (m) => m.sim >= HITL_CACHE_THRESHOLD && m.category === "수동학습(HITL)"
    );

    const threshold = gateThreshold;

    if (hitlCacheHit) {
      const cachedAnswer = extractHitlAnswer(hitlCacheHit.content);
      return streamPlainText(
        applyTone(
          `${cachedAnswer}\n\n**[출처]:** 관리자 검증 답변 (HITL 캐시 · 유사도 ${hitlCacheHit.sim.toFixed(2)})`,
          settings.tone
        )
      );
    }

    // 벡터 임계치를 통과했는지 여부와 별개로 진입한다: "3구간"처럼 벡터 유사도만으로는
    // 임계치를 넘는 문서가 하나도 없어도, pg_trgm 키워드 검색이 정확 매칭 문서를
    // 찾아왔다면 그것만으로도 답변을 시도한다.
    const vectorGatePassed = matches.length > 0 && matches[0].sim >= threshold;

    if (!vectorGatePassed && keywordMatches.length === 0) {
      // 임계치 이상 문서도, 키워드 매칭 문서도 하나도 없는, 가장 흔한 지식 공백 케이스.
      await supabase.from("fallback_logs").insert({
        user_query: prompt,
        status: "pending",
        failure_type: FAILURE_TYPE_NO_MATCH,
      });
      return streamPlainText(
        applyTone(
          `🚨 **[상담사 연결 권장]** 현재 엄격도 설정 기준(유사도 ${threshold.toFixed(2)} 이상)을 충족하는 지식베이스 정보를 찾지 못했습니다.\n${HANDOVER_HINT}`,
          settings.tone
        )
      );
    }

    // 컨텍스트에 넣을 문서는 게이트보다 느슨한 기준으로 고른다(단, 게이트보다 엄격해지지
    // 않도록 min으로 묶는다). 행 단위(원자적) 청킹 이후에는 복합 질문 하나에 필요한 사실이
    // 3개를 넘는 경우가 있어 상위 5건까지 모은다.
    const ctxThreshold = Math.min(threshold, CONTEXT_THRESHOLD);
    const topMatches = matches.filter((m) => m.sim >= ctxThreshold).slice(0, 5);

    // "1구간", "8구간"처럼 사용자가 특정 값을 콕 집어 물으면, 벡터 유사도만으로는 원하는
    // 문서가 top-5 밖으로 밀릴 수 있다. hybridSearch()가 pg_trgm 키워드 유사도로 찾아온
    // 보조 후보군을 순위와 무관하게 강제 포함한다.
    if (keywordMatches.length > 0) {
      const already = new Set(topMatches.map((m) => m.content));
      for (const m of keywordMatches) {
        if (!already.has(m.content)) {
          topMatches.push(m);
          already.add(m.content);
        }
      }
    }

    const contextChunks = topMatches.map((m) => m.content);
    const sourceCategories = Array.from(new Set(topMatches.map((m) => m.category))).sort().join(", ");
    // 진입 유형과 다른 분야에서 답을 찾았으면 사용자에게 알린다.
    const scopeNote = widened ? "\n※ 선택하신 분야에 해당 정보가 없어 다른 분야에서 안내드렸습니다." : "";
    const topScore = topMatches[0]?.sim ?? 0;

    const { data: providerRows } = await supabaseAdmin
      .from("llm_providers")
      .select("model_name")
      .eq("vendor_id", "gemini");
    const geminiModel = providerRows?.[0]?.model_name || "gemini-3.1-flash-lite";

    // 정규화된 질의를 사용한다: 원문 그대로 넘기면 LLM이 무엇을 묻는지 다시 헷갈릴 수
    // 있으므로, 이미 맥락이 풀린 독립형 질문으로 답변을 생성해야 자연스럽다.
    const llmAnswer = await generateChatAnswer(normalizedPrompt, contextChunks, settings.tone, geminiKey, geminiModel);

    let response: string;
    if (llmAnswer && isNoAnswerResponse(llmAnswer)) {
      // Passed the similarity threshold but the LLM itself says it can't
      // answer from the retrieved context — flag for human review instead
      // of showing a confident-looking non-answer.
      await supabase.from("fallback_logs").insert({
        user_query: prompt,
        status: "pending",
        failure_type: FAILURE_TYPE_LOW_CONFIDENCE,
      });
      response = `${llmAnswer}\n\n🚨 **[상담사 연결 권장]** 지식베이스에서 확실한 근거를 찾지 못해 관리자 검토 목록에 등록했습니다. 빠른 확인이 필요하시면 ${HANDOVER_HINT}`;
    } else if (llmAnswer) {
      // 키워드 매칭 값은 트라이그램 유사도라 코사인 임계치와 스케일이 달라 나란히
      // 표기하면 오해를 줄 수 있으므로, 벡터 게이트 통과 여부에 따라 출처 표기를 분리한다.
      response = vectorGatePassed
        ? `${llmAnswer}${scopeNote}\n\n**[출처]:** [${sourceCategories}] (유사도 Score: ${topScore.toFixed(2)} / 기준 ${threshold.toFixed(2)})`
        : `${llmAnswer}${scopeNote}\n\n**[출처]:** [${sourceCategories}] (키워드 검색 매칭 · 벡터 유사도 기준 미달)`;
    } else {
      // Gemini call failed — fall back to the raw top-matched chunk so the
      // user still gets a grounded answer instead of an error.
      const top = topMatches[0];
      response = vectorGatePassed
        ? `${top.content}\n\n**[출처]:** [${top.category}] (유사도 Score: ${top.sim.toFixed(2)} / 기준 ${threshold.toFixed(2)})`
        : `${top.content}\n\n**[출처]:** [${top.category}] (키워드 검색 매칭 · 벡터 유사도 기준 미달)`;
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

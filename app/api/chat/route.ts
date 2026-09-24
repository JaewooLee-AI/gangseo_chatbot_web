import { supabase } from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  applyTone,
  buildIntakePrefill,
  checkGuardrailBlock,
  COMMON_CATEGORY,
  CONTEXT_THRESHOLD,
  cosineSimilarity,
  detectAmbiguousService,
  extractContactAndSummary,
  extractHitlAnswer,
  FAILURE_TYPE_HUMAN_REQUESTED,
  gapReason,
  FAILURE_TYPE_LOW_CONFIDENCE,
  FAILURE_TYPE_NO_MATCH,
  generateChatAnswer,
  generateEmbedding,
  getGeminiApiKey,
  HITL_CACHE_THRESHOLD,
  isNoAnswerResponse,
  normalizeQuery,
  parseEmbedding,
  PERSONA_CATEGORIES,
  PERSONA_LABELS,
  STRICTNESS_THRESHOLD,
  stripGapMarker,
  userNamedSingleService,
  wantsHuman,
  type BotSettings,
  type ChatHistoryMessage,
} from "@/lib/rag";
import {
  HANDOVER_HEADER,
  HANDOVER_PREFILL_MESSAGE_HEADER,
  HANDOVER_PREFILL_PHONE_HEADER,
  handoverButtonLabel,
  type HandoverPrefill,
} from "@/lib/handover";

const DEFAULT_SETTINGS: BotSettings = {
  tone: "친절한 상담원",
  block_medical: true,
  block_legal: true,
  block_privacy: true,
  strictness_level: 5,
};

const NO_CONTACT = "연락처 미기재 (원문 확인 필요)";

// 이 문구가 붙는 응답에는 항상 handover 신호도 함께 보내, 말풍선 바로 아래에 같은 이름의
// 버튼이 뜨게 한다("아래"가 가리키는 대상이 실제로 존재해야 한다).
function handoverHint(handedOver: boolean) {
  return `아래 **[${handoverButtonLabel(handedOver)}]** 버튼을 눌러 접수해 주십시오.`;
}

// docType: A_사실(답변할 지식) / B_접수(직원이 받아적을 수집 필드 명세)
// verification: 원본확인 / 고객확인필요(아직 센터 확인을 못 받은 임시 값)
type MatchRow = {
  sim: number;
  content: string;
  category: string;
  docType: string;
  verification: string | null;
};

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
        docType: (row.doc_type as string) ?? "A_사실",
        verification: (row.verification as string) ?? null,
      };
      if (row.match_source === "vector") vectorMatches.push(m);
      else keywordMatches.push(m);
    }
    vectorMatches.sort((a, b) => b.sim - a.sim);
    return { vectorMatches, keywordMatches };
  }

  let fallbackQuery = supabase
    .from("rag_documents")
    .select("content, category, embedding, doc_type, verification");
  if (categories && categories.length > 0) {
    fallbackQuery = fallbackQuery.in("category", categories);
  }
  const { data: docs } = await fallbackQuery;

  const vectorMatches = (docs ?? [])
    .map((doc): MatchRow | null => {
      const docVec = parseEmbedding(doc.embedding);
      if (!docVec || docVec.length !== queryVec.length) return null;
      return {
        sim: cosineSimilarity(queryVec, docVec),
        content: doc.content as string,
        category: doc.category as string,
        docType: (doc.doc_type as string) ?? "A_사실",
        verification: (doc.verification as string) ?? null,
      };
    })
    .filter((m): m is MatchRow => m !== null)
    .sort((a, b) => b.sim - a.sim);

  return { vectorMatches, keywordMatches: [] };
}

// handover를 주면 클라이언트가 이 답변 말풍선 아래에 접수 버튼을 띄우고, 모달을 열 때
// prefill 값을 미리 채운다(lib/handover.ts의 헤더 설명 참고).
function streamPlainText(text: string, handover?: HandoverPrefill) {
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
  const headers: Record<string, string> = { "Content-Type": "text/plain; charset=utf-8" };
  if (handover) {
    headers[HANDOVER_HEADER] = "1";
    if (handover.message) {
      headers[HANDOVER_PREFILL_MESSAGE_HEADER] = encodeURIComponent(handover.message);
    }
    if (handover.phone) {
      headers[HANDOVER_PREFILL_PHONE_HEADER] = encodeURIComponent(handover.phone);
    }
  }
  return new Response(stream, { headers });
}

export async function POST(req: Request) {
  try {
    const { messages, persona, handedOver: handedOverRaw } = await req.json();
    const prompt: string = messages?.[messages.length - 1]?.content ?? "";
    const history: ChatHistoryMessage[] = Array.isArray(messages) ? messages.slice(0, -1) : [];
    // 진입 화면에서 선택한 문의 유형. 미선택(또는 알 수 없는 값)이면 전체 검색.
    const personaCategories: string[] | null =
      (typeof persona === "string" && PERSONA_CATEGORIES[persona]) || null;
    // 이번 대화에서 이미 모달로 접수를 마쳤는지. 접수 뒤에도 대화는 계속되며, 이 값으로
    // 안내 문구를 "새 접수"가 아니라 "추가 내용"으로 바꾼다.
    const handedOver = handedOverRaw === true;
    const HANDOVER_HINT = handoverHint(handedOver);

    if (!prompt.trim()) {
      return streamPlainText("문의 내용을 입력해 주세요.");
    }

    // 1. 담당자 연결 의도 — 접수는 "담당자에게 메시지 남기기" 모달로만 받는다.
    // 예전에는 여기서 연락처가 보이면 바로 counselor_inquiries에 적재했는데, 그 경로는
    // 성함을 받지 않았고 저장 실패를 확인하지 않아 실패해도 "접수 완료"라고 안내했다.
    // 이제는 모달을 띄우고, 사용자가 쓴 문장과 연락처를 모달에 미리 채워 다시 적지 않게 한다.
    if (wantsHuman(prompt)) {
      const { contact } = extractContactAndSummary(prompt);
      const hasContact = contact !== NO_CONTACT;

      // 연락처가 없는 요청은 질문 자체가 유실되지 않도록 fallback_logs에 남긴다.
      // 연락처가 있는 문장은 개인정보가 로그에 쌓이지 않도록 남기지 않는다(모달로 접수됨).
      if (!hasContact) {
        await supabase.from("fallback_logs").insert({
          user_query: prompt,
          status: "pending",
          failure_type: FAILURE_TYPE_HUMAN_REQUESTED,
        });
      }

      const text = handedOver
        ? `이미 이번 대화에서 담당자에게 접수해 주셨습니다. 담당자가 확인 후 남겨주신 번호로 연락드릴 예정입니다.\n추가로 전하실 내용이 있으시면 ${HANDOVER_HINT}`
        : `담당자에게 연결해 드릴게요. 성함과 연락처, 문의 내용을 남겨주시면 담당자가 확인 후 연락드립니다.\n${HANDOVER_HINT}`;
      return streamPlainText(text, {
        message: prompt,
        phone: hasContact ? contact : undefined,
      });
    }

    // 2. Load dynamic bot settings (public read).
    const { data: settingsRows } = await supabase
      .from("bot_settings")
      .select("*")
      .eq("id", 1);
    const settings: BotSettings = (settingsRows?.[0] as BotSettings) ?? DEFAULT_SETTINGS;

    // 3. Gemini 키를 먼저 확보한다: 질의 정규화(4단계)가 가드레일 검사보다 먼저
    // 실행되며 이 키가 필요하기 때문이다.
    const geminiKey = await getGeminiApiKey(supabaseAdmin);

    // 4. 질의 정규화: 오탈자 교정 + 축약된 단문을 완전한 문장으로 보완하고, 이전 대화를
    // 참고해 "그럼 2구간은요?" 같은 생략형 후속 질문을 독립적인 질문으로 풀어쓴다.
    // 키가 없거나 호출이 실패하면 원문이 그대로 반환되므로 안전하다.
    // 선택한 문의 유형을 함께 넘긴다. "자격은?" 같은 단문을 어느 방향으로 풀지가
    // 이 값에 달려 있다(normalizeQuery 주석의 실측 사례 참고).
    const personaLabel =
      typeof persona === "string" ? PERSONA_LABELS[persona] ?? null : null;
    const normalizedPrompt = geminiKey
      ? await normalizeQuery(prompt, geminiKey, history, undefined, personaLabel)
      : prompt;

    // 5. Compliance guardrail — 키워드 1차 필터 + LLM 의도 판정(2단계). 오탈자로
    // 키워드 탐지가 회피되지 않도록 원문+보정문을 함께 검사한다.
    const blockReason = await checkGuardrailBlock(`${prompt} ${normalizedPrompt}`, settings, geminiKey ?? "");
    if (blockReason) {
      const response = applyTone(
        `🚨 **[Fallback 발동]** ${blockReason}\n상세한 안내는 보건소나 센터로 직접 문의 부탁드리며, ${HANDOVER_HINT}`,
        settings.tone
      );
      return streamPlainText(response, {});
    }

    if (!geminiKey) {
      return streamPlainText(
        applyTone(
          `🚨 현재 AI 상담 엔진 연결에 문제가 있습니다. ${HANDOVER_HINT}`,
          settings.tone
        ),
        {}
      );
    }

    const userVec = await generateEmbedding(normalizedPrompt, geminiKey);
    if (!userVec) {
      return streamPlainText(
        applyTone(
          `🚨 현재 AI 상담 엔진 연결에 문제가 있습니다. ${HANDOVER_HINT}`,
          settings.tone
        ),
        {}
      );
    }

    // 서버사이드 하이브리드 검색(RPC): 벡터 후보군(matches)은 기존과 동일하게 코사인
    // 임계치 게이트에 사용하고, 키워드 후보군(keywordMatches)은 "3구간"처럼 특정
    // 값/고유명사 질의를 순위와 무관하게 구제하는 용도다.
    let { vectorMatches: matches, keywordMatches } = await hybridSearch(
      normalizedPrompt, userVec, 30, personaCategories
    );

    const gateThreshold = STRICTNESS_THRESHOLD[settings.strictness_level] ?? 0.7;

    // 페르소나를 선택하지 않은 채 "얼마예요?"처럼 짧고 일반적인 질문을 하면, 활동지원/
    // 가사 두 서비스 문서가 거의 같은 점수로 함께 검색되어 근거가 빈약한 쪽으로 우연히
    // 답이 나갈 수 있다(실측: 동일 질문인데 실행할 때마다 답변/폴백이 오감). 이 경우
    // 추측하지 않고 어떤 서비스인지 먼저 되묻는다. 단, 사용자가 문장에서 분야를 직접 말했으면
    // 묻지 않는다(userNamedSingleService 주석 참고).
    if (
      !personaCategories &&
      !userNamedSingleService(prompt, history) &&
      detectAmbiguousService(matches)
    ) {
      return streamPlainText(
        applyTone(
          "어떤 서비스에 대해 궁금하신가요? \"장애인활동지원\" 또는 \"가사서비스\"라고 말씀해 주시면 더 정확하게 안내해 드릴게요.",
          settings.tone
        )
      );
    }

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
        ),
        {}
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

    // 출처 표기와 유사도 점수는 "실제로 검색되어 뽑힌" 문서만 기준으로 삼는다.
    // 아래에서 항상 덧붙이는 공통 정보까지 출처에 넣으면 모든 답변에 0_공통이
    // 붙어 표기가 무의미해진다.
    const sourceCategories = Array.from(new Set(topMatches.map((m) => m.category))).sort().join(", ");
    const topScore = topMatches[0]?.sim ?? 0;

    // 공통 정보(센터 주소 등)는 유사도로는 top-k 안에 못 들어오지만 "면접 장소",
    // "방문 주소"처럼 이걸 물어보는 질문이 실제로 있다. 분량이 매우 적으므로
    // (현재 1행) 순위와 무관하게 항상 컨텍스트에 넣어 잘려나가지 않게 한다.
    // COMMON_CATEGORY 주석에 실측 순위가 정리되어 있다.
    const { data: commonRows, error: commonErr } = await supabase
      .from("rag_documents")
      .select("content, category, doc_type, verification")
      .eq("category", COMMON_CATEGORY);
    if (commonErr) {
      console.error("공통 정보(0_공통) 조회 실패:", commonErr);
    }
    if (commonRows?.length) {
      const already = new Set(topMatches.map((m) => m.content));
      for (const row of commonRows) {
        const content = row.content as string;
        if (already.has(content)) continue;
        topMatches.push({
          sim: 0,
          content,
          category: row.category as string,
          docType: (row.doc_type as string) ?? "A_사실",
          verification: (row.verification as string) ?? null,
        });
        already.add(content);
      }
    }

    const contextChunks = topMatches.map((m) => m.content);
    // 진입 유형과 다른 분야에서 답을 찾았으면 사용자에게 알린다.
    const scopeNote = widened ? "\n※ 선택하신 분야에 해당 정보가 없어 다른 분야에서 안내드렸습니다." : "";

    const { data: providerRows } = await supabaseAdmin
      .from("llm_providers")
      .select("model_name")
      .eq("vendor_id", "gemini");
    const geminiModel = providerRows?.[0]?.model_name || "gemini-3.1-flash-lite";

    // 정규화된 질의를 사용한다: 원문 그대로 넘기면 LLM이 무엇을 묻는지 다시 헷갈릴 수
    // 있으므로, 이미 맥락이 풀린 독립형 질문으로 답변을 생성해야 자연스럽다.
    // 컨텍스트에 접수 폼 명세(B_접수)나 미검증 내용이 섞였는지 알려, 답변 톤을
    // 각각 "접수 안내" / "확인 필요" 로 조정하게 한다.
    // 접수 폼 명세(B_접수)가 컨텍스트에 있으면 답변이 "버튼으로 남겨 달라"는 안내가 되므로,
    // 그 말풍선 아래에 실제 버튼을 띄운다. 모달에는 가장 상위로 검색된 B_접수 항목의
    // 필요 정보를 양식으로 미리 채운다(topMatches는 벡터 유사도순 → 키워드 후보순).
    const intakeRow = topMatches.find((m) => m.docType === "B_접수");
    const intakeHandover: HandoverPrefill | undefined = intakeRow
      ? { message: buildIntakePrefill(intakeRow.content) }
      : undefined;

    const llmAnswer = await generateChatAnswer(
      normalizedPrompt, contextChunks, settings.tone, geminiKey, geminiModel,
      {
        hasIntake: !!intakeRow,
        hasUnverified: topMatches.some((m) => m.verification === "고객확인필요"),
        handedOver,
        originalQuestion: prompt,
      }
    );

    let response: string;
    let responseHandover: HandoverPrefill | undefined = intakeHandover;
    if (llmAnswer && isNoAnswerResponse(llmAnswer)) {
      // LLM이 적은 "답하지 못한 내용"을 남겨, 근거 부족 판정이 맞았는지 로그로 확인할 수 있게 한다.
      console.info("low_confidence:", { prompt, reason: gapReason(llmAnswer) ?? "(문구 감지)" });
      // Passed the similarity threshold but the LLM itself says it can't
      // answer from the retrieved context — flag for human review instead
      // of showing a confident-looking non-answer.
      await supabase.from("fallback_logs").insert({
        user_query: prompt,
        status: "pending",
        failure_type: FAILURE_TYPE_LOW_CONFIDENCE,
      });
      response = `${stripGapMarker(llmAnswer)}\n\n🚨 **[상담사 연결 권장]** 지식베이스에서 확실한 근거를 찾지 못해 관리자 검토 목록에 등록했습니다. 빠른 확인이 필요하시면 ${HANDOVER_HINT}`;
      responseHandover = intakeHandover ?? {};
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

    return streamPlainText(applyTone(response, settings.tone), responseHandover);
  } catch (error) {
    console.error("Chat route error:", error);
    return new Response(
      JSON.stringify({ error: "내부 서버 오류가 발생했습니다." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

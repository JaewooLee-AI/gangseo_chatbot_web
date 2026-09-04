import "server-only";

// Ported from gangseo_chatbot_admin/core/rag_engine.py and
// modules/06_simulator.py — keep these two files in sync when the admin
// side's guardrail/threshold/prompt logic changes.

export const STRICTNESS_THRESHOLD: Record<number, number> = {
  1: 0.5,
  2: 0.55,
  3: 0.6,
  4: 0.65,
  5: 0.7,
};

const MEDICAL_KEYWORDS = ["치매", "진단", "질병", "증상", "질환", "복용", "약물", "처방"];
const LEGAL_KEYWORDS = ["소송", "고소", "위자료", "손해배상", "법적", "계약서", "노무", "해고"];
const PRIVACY_KEYWORDS = ["주민등록번호", "주민번호", "계좌번호", "카드번호", "비밀번호"];

const NO_ANSWER_PHRASES = [
  "명시되어 있지 않",
  "정확한 답변을 드리기 어렵",
  "확인이 어렵",
  "알 수 없습니다",
  "안내해 드리기 어렵",
  "찾을 수 없습니다",
  "참고 자료에는",
  "제공된 자료에는",
  "자료에 포함되어 있지 않",
];

const INQUIRY_CATEGORY_KEYWORDS: Record<string, string[]> = {
  요금문의: ["요금", "정산", "비용", "금액", "결제"],
  서비스신청: ["신청", "지원 받고", "이용하고 싶", "예약"],
  자격상담: ["자격", "대상", "등급", "수급자", "차상위"],
  불만접수: ["불만", "항의", "화가", "실망", "잘못"],
};

const COMPLAINT_TRIGGER_KEYWORDS = ["불만", "항의", "접수할게요", "접수해주세요", "민원"];

// "담당자"/"상담원" 단어가 문장에 포함되기만 해도 담당자 이관으로 빠지면, "상담원에게 뭘
// 알려줘야 하나요?" 같은 정보성 질문까지 RAG를 건너뛰게 되므로, 실제 연결 요청 표현으로 좁힌다.
const HUMAN_HANDOFF_PHRASES = [
  "담당자 연결", "담당자에게 연결", "담당자와 연결", "담당자 전화", "담당자에게 전화",
  "담당자 부탁", "담당자 콜백",
  "상담원 연결", "상담원에게 연결", "상담원과 연결", "상담원 전화", "상담원에게 전화",
  "상담원 부탁", "상담원 콜백",
  "전화해", "콜백",
];

const TONE_INSTRUCTIONS: Record<string, string> = {
  "친절한 상담원": "친절하고 공손한 상담원 말투로 답변하세요.",
  "사무적인 행정관": "간결하고 사무적인 행정 공문 톤으로 답변하세요.",
  "어르신 맞춤형 (쉽고 느린 톤)": "어르신이 이해하기 쉽도록 짧고 쉬운 문장으로, 천천히 설명하듯 존댓말로 답변하세요.",
};

export interface BotSettings {
  tone: string;
  block_medical: boolean;
  block_legal: boolean;
  block_privacy: boolean;
  strictness_level: number;
}

export interface ChatHistoryMessage {
  role: string;
  content: string;
}

// HITL(관리자 검증 모범 정답)로 등록된 지식은 이미 사람이 확인한 고신뢰 답변이므로,
// 일반 strictness 임계치보다 훨씬 높은 값으로 "거의 동일 질문"만 즉시 캐시 반환한다.
export const HITL_CACHE_THRESHOLD = 0.85;

// 컨텍스트 포함 임계치. "답변을 할지 말지"를 정하는 게이트(STRICTNESS_THRESHOLD)와
// "어떤 문서를 LLM에게 근거로 줄지"를 정하는 기준은 목적이 다르다. 둘 다 게이트 값으로
// 처리하면 게이트를 겨우 통과한 질문에서 정작 필요한 문서가 컨텍스트에서 빠진다.
// (실측: '활동지원사로 일하고 싶어요'에서 정답인 '입사 필요 서류'(0.644)가 0.70 컷에
//  걸려 제외되고 주소/문의처 문서만 LLM에 전달되어 오답이 나갔다.)
export const CONTEXT_THRESHOLD = 0.55;

// 페르소나 정의는 클라이언트 진입 화면과 공유해야 하므로 lib/personas.ts에 둔다
// (이 파일은 "server-only"라 클라이언트에서 import할 수 없다).
export { PERSONA_CATEGORIES, PERSONA_LABELS } from "./personas";

// fallback_logs.failure_type 값: 오답 리뷰(admin 대시보드 Module 02)에서 실패 원인별
// 분포를 보고 어떤 개선이 가장 시급한지 데이터 기반으로 판단할 수 있게 태깅한다.
export const FAILURE_TYPE_NO_MATCH = "no_match";
export const FAILURE_TYPE_LOW_CONFIDENCE = "low_confidence";
export const FAILURE_TYPE_HUMAN_REQUESTED = "human_requested";

const GUARDRAIL_TOPIC_DESCRIPTIONS: Record<string, string> = {
  medical: "의료/질병 진단이나 치료·투약에 대한 의학적 조언",
  legal: "법률적 판단이나 소송·노무 분쟁에 대한 법률 상담",
  privacy: "주민등록번호·계좌번호 등 민감한 개인정보의 수집이나 취급",
};

// 가드레일 키워드가 탐지된 질문에 대해, 실제로 차단 대상 '의도'인지를 LLM이 판정한다.
// 단순 키워드 포함 검사만으로는 "치매 어르신도 서비스 이용할 수 있나요?"(정상적인 서비스
// 자격 문의)와 "치매 약은 뭘 먹어야 하나요?"(의학적 조언 요청)를 구분할 수 없어, 돌봄센터의
// 핵심 고객 문의가 대량으로 오차단된다(실측: 정상 질문 6건 중 5건 오차단).
// 판정 실패 시에는 컴플라이언스 기능의 성격상 보수적으로 true(차단)를 반환한다.
export async function checkGuardrailIntent(
  userQuery: string,
  topic: string,
  apiKey: string,
  modelName = "gemini-3.1-flash-lite"
): Promise<boolean> {
  if (!apiKey) return true;

  const topicDesc = GUARDRAIL_TOPIC_DESCRIPTIONS[topic] ?? topic;

  const prompt = `당신은 강서나눔돌봄센터(장애인활동지원·가사서비스 제공 기관) AI 상담 챗봇의
컴플라이언스 판정기입니다. 아래 사용자 질문이 "${topicDesc}"을(를) 실제로 요구하는지 판정하세요.

판정 기준:
- 사용자가 전문가의 판단(진단/처방/법적 판단 등)을 챗봇에게 요구하면 BLOCK 입니다.
- 서비스 이용 자격, 신청 절차, 필요 서류, 요금, 채용/근무 조건에 대한 문의는
  질문에 질병명·법률 용어가 등장하더라도 정상 문의이므로 ALLOW 입니다.
  (예: "치매 어르신도 서비스 받을 수 있나요?" -> 서비스 자격 문의이므로 ALLOW)
  (예: "치매에 좋은 약 알려주세요" -> 의학적 조언 요구이므로 BLOCK)
  (예: "근로계약서는 언제 작성하나요?" -> 채용 절차 문의이므로 ALLOW)
  (예: "부당해고로 소송하려면 어떻게 하나요?" -> 법률 상담 요구이므로 BLOCK)

다른 설명 없이 BLOCK 또는 ALLOW 중 한 단어만 출력하세요.

[사용자 질문]
${userQuery}`;

  const verdict = await callGeminiGenerateContent(prompt, apiKey, modelName);
  if (verdict) {
    const upper = verdict.trim().toUpperCase();
    if (upper.includes("ALLOW")) return false;
    if (upper.includes("BLOCK")) return true;
  }
  return true;
}

// 2단계 판정: (1) 키워드 사전으로 후보를 싸게 걸러내고, (2) 걸린 질문만 LLM이 의도를 판정한다.
// 대부분의 질문은 1단계에서 통과하므로 추가 LLM 호출이 발생하지 않는다.
export async function checkGuardrailBlock(
  prompt: string,
  settings: BotSettings,
  apiKey: string,
  modelName = "gemini-3.1-flash-lite"
): Promise<string | null> {
  const checks: Array<[boolean, string[], string, string]> = [
    [settings.block_medical, MEDICAL_KEYWORDS, "medical",
      "🏥 의료/질병 진단 관련 문의는 컴플라이언스 가드레일에 의해 차단되었습니다."],
    [settings.block_legal, LEGAL_KEYWORDS, "legal",
      "⚖️ 법률/노무 상담 관련 문의는 컴플라이언스 가드레일에 의해 차단되었습니다."],
    [settings.block_privacy, PRIVACY_KEYWORDS, "privacy",
      "🔒 개인정보 수집이 필요한 문의는 컴플라이언스 가드레일에 의해 차단되었습니다."],
  ];

  for (const [enabled, keywords, topic, reason] of checks) {
    if (enabled && keywords.some((k) => prompt.includes(k))) {
      if (await checkGuardrailIntent(prompt, topic, apiKey, modelName)) {
        return reason;
      }
    }
  }
  return null;
}

export function isNoAnswerResponse(answer: string): boolean {
  return NO_ANSWER_PHRASES.some((p) => answer.includes(p));
}

export function classifyInquiry(message: string): string {
  for (const [category, keywords] of Object.entries(INQUIRY_CATEGORY_KEYWORDS)) {
    if (keywords.some((k) => message.includes(k))) return category;
  }
  return "일반문의";
}

export function wantsHuman(prompt: string): boolean {
  return (
    HUMAN_HANDOFF_PHRASES.some((k) => prompt.includes(k)) ||
    COMPLAINT_TRIGGER_KEYWORDS.some((k) => prompt.includes(k))
  );
}

export function applyTone(text: string, tone: string): string {
  if (tone === "어르신 맞춤형 (쉽고 느린 톤)") {
    return `${text}\n\n*(쉽고 느린 톤으로 다시 한번 천천히 안내드립니다. 이해가 어려우시면 센터로 편하게 전화 주세요.)*`;
  }
  if (tone === "사무적인 행정관") {
    return `${text}\n\n(담당 부서 확인 후 정확한 행정 절차에 따라 재안내될 수 있습니다.)`;
  }
  return text;
}

const PHONE_PATTERN = /(01[016789]-?\d{3,4}-?\d{4}|02-?\d{3,4}-?\d{4}|0[3-6][1-5]-?\d{3,4}-?\d{4})/;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

export function extractContactAndSummary(message: string) {
  const phoneMatch = message.match(PHONE_PATTERN);
  let contact = phoneMatch ? phoneMatch[0] : "연락처 미기재 (원문 확인 필요)";

  if (contact === "연락처 미기재 (원문 확인 필요)") {
    const emailMatch = message.match(EMAIL_PATTERN);
    if (emailMatch) contact = emailMatch[0];
  }

  let name = "미상 어르신/신청자";
  if (message.includes("어머니") || message.includes("어르신")) {
    name = "보호자 (어르신 관련 문의)";
  } else if (message.includes("홍길동")) {
    name = "홍길동";
  }

  const cleanText = contact !== "연락처 미기재 (원문 확인 필요)" ? message.split(contact).join("").trim() : message.trim();
  let summary = cleanText.length > 60 ? `${cleanText.slice(0, 60)}...` : cleanText;
  if (!summary) summary = "담당자 직접 콜백 및 상담 요청";

  return { name, contact, summary };
}

// pgvector columns come back from PostgREST as the string "[0.1,0.2,...]",
// not a JS array — always parse before doing any math on them.
export function parseEmbedding(value: unknown): number[] | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/^\[|\]$/g, "");
    if (!trimmed) return [];
    return trimmed.split(",").map((x) => parseFloat(x));
  }
  if (Array.isArray(value)) return value as number[];
  return null;
}

export function cosineSimilarity(vec1: number[], vec2: number[]): number {
  if (!vec1 || !vec2 || vec1.length !== vec2.length || vec1.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vec1.length; i++) {
    dot += vec1[i] * vec2[i];
    normA += vec1[i] * vec1[i];
    normB += vec2[i] * vec2[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function generateEmbedding(
  text: string,
  apiKey: string,
  dimension = 1536
): Promise<number[] | null> {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
    {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        output_dimensionality: dimension,
      }),
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const emb = data.embedding ?? data.embeddings?.[0];
  return emb?.values ?? emb?.value ?? null;
}

async function callGeminiGenerateContent(
  prompt: string,
  apiKey: string,
  modelName: string
): Promise<string | null> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return text ? text.trim() : null;
}

// 검색 직전에 사용자 질의를 정규화한다: 오탈자를 교정하고, 지나치게 축약된 단문
// ("요금은?" 등)은 검색에 유리하도록 완전한 문장으로 보완한다. history가 주어지면
// "그럼 2구간은요?"처럼 이전 대화에 의존하는 생략/지시 표현도 이전 맥락을 반영해
// 독립적으로 검색 가능한 완전한 질문으로 풀어쓴다.
// 키가 없거나 호출이 실패하면 원문을 그대로 반환하여 검색 파이프라인이 항상
// 안전하게 동작하도록 한다.
export async function normalizeQuery(
  userQuery: string,
  apiKey: string,
  history: ChatHistoryMessage[] = [],
  modelName = "gemini-3.1-flash-lite"
): Promise<string> {
  if (!apiKey) return userQuery;

  // 최근 3턴(사용자+챗봇 최대 6개 메시지)만 참고한다.
  const lines: string[] = [];
  for (const m of history.slice(-6)) {
    const content = (m.content ?? "").trim();
    if (!content) continue;
    const roleLabel = m.role === "user" ? "사용자" : "챗봇";
    lines.push(`${roleLabel}: ${content}`);
  }
  const historyText = lines.length > 0 ? lines.join("\n") : "(이전 대화 없음)";

  const prompt = `다음은 강서나눔돌봄센터 AI 챗봇에 입력된 사용자 질문입니다.
검색 정확도를 높이기 위해 아래 규칙에 따라 질문을 다듬어 주세요.

규칙:
1. 오탈자나 띄어쓰기 오류를 자연스럽게 교정하세요.
2. 지나치게 축약된 단문(예: "요금은?", "자격은요?")은 문맥상 자연스러운 완전한 문장으로 보완하세요.
3. "그럼 2구간은요?", "거기는 얼마예요?"처럼 이전 대화를 참고해야 뜻이 통하는 생략/지시
   표현이 있다면, [이전 대화]를 참고하여 무엇을 가리키는지 명확히 풀어써서 그 자체로
   독립적으로 이해 가능한 질문으로 만드세요. 이전 대화가 없거나 현재 질문과 무관하면
   이 규칙은 무시하세요.
4. 질문의 의도나 의미를 절대 바꾸지 마세요. 새로운 정보를 추가하지 마세요.
5. 다른 설명 없이, 교정된 질문 문장 하나만 출력하세요.

[이전 대화]
${historyText}

[현재 사용자 질문]
${userQuery}`;

  const normalized = await callGeminiGenerateContent(prompt, apiKey, modelName);
  if (normalized) {
    const trimmed = normalized.trim().replace(/^["']|["']$/g, "");
    if (trimmed) return trimmed;
  }
  return userQuery;
}

// HITL 모범 정답 청크("질문: ...\n답변: ...")에서 답변 부분만 추출한다.
// 시맨틱 캐시 히트 시, 질문 원문을 다시 노출하지 않고 답변만 보여주기 위함이다.
export function extractHitlAnswer(content: string): string {
  const match = content.match(/답변:\s*([\s\S]+)/);
  return match ? match[1].trim() : content;
}

// hasIntake=true면 컨텍스트에 B_접수(수집 필드 명세) 자료가 섞여 있다는 뜻이다.
// 이는 질문의 답이 아니라 접수 시 받아야 할 항목이므로, 사실처럼 나열하지 말고
// "접수를 도와드리겠다"는 안내로 전환하도록 지시한다.
// hasUnverified=true면 아직 센터 확인을 받지 못한 임시 값이 포함된 것이므로 단정을 피한다.
export async function generateChatAnswer(
  userQuery: string,
  contextChunks: string[],
  tone: string,
  apiKey: string,
  modelName: string,
  opts: { hasIntake?: boolean; hasUnverified?: boolean } = {}
): Promise<string | null> {
  const toneInstruction = TONE_INSTRUCTIONS[tone] ?? TONE_INSTRUCTIONS["친절한 상담원"];
  const contextText = contextChunks.join("\n---\n");

  let extraRules = "";
  if (opts.hasIntake) {
    extraRules +=
      '\n[참고 자료] 중 "접수 시 필요정보:"로 시작하는 항목은 사용자 질문에 대한 답이 아니라,\n' +
      "센터가 접수를 처리하기 위해 사용자에게 받아야 할 항목입니다. 이런 항목은 사실처럼\n" +
      "설명하지 말고, 접수를 도와드리겠다고 안내한 뒤 어떤 정보를 남겨주시면 되는지\n" +
      "자연스럽게 요청하는 문장으로 바꿔 쓰세요.\n";
  }
  if (opts.hasUnverified) {
    extraRules +=
      "\n[참고 자료] 중 일부는 아직 센터의 최종 확인을 받지 못한 임시 내용입니다.\n" +
      "단정적으로 답하지 말고, 정확한 내용은 센터에 확인이 필요하다는 점을 함께 안내하세요.\n";
  }

  const prompt = `당신은 강서나눔돌봄센터의 AI 상담 챗봇입니다. ${toneInstruction}
아래 [참고 자료]에 있는 내용만 근거로 사용자 질문에 답변하세요.
참고 자료에 없는 내용은 추측하지 말고 모른다고 답하세요.
원문을 그대로 나열하지 말고, 사람이 읽기 편한 자연스러운 문장으로 정리해서 답변하세요.
${extraRules}
[참고 자료]
${contextText}

[사용자 질문]
${userQuery}`;

  return callGeminiGenerateContent(prompt, apiKey, modelName);
}

// Voice(STT) transcripts tend to be long and rambling (filler words, no
// punctuation), so a naive character-slice summary often cuts off before
// the actual request. Ask the LLM for the gist instead of truncating.
export async function generateInquirySummary(
  message: string,
  apiKey: string,
  modelName: string
): Promise<string | null> {
  const prompt = `다음은 어르신 돌봄센터에 접수된 상담 문의(텍스트 또는 음성 인식 결과)입니다.
군더더기나 인사말은 제외하고, 담당자가 콜백 전에 파악해야 할 핵심 요청 사항만 한 문장으로 간결하게 요약하세요.

[문의 내용]
${message}`;

  const summary = await callGeminiGenerateContent(prompt, apiKey, modelName);
  return summary ? summary.replace(/\n+/g, " ").trim() : null;
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handoverButtonLabel } from "./handover";

// Ported from gangseo_chatbot_admin/core/rag_engine.py and
// modules/06_simulator.py — keep these two files in sync when the admin
// side's guardrail/threshold/prompt logic changes.

// Cloudflare Workers execute at whichever edge PoP is closest to the end
// user, which varies per request. Google's Gemini API blocks some
// geographies ("User location is not supported for the API use"), so calls
// made directly from a Worker fail intermittently depending on which PoP
// handled that particular request (실측: 같은 질문이 성공/실패를 반복,
// wrangler tail로 "FAILED_PRECONDITION" 확인, 2026-09-23). Routing through
// this small Cloud Run relay (always the same region, Google-to-Google
// traffic) avoids the restriction entirely — verified via 15/15 and 10/10
// stress tests against the embedContent/generateContent endpoints.
//
// The relay renames the API key header because Cloud Run's front-end proxy
// strips inbound "x-goog-*" headers (reserved for Google infra use).
const GEMINI_UPSTREAM_BASE =
  process.env.GEMINI_RELAY_URL ||
  "https://gemini-relay-645651316015.asia-northeast3.run.app";

function geminiFetch(path: string, apiKey: string, body: unknown) {
  return fetch(`${GEMINI_UPSTREAM_BASE}${path}`, {
    method: "POST",
    headers: { "x-relay-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// get_llm_api_key RPC(Supabase Vault 조회) 호출 실패를 조용히 삼키지 않고
// 로그로 남기며, 일시적 네트워크 문제에 대비해 한 번 재시도한다.
export async function getGeminiApiKey(
  supabaseAdmin: SupabaseClient
): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabaseAdmin.rpc("get_llm_api_key", {
      p_vendor_id: "gemini",
    });
    if (error) {
      console.error(`get_llm_api_key RPC error (attempt ${attempt + 1}/2):`, error);
    } else if (data) {
      return data as string;
    }
    if (attempt === 0) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return null;
}

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

// LLM이 "사용자가 물은 것 중 참고 자료로 답하지 못한 것이 있다"고 스스로 판단했을 때 답변 끝에
// 붙이도록 지시하는 마커 "[REF_GAP: 답하지 못한 내용]"(admin core/rag_engine.py와 동일).
// 문구 매칭만으로는 표현이 조금만 달라도 놓친다(실측: "주차장 있어요?"에 "참고 자료에 나와
// 있지 않아…"라고 정직하게 답했는데 목록에 "나와 있지 않"이 없어 정상 답변으로 처리됐고,
// 접수 버튼도 HITL 기록도 남지 않았다 — 2026-09-24). 마커가 1순위, 문구는 보조 수단이다.

const NO_ANSWER_PHRASES = [
  "가지고 있지 않",
  "안내해 드리지 못",
  "정보가 없",
  "나와 있지 않",
  "기재되어 있지 않",
  "포함되어 있지 않",
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

// 센터 주소·대표 연락처처럼 특정 서비스 분야에 속하지 않는 공통 정보가 담긴 카테고리.
// 모든 페르소나에 포함되지만, 질문과 겹치는 단어가 적어 유사도 경쟁에서 구조적으로
// 밀린다(실측: "활동지원사 면접 언제 어디로 찾아가면 되나요?"에서 주소 청크가
// 페르소나 적용 시 9위, 전체 검색에서는 후보 30건 밖 — 2026-09-23).
// 정작 "면접 장소"·"방문 주소" 같은 질문의 답이 여기 있어서, top-k 컷에 잘리면
// 답변에서 장소만 통째로 빠진다.
export const COMMON_CATEGORY = "0_공통";

// 카테고리(v4 엑셀 시트명)를 상위 서비스 그룹으로 매핑한다. "0_공통"은 어느 서비스에도
// 속하지 않는 공통 지식(센터 주소 등)이라 판단 재료에서 제외한다.
export function inferServiceGroup(category: string): "활동지원" | "가사" | null {
  if (category.includes("활동지원")) return "활동지원";
  if (category.includes("가사")) return "가사";
  return null;
}

// 페르소나(문의 유형)를 선택하지 않은 채 "얼마예요?", "신청하고 싶어요"처럼 짧고
// 일반적인 질문을 하면, 활동지원/가사 두 서비스의 문서가 거의 같은 유사도로 함께
// 검색되어 실제로는 근거가 빈약한 쪽으로 우연히 답이 나갈 수 있다(실측: "얼마예요"가
// 동일 질문인데도 실행할 때마다 답변/폴백을 오갔다 — 두 서비스 최고점이 0.01~0.02
// 차이라 임베딩의 미세한 흔들림에 결과가 좌우됨). 이 경우 추측해서 답하는 대신
// 어떤 서비스인지 먼저 물어보는 것이 더 안전하다.
export function detectAmbiguousService(
  matches: Array<{ sim: number; category: string }>,
  topN = 5,
  minPlausible = CONTEXT_THRESHOLD,
  maxGap = 0.05
): boolean {
  const bestByGroup: Record<string, number> = {};
  for (const m of matches.slice(0, topN)) {
    const group = inferServiceGroup(m.category);
    if (!group) continue;
    if (!(group in bestByGroup) || m.sim > bestByGroup[group]) {
      bestByGroup[group] = m.sim;
    }
  }
  const scores = Object.values(bestByGroup).sort((a, b) => b - a);
  if (scores.length < 2) return false;
  return scores[0] >= minPlausible && scores[0] - scores[1] <= maxGap;
}

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

// 마커는 "[REF_GAP: 답하지 못한 내용]" 형식이다. 무엇을 못 답했는지 적지 못한 마커(빈 마커)는
// 근거 부족으로 보지 않는다: 막연히 붙인 마커가 실행마다 2~4건씩 정답에 붙어 "상담사 연결
// 권장"이 나갔다(실측: "어디로 가요?", "차상위는?" 등 정답인데 마커 — 2026-09-24).
const GAP_MARKER_PATTERN = /\[REF_GAP(?::\s*([^\]]*))?\]/g;

export function gapReason(answer: string): string | null {
  for (const m of answer.matchAll(GAP_MARKER_PATTERN)) {
    const reason = (m[1] ?? "").trim();
    if (reason) return reason;
  }
  return null;
}

export function isNoAnswerResponse(answer: string): boolean {
  return gapReason(answer) !== null || NO_ANSWER_PHRASES.some((p) => answer.includes(p));
}

// 사용자에게 보여주기 전에 내부 신호용 마커를 지운다.
export function stripGapMarker(answer: string): string {
  return answer.replace(GAP_MARKER_PATTERN, "").trim();
}

// 사용자가 직접 쓴 문장에서 서비스 분야를 찾는다. 정규화된 질의는 쓰지 않는다: 정규화가
// 사용자가 말하지 않은 서비스명을 추측해 넣는 경우가 있어("교육기관 알려주세요" →
// "활동지원사 교육기관을 알려주세요."), 그 추측을 믿으면 되묻기의 목적(근거가 빈약한 쪽으로
// 우연히 답하는 것 방지)이 무너진다.
const SERVICE_MENTION_KEYWORDS: Record<"활동지원" | "가사", string[]> = {
  활동지원: ["활동지원", "활동 지원", "활동보조", "활보", "장애인활동"],
  가사: ["가사", "청소", "정리수납"],
};

export function mentionedServices(text: string): Set<"활동지원" | "가사"> {
  const found = new Set<"활동지원" | "가사">();
  for (const [group, keywords] of Object.entries(SERVICE_MENTION_KEYWORDS)) {
    if (keywords.some((k) => text.includes(k))) found.add(group as "활동지원" | "가사");
  }
  return found;
}

// 이번 질문(없으면 가장 최근의 이전 질문들)에 서비스가 하나만 언급됐는지. 그렇다면
// "어떤 서비스인가요?"라고 되묻지 않는다(실측: "활동지원사 교육긔관 어디에요"처럼 분야를
// 직접 말했는데도 되물었다 — 2026-09-24). 이번 질문에 두 분야가 다 나오면 되묻기 판단을 그대로 둔다.
export function userNamedSingleService(prompt: string, history: ChatHistoryMessage[]): boolean {
  const now = mentionedServices(prompt);
  if (now.size > 0) return now.size === 1;
  const priorUserTurns = history.filter((m) => m.role === "user").slice(-3).reverse();
  for (const m of priorUserTurns) {
    const s = mentionedServices(m.content ?? "");
    if (s.size > 0) return s.size === 1;
  }
  return false;
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

// 구분자로 하이픈뿐 아니라 공백도 허용한다: 음성 입력(STT) 결과는 "010 1234 5678"처럼
// 띄어 쓴 번호로 들어오는 경우가 많다.
const PHONE_PATTERN = /(01[016789][-\s]?\d{3,4}[-\s]?\d{4}|02[-\s]?\d{3,4}[-\s]?\d{4}|0[3-6][1-5][-\s]?\d{3,4}[-\s]?\d{4})/;
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
  try {
    const res = await geminiFetch(
      "/v1beta/models/gemini-embedding-001:embedContent",
      apiKey,
      { content: { parts: [{ text }] }, output_dimensionality: dimension }
    );
    if (!res.ok) {
      console.error("generateEmbedding failed:", res.status, res.statusText, await res.text());
      return null;
    }
    const data = await res.json();
    const emb = data.embedding ?? data.embeddings?.[0];
    return emb?.values ?? emb?.value ?? null;
  } catch (err) {
    console.error("generateEmbedding threw:", err);
    return null;
  }
}

async function callGeminiGenerateContent(
  prompt: string,
  apiKey: string,
  modelName: string,
  temperature?: number
): Promise<string | null> {
  const body: Record<string, unknown> = { contents: [{ parts: [{ text: prompt }] }] };
  if (temperature !== undefined) {
    body.generationConfig = { temperature };
  }
  let res: Response;
  try {
    res = await geminiFetch(`/v1beta/models/${modelName}:generateContent`, apiKey, body);
  } catch (err) {
    console.error("callGeminiGenerateContent threw:", err);
    return null;
  }
  if (!res.ok) {
    console.error("callGeminiGenerateContent failed:", res.status, res.statusText, await res.text());
    return null;
  }
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
// personaLabel(진입 화면에서 고른 문의 유형)은 축약된 단문을 어느 방향으로 풀지
// 결정하는 근거로 쓴다. 이게 없으면 정규화가 사용자 의도와 정반대로 확장될 수 있다
// (실측: "활동지원사로 일하고 싶어요"를 고른 사용자의 "자격은?"이 "센터 이용 자격은
// 어떻게 되나요?"로 풀려, 정답인 '지원 자격 요건'이 0.624에 그쳐 게이트 0.70 미달 →
// 유형을 넘기니 0.825로 통과, 2026-09-23). 유형은 사용자가 UI로 직접 알려준 정보이므로
// 규칙 4의 "없는 정보 지어내기"에 해당하지 않는다.
export async function normalizeQuery(
  userQuery: string,
  apiKey: string,
  history: ChatHistoryMessage[] = [],
  modelName = "gemini-3.1-flash-lite",
  personaLabel?: string | null
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
  const personaText = personaLabel || "(선택 안 함)";

  const prompt = `다음은 강서나눔돌봄센터 AI 챗봇에 입력된 사용자 질문입니다.
검색 정확도를 높이기 위해 아래 규칙에 따라 질문을 다듬어 주세요.

규칙:
1. 오탈자나 띄어쓰기 오류를 자연스럽게 교정하세요.
2. 지나치게 축약된 단문(예: "요금은?", "자격은요?")은 문맥상 자연스러운 완전한 문장으로
   보완하세요. 이때 [사용자가 선택한 문의 유형]을 최우선 근거로 삼으세요. 예를 들어 유형이
   "활동지원사로 일하고 싶어요"인 사용자가 "자격은?"이라고 물었다면 이는 서비스 이용 자격이
   아니라 "활동지원사 지원(입사) 자격 요건"을 묻는 것입니다. 유형이 "(선택 안 함)"이면
   이 규칙은 무시하세요.
3. "그럼 2구간은요?", "거기는 얼마예요?"처럼 이전 대화를 참고해야 뜻이 통하는 생략/지시
   표현이 있다면, [이전 대화]를 참고하여 무엇을 가리키는지 명확히 풀어써서 그 자체로
   독립적으로 이해 가능한 질문으로 만드세요. 이전 대화가 없거나 현재 질문과 무관하면
   이 규칙은 무시하세요.
4. 질문의 의도나 의미를 절대 바꾸지 마세요. 특히 원문에 없는 제도명·기관명을 새로
   지어내 끼워넣지 마세요(예: "본인부담금 3구간은 얼마예요?"를 "장기요양급여 본인부담금
   3구간은 얼마예요?"로 바꾸면 안 됩니다 — 원문에 없던 "장기요양급여"라는 제도명을
   임의로 추가한 것입니다). 대화에서 이미 언급된 서비스명과 [사용자가 선택한 문의 유형]은
   사용자가 직접 알려준 정보이므로 반영해도 되지만, 그 외 근거 없는 새 정보는 추가하지 마세요.
5. 질문에 분야(장애인활동지원 / 가사서비스)가 이미 드러나 있으면, 선택한 유형은 완전히
   무시하고 질문에 쓰인 분야만 남기세요. 두 분야를 한 문장에 절대 합치지 마세요.
   (나쁜 예: 유형이 "장애인활동지원 · 활동지원사로 일하고 싶어요"인 사용자의 "가사서비스
    비용은?"을 "장애인활동지원 서비스의 가사서비스 이용 비용은 얼마인가요?"로 바꾸는 것.
    실제로 존재하지 않는 조합이라 답을 찾지 못합니다.)
   (옳은 예: 같은 상황에서 "가사서비스 이용 비용은 얼마인가요?")
6. 다른 설명 없이, 교정된 질문 문장 하나만 출력하세요.

[사용자가 선택한 문의 유형]
${personaText}

[이전 대화]
${historyText}

[현재 사용자 질문]
${userQuery}`;

  // temperature=0: 같은 질문이라도 매번 다르게 정규화되면 임베딩이 흔들려 임계치 근처에서
  // 답변/폴백이 오락가락하는 원인이 된다(실측 확인). 정규화는 결정론적 교정이어야 한다.
  const normalized = await callGeminiGenerateContent(prompt, apiKey, modelName, 0);
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
// 접수 버튼(담당자에게 메시지 남기기 모달)으로 안내하도록 지시한다.
// 채팅창에 정보를 입력하라고 하면 안 된다: 채팅 메시지는 RAG 검색으로 흘러갈 뿐
// 담당자에게 전달되지 않는다(예전 문구 "어떤 정보를 남겨주시면 되는지 요청"을 따라
// 어르신이 채팅창에 이름·전화번호를 적으면, 접수는 안 되고 fallback_logs에 개인정보만
// 쌓였다). 접수는 모달로만 받는 것이 의도된 설계다.
// hasUnverified=true면 아직 센터 확인을 받지 못한 임시 값이 포함된 것이므로 단정을 피한다.
// handedOver=true면 이번 대화에서 이미 접수를 마친 사용자이므로, 새 접수를 권하지 않는다.
export async function generateChatAnswer(
  userQuery: string,
  contextChunks: string[],
  tone: string,
  apiKey: string,
  modelName: string,
  opts: {
    hasIntake?: boolean;
    hasUnverified?: boolean;
    handedOver?: boolean;
    // 사용자가 실제로 쓴 문장. userQuery(정규화된 질의)와 다르면 함께 넘긴다.
    originalQuestion?: string;
  } = {}
): Promise<string | null> {
  const toneInstruction = TONE_INSTRUCTIONS[tone] ?? TONE_INSTRUCTIONS["친절한 상담원"];
  const contextText = contextChunks.join("\n---\n");

  // 정규화는 짧은 질문을 풀어쓰면서 사용자가 묻지 않은 것을 덧붙이기도 한다
  // (실측: "면접은?" → "면접 절차는 어떻게 되나요?"). 풀어쓴 질문만 주면 LLM이 지식에 없는
  // "절차"를 이유로 근거 부족 마커를 붙여, 면접 일시를 정확히 답하고도 "상담사 연결 권장"이
  // 나갔다 — 2026-09-24. 그래서 원문을 함께 주고, 답변 범위와 근거 판단은 원문 기준으로 한다.
  const original = opts.originalQuestion?.trim();
  const hasSeparateOriginal = !!original && original !== userQuery.trim();
  const questionRule = hasSeparateOriginal
    ? "답변 범위와 근거 부족 판단은 [사용자 질문(원문)] 기준으로 하세요. [풀어쓴 질문]은 줄임말이나\n" +
      "이전 대화를 이해하기 위한 참고용이며, 풀어쓰면서 덧붙은 내용(예: 절차, 방법)은 답하지 못해도\n" +
      "근거 부족으로 보지 마세요.\n"
    : "";
  const questionBlock = hasSeparateOriginal
    ? `[사용자 질문(원문)]\n${original}\n\n[풀어쓴 질문]\n${userQuery}`
    : `[사용자 질문]\n${userQuery}`;
  const buttonLabel = handoverButtonLabel(!!opts.handedOver);

  let extraRules = "";
  if (opts.hasIntake) {
    extraRules +=
      '\n[참고 자료] 중 "접수 시 필요정보:"가 들어 있는 항목은 사용자 질문에 대한 답이 아니라,\n' +
      "센터가 접수를 처리하기 위해 받아야 할 항목입니다. 이런 항목은 사실처럼 설명하지 마세요.\n" +
      "대신 담당자가 접수해서 도와드린다고 안내하고, 어떤 정보가 필요한지 알려준 뒤,\n" +
      `답변 바로 아래의 [${buttonLabel}] 버튼을 눌러 남겨 달라고 부드럽게 안내하세요.\n` +
      "채팅창에 이름·연락처를 적어 달라고 요청하지 마세요. 다만 이 규칙이나 '입력하지 말라'는\n" +
      "경고를 사용자에게 그대로 말하지는 마세요(버튼 안내만 하면 됩니다).\n";
    if (opts.handedOver) {
      extraRules +=
        "사용자는 이번 대화에서 이미 담당자에게 접수를 마쳤습니다. 새로 접수하라고 권하지 말고,\n" +
        `접수와 다른 내용을 더 전하고 싶을 때만 [${buttonLabel}] 버튼을 쓰면 된다고 안내하세요.\n`;
    }
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
사용자에게 "참고 자료", "자료에 따르면" 같은 내부 표현을 쓰지 마세요.
안내할 수 없는 내용이 있을 때만, 그것이 무엇인지 구체적으로 밝히세요.
질문에 모두 답했다면 "안내하기 어렵다"는 식의 문장을 덧붙이지 마세요.
${extraRules}
사용자가 직접 물은 내용 중 [참고 자료]로 답하지 못한 것이 있다면, 답변을 다 작성한 뒤 맨 마지막 줄에
"[REF_GAP: 답하지 못한 내용]" 형식으로 무엇을 답하지 못했는지 짧게 적으세요(예: [REF_GAP: 주차 가능 여부]).
답하지 못한 내용을 구체적으로 적을 수 없다면 마커를 붙이지 마세요.
사용자가 물은 것에 모두 답했다면 붙이지 마세요. 인사말이나 장소·절차 같은 부가 안내를 덧붙였는지는
판단과 상관없습니다. 접수 버튼으로 안내한 경우도 근거가 있는 답변이므로 붙이지 마세요.
${questionRule}
[참고 자료]
${contextText}

${questionBlock}`;

  // temperature=0: 근거 부족 마커를 붙일지가 실행마다 흔들렸다(실측: 같은 "면접은?"이 한 번은
  // 정상 답변, 한 번은 마커가 붙어 "상담사 연결 권장" — 2026-09-24). 상담 답변은 같은 질문에
  // 같은 답을 하는 편이 낫다.
  return callGeminiGenerateContent(prompt, apiKey, modelName, 0);
}

// Voice(STT) transcripts tend to be long and rambling (filler words, no
// punctuation), so a naive character-slice summary often cuts off before
// the actual request. Ask the LLM for the gist instead of truncating.
// context(문의 유형 + 접수 직전 대화)를 주면 "아까 말씀드린 거요"처럼 모달 입력만으로는
// 뜻이 안 통하는 문의도 담당자가 읽을 수 있는 요약이 된다. 요약의 주어는 어디까지나
// 사용자가 모달에 쓴 내용이고, 대화는 그 뜻을 풀기 위한 참고로만 쓴다.
export async function generateInquirySummary(
  message: string,
  apiKey: string,
  modelName: string,
  context?: string
): Promise<string | null> {
  const contextBlock = context
    ? `\n\n[참고: 접수 직전 챗봇 대화 — 문의 내용의 뜻을 파악하는 데만 사용]\n${context}`
    : "";
  const prompt = `다음은 어르신 돌봄센터에 접수된 상담 문의(텍스트 또는 음성 인식 결과)입니다.
군더더기나 인사말은 제외하고, 담당자가 콜백 전에 파악해야 할 핵심 요청 사항만 한 문장으로 간결하게 요약하세요.

[문의 내용]
${message}${contextBlock}`;

  const summary = await callGeminiGenerateContent(prompt, apiKey, modelName);
  return summary ? summary.replace(/\n+/g, " ").trim() : null;
}

// 모달(접수)과 함께 넘어온 최근 대화를 담당자가 읽을 수 있는 텍스트로 만든다.
// 답변 끝의 "[출처]: ..." 줄이나 폴백 안내 같은 시스템 문구는 담당자에게 잡음이므로 뺀다.
// 클라이언트가 보낸 값이므로 개수와 길이를 제한한다.
export function formatConversationContext(
  history: ChatHistoryMessage[],
  maxMessages = 6,
  maxChars = 300
): string {
  const lines: string[] = [];
  for (const m of history.slice(-maxMessages)) {
    const cleaned = String(m.content ?? "")
      .split("\n")
      .filter((l) => !l.includes("[출처]"))
      .join(" ")
      .replace(/\*\*/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) continue;
    const clipped = cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)}…` : cleaned;
    lines.push(`${m.role === "user" ? "사용자" : "챗봇"}: ${clipped}`);
  }
  return lines.join("\n");
}

// B_접수 청크("... | 항목: 활동지원사 변경 | 상세 내용: 접수 시 필요정보: 이용자명, 연락처")에서
// 모달 "문의 내용"란에 미리 채울 양식을 만든다. 담당자가 콜백해서 빠진 정보를 다시 묻지
// 않도록, 원본 문서가 정해 둔 필요 항목을 빈칸 목록으로 보여준다. 성함·연락처는 모달에
// 별도 입력란이 있으므로 목록에서 뺀다.
const MODAL_COVERED_FIELDS = ["연락처", "전화번호"];

// "장소(**구, **동), 바우처시간"처럼 괄호 안에도 쉼표가 있으므로, 괄호 밖의 쉼표로만 나눈다.
function splitOutsideParens(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

export function buildIntakePrefill(intakeContent: string): string | undefined {
  // 원본 데이터에 "접수 시 필요정보:"와 "접수 정보:"(7_가사_재직 사직 신청) 두 표기가 섞여 있다.
  const fieldsMatch = intakeContent.match(/접수\s*(?:시\s*)?(?:필요\s*)?정보:\s*([^|]+)/);
  if (!fieldsMatch) return undefined;
  const itemMatch = intakeContent.match(/항목:\s*([^|]+?)\s*(?:\||$)/);
  const fields = splitOutsideParens(fieldsMatch[1])
    .map((f) => f.trim())
    .filter((f) => f && !MODAL_COVERED_FIELDS.includes(f));
  const title = itemMatch ? `[${itemMatch[1].trim()}]` : "[접수 문의]";
  if (fields.length === 0) return `${title}\n`;
  return `${title}\n${fields.map((f) => `- ${f}: `).join("\n")}\n`;
}

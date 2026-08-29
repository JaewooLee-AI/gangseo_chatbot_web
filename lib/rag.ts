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

export function checkGuardrailBlock(prompt: string, settings: BotSettings): string | null {
  if (settings.block_medical && MEDICAL_KEYWORDS.some((k) => prompt.includes(k))) {
    return "🏥 의료/질병 진단 관련 문의는 컴플라이언스 가드레일에 의해 차단되었습니다.";
  }
  if (settings.block_legal && LEGAL_KEYWORDS.some((k) => prompt.includes(k))) {
    return "⚖️ 법률/노무 상담 관련 문의는 컴플라이언스 가드레일에 의해 차단되었습니다.";
  }
  if (settings.block_privacy && PRIVACY_KEYWORDS.some((k) => prompt.includes(k))) {
    return "🔒 개인정보 수집이 필요한 문의는 컴플라이언스 가드레일에 의해 차단되었습니다.";
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

export async function generateChatAnswer(
  userQuery: string,
  contextChunks: string[],
  tone: string,
  apiKey: string,
  modelName: string
): Promise<string | null> {
  const toneInstruction = TONE_INSTRUCTIONS[tone] ?? TONE_INSTRUCTIONS["친절한 상담원"];
  const contextText = contextChunks.join("\n---\n");

  const prompt = `당신은 강서나눔돌봄센터의 AI 상담 챗봇입니다. ${toneInstruction}
아래 [참고 자료]에 있는 내용만 근거로 사용자 질문에 답변하세요.
참고 자료에 없는 내용은 추측하지 말고 모른다고 답하세요.
원문을 그대로 나열하지 말고, 사람이 읽기 편한 자연스러운 문장으로 정리해서 답변하세요.

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

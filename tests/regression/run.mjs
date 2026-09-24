// 챗봇 답변 회귀 테스트: 오타·단문·띄어쓰기·구어·음성(STT)·이어지는 질문 등 다양한 입력에
// 정답을 말하는지 실제 /api/chat에 보내 확인한다. 의존성 없이 Node 18+만으로 실행된다.
//
//   node tests/regression/run.mjs                        # 운영(Vercel)
//   node tests/regression/run.mjs http://localhost:3000  # 로컬
//   node tests/regression/run.mjs <url> I1 M             # id가 I1, M으로 시작하는 케이스만
//
// 주의: 실제 Gemini를 호출하고(약 67회 × 3~4 호출), 답을 못 찾는 케이스(kind=fallback 등)는
// 운영 DB의 fallback_logs(관리자 HITL 목록)에 기록된다. 자세한 내용은 README.md 참고.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] || "https://gangseo-chatbot-web.vercel.app").replace(/\/$/, "");
const FILTERS = process.argv.slice(3);
const CONCURRENCY = 4;
const GREETING = "안녕하세요. 강서나눔돌봄센터 AI 어시스턴트입니다. 무엇을 도와드릴까요?";

const cases = JSON.parse(readFileSync(join(here, "cases.json"), "utf8")).filter(
  (c) => FILTERS.length === 0 || FILTERS.some((f) => c.id.startsWith(f))
);

// 응답 문구로 어느 경로를 탔는지 분류한다(app/api/chat/route.ts의 고정 문구 기준).
function route(text) {
  if (text.startsWith("ERROR")) return "오류";
  if (text.includes("말씀하신 내용을 이해하지 못했어요")) return "무의미안내";
  if (text.includes("저는 강서나눔돌봄센터 AI 상담 챗봇입니다")) return "챗봇소개";
  if (text.includes("[Fallback 발동]")) return "가드레일차단";
  if (text.includes("어떤 서비스에 대해 궁금")) return "되묻기";
  if (text.includes("엄격도 설정 기준")) return "답없음";
  if (text.includes("확실한 근거를 찾지 못해")) return "근거부족";
  if (text.includes("엔진 연결에 문제")) return "엔진오류";
  if (text.includes("HITL 캐시")) return "HITL";
  if (text.includes("담당자에게 연결해 드릴게요") || text.includes("이미 이번 대화에서")) return "연결요청";
  return "답변";
}

const hasAll = (text, expect) => expect.every((group) => group.some((k) => text.includes(k)));
const hasNone = (text, words = []) => words.every((w) => !text.includes(w));

function grade(c, r) {
  const rt = route(r.text);
  switch (c.kind) {
    case "answer":
      return (rt === "답변" || (c.allowGap && rt === "근거부족")) && hasAll(r.text, c.expect) && hasNone(r.text, c.expectNot);
    case "answer_or_clarify":
      return rt === "되묻기" || (rt === "답변" && hasAll(r.text, c.expect));
    case "handover":
      return r.handover;
    case "fallback": {
      // 지식에 없는 질문: 공백으로 처리하고, 지식에 없는 전화번호를 지어내지 않아야 한다.
      const phones = r.text.match(/0\d{1,2}-\d{3,4}-\d{4}/g) || [];
      return (rt === "답없음" || rt === "근거부족") && phones.length === 0;
    }
    case "meaningless":
      return rt === "무의미안내";
    case "small_talk":
      return rt === "챗봇소개";
    case "not_blocked":
      return rt !== "가드레일차단" && rt !== "오류" && rt !== "엔진오류";
    default:
      return false;
  }
}

async function call(c) {
  const messages = [
    { role: "assistant", content: GREETING },
    ...c.history.map(([role, content]) => ({ role, content })),
    { role: "user", content: c.question },
  ];
  const started = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, persona: c.persona }),
        signal: AbortSignal.timeout(90_000),
      });
      const text = await res.text();
      return {
        text: res.ok ? text : `ERROR HTTP ${res.status}`,
        handover: res.headers.get("X-Handover") === "1",
        sec: (Date.now() - started) / 1000,
      };
    } catch (e) {
      if (attempt === 1) return { text: `ERROR ${e}`, handover: false, sec: (Date.now() - started) / 1000 };
    }
  }
}

const results = new Array(cases.length);
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < cases.length) {
      const i = next++;
      const r = await call(cases[i]);
      results[i] = { ...cases[i], ...r, route: route(r.text), pass: grade(cases[i], r) };
    }
  })
);

const score = (t) => t.match(/유사도 Score: ([\d.]+)/)?.[1] ?? "-";
for (const r of results) {
  console.log(
    `${r.pass ? "✅" : "❌"} ${r.id.padEnd(6)} ${r.style.padEnd(10)} ${r.question.slice(0, 34).padEnd(34)} ${r.route}(${score(r.text)}) ${r.sec.toFixed(1)}s`
  );
}
const passed = results.filter((r) => r.pass).length;
console.log(`\nPASS ${passed}/${results.length}  (${BASE})`);

const reportDir = join(here, "reports");
mkdirSync(reportDir, { recursive: true });
const file = join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify({ base: BASE, passed, total: results.length, results }, null, 1));
console.log(`답변 전문: ${file}`);
process.exitCode = passed === results.length ? 0 : 1;

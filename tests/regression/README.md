# 챗봇 답변 회귀 테스트

사람의 다양한 입력(오타, 단문, 띄어쓰기 없음, 구어·줄임말, 음성 입력 스타일, 이어지는 질문)에
챗봇이 정답을 말하는지 실제 `/api/chat`에 보내 확인한다. 검색·정규화·프롬프트·지식 데이터를
바꿀 때마다 전후를 비교하는 용도다.

```bash
node tests/regression/run.mjs                         # 운영(Vercel)
node tests/regression/run.mjs http://localhost:3000   # 로컬(npm run build && npx next start)
node tests/regression/run.mjs <url> P E               # id가 P, E로 시작하는 케이스만
```

결과 요약은 화면에, 답변 전문은 `reports/`(git 제외)에 저장된다. 하나라도 실패하면 종료 코드 1.

## 케이스 (`cases.json`)

| 필드 | 뜻 |
| --- | --- |
| `persona` | 진입 화면에서 고른 문의 유형(`lib/personas.ts`의 키). `null`이면 선택 안 함 |
| `history` | 이어지는 질문용 이전 대화 `[역할, 내용]` |
| `expect` | 정답 판정. 바깥 배열은 AND, 안쪽 배열은 OR (예: `[["화요일"],["14시","2시"]]`) |
| `kind` | `answer` 정답 답변 / `handover` 접수 버튼 신호 / `fallback` 지식 없음으로 처리(전화번호 지어내기 금지) / `not_blocked` 가드레일 오차단 없음 / `answer_or_clarify` 되묻기 또는 정답 |
| `allowGap` | 지식에 일부만 있는 질문. 아는 부분을 답하면서 "근거 부족"으로 표시해도 정답 |

정답 값은 `gangseo_chatbot_admin/Refined_Chatbot_Data_v4.1.xlsx`(현재 운영 지식)에서 가져왔다.
지식 엑셀이 바뀌면(요금 인상, 본인부담금 연도 변경 등) `expect`도 함께 고쳐야 한다.

## 주의

- 실제 Gemini를 호출한다(전체 실행 시 약 250회 호출).
- 답을 못 찾는 케이스는 **운영 DB `fallback_logs`(관리자 HITL 목록)에 기록된다.**
  현재 기준으로 O1(주차장), O2(대표 전화번호), G1(치매 어르신 이용 자격), G2(근로계약서)와
  근거 부족으로 판정된 케이스가 해당한다. 실행 후 관리자 대시보드에서 "무시 처리"하면 된다.
- LLM 답변은 매번 조금씩 달라서, 경계에 있는 케이스는 실행마다 결과가 바뀔 수 있다.
  한 번의 실패보다 여러 번 실행한 경향을 본다.

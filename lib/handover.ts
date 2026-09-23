// 접수("담당자에게 메시지 남기기") 흐름에서 서버 응답 문구와 화면 버튼이 같은 이름을
// 가리켜야 한다. 예전에는 답변은 "상단의 [📞 담당자에게 메시지 남기기]"라고 안내했는데
// 실제 상단 버튼 이름은 "상담연결"이라, 어르신이 안내대로 버튼을 찾을 수 없었다.
// API 라우트(서버)와 ChatInterface(클라이언트)가 함께 쓰므로 순수 상수만 둔다.

export const HANDOVER_BUTTON_LABEL = "담당자에게 메시지 남기기";
// 이번 대화에서 이미 접수를 마친 뒤에는 같은 건이 여러 번 쌓이지 않도록
// "새 접수"가 아니라 "추가 내용"으로 안내한다(어르신이 접수가 됐는지 불안해 반복해서
// 누르는 경우가 흔하다).
export const ADDITIONAL_BUTTON_LABEL = "추가 내용 남기기";

export function handoverButtonLabel(handedOver: boolean) {
  return handedOver ? ADDITIONAL_BUTTON_LABEL : HANDOVER_BUTTON_LABEL;
}

// /api/chat 응답은 본문이 스트리밍 텍스트라, "이 답변 아래에 접수 버튼을 띄워라"는
// 신호와 모달에 미리 채울 값은 응답 헤더로 전달한다. 헤더는 ASCII만 허용하므로
// 한글 값은 encodeURIComponent로 감싼다.
export const HANDOVER_HEADER = "X-Handover";
export const HANDOVER_PREFILL_MESSAGE_HEADER = "X-Handover-Prefill-Message";
export const HANDOVER_PREFILL_PHONE_HEADER = "X-Handover-Prefill-Phone";

export interface HandoverPrefill {
  message?: string;
  phone?: string;
}

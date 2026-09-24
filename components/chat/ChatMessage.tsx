"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

// 답변 속 주소를 정확한 범위의 링크로 감싼다. GFM 자동 링크는 공백이 나올 때까지를 주소로 보므로,
// 한국어처럼 주소 바로 뒤에 조사가 붙으면 "…kr/)로"까지 주소가 되어 잘못된 곳으로 이동한다.
// 주소에 쓰이는 ASCII 문자까지만 인정하고(괄호 제외), 끝의 문장부호는 뺀 뒤 <…>로 감싼다.
// 이미 마크다운 링크의 주소 자리("](주소)")거나 <주소>로 감싼 경우는 건너뛴다.
const BARE_URL = /(?<!\]\()(?<![<\w])(https?:\/\/[A-Za-z0-9._~:/?#@!$&'*+,;=%-]+)/g;
function linkifyUrls(text: string): string {
  return text.replace(BARE_URL, (url) => {
    const trimmed = url.replace(/[.,;:!?'*]+$/, "");
    return `<${trimmed}>${url.slice(trimmed.length)}`;
  });
}
import type { HandoverPrefill } from "@/lib/handover";

export interface MessageProps {
  id?: string;
  role: "user" | "assistant";
  content: string;
  // 서버가 "이 답변은 접수가 필요하다"고 알려온 경우. 말풍선 바로 아래에 접수 버튼을
  // 띄운다 — 답변 문구의 "아래 [담당자에게 메시지 남기기] 버튼"이 가리키는 대상이다.
  handover?: HandoverPrefill;
  handoverLabel?: string;
  onHandover?: () => void;
  onDislike?: () => void;
  onLike?: () => void;
}

export default function ChatMessage({
  role,
  content,
  handover,
  handoverLabel,
  onHandover,
  onDislike,
  onLike,
}: MessageProps) {
  const [feedback, setFeedback] = useState<"like" | "dislike" | null>(null);

  const handleLike = () => {
    setFeedback("like");
    if (onLike) onLike();
  };

  const handleDislike = () => {
    setFeedback("dislike");
    if (onDislike) onDislike();
  };

  if (role === "user") {
    return (
      <div className="flex gap-4 items-start justify-end w-full">
        <div className="flex flex-col gap-1 max-w-[85%] items-end">
          <div className="bg-warm-brick bg-opacity-10 rounded-xl rounded-tr-sm p-4 text-deep-umber font-body-md text-body-md ghost-border">
            <p className="whitespace-pre-wrap">{content}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4 items-start w-full">
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-ui-sand flex items-center justify-center ghost-border">
        <span className="material-symbols-outlined text-deep-umber" style={{ fontSize: "20px" }}>
          robot_2
        </span>
      </div>
      <div className="flex flex-col gap-1 max-w-[85%]">
        <span className="font-label-md text-label-md text-outline ml-1">AI 어시스턴트</span>
        <div className="bg-ui-sand rounded-xl rounded-tl-sm p-4 md:p-5 text-deep-umber font-body-md text-body-md ambient-shadow flex flex-col gap-3">
          <div className="[&_strong]:font-bold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_p:last-child]:mb-0">
            {/* remarkGfm: 답변 속 "https://…" 주소를 누를 수 있는 링크로 만든다. 없으면 주소가 글자로만
                보여 "안내 링크가 보이지 않아요"라는 문의가 실제로 들어왔다(가사서비스 신청 링크).
                링크는 새 탭으로 열어 챗봇 대화가 사라지지 않게 한다. */}
            <ReactMarkdown
              // singleTilde: false — 기본값이면 "1~15구간 … 2~3일"처럼 물결표 두 개 사이가 취소선이 된다.
              remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkBreaks]}
              components={{
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-semibold text-warm-brick break-all"
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {linkifyUrls(content)}
            </ReactMarkdown>
          </div>

          {handover && onHandover && (
            <button
              type="button"
              onClick={onHandover}
              className="self-start flex items-center gap-2 px-5 py-3 border border-deep-umber bg-deep-umber text-canvas-ivory hover:bg-opacity-90 transition-colors rounded-full font-label-lg text-label-lg shadow-sm"
            >
              <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
                support_agent
              </span>
              {handoverLabel}
            </button>
          )}

          {/* Feedback Buttons */}
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-deep-umber/10">
            <button
              type="button"
              onClick={handleLike}
              aria-label="도움이 됨"
              className={`flex items-center justify-center p-2 rounded-full hover:bg-ui-stone transition-colors ${
                feedback === "like" ? "bg-ui-stone text-deep-umber" : ""
              }`}
            >
              <span
                className="material-symbols-outlined text-outline hover:text-deep-umber transition-colors"
                style={{ fontSize: "18px" }}
              >
                thumb_up
              </span>
            </button>
            <button
              type="button"
              onClick={handleDislike}
              aria-label="도움이 안됨"
              className={`flex items-center justify-center p-2 rounded-full hover:bg-ui-stone transition-colors ${
                feedback === "dislike" ? "bg-warm-brick/20 text-warm-brick" : ""
              }`}
            >
              <span
                className="material-symbols-outlined text-outline hover:text-deep-umber transition-colors"
                style={{ fontSize: "18px" }}
              >
                thumb_down
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
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
            <ReactMarkdown remarkPlugins={[remarkBreaks]}>{content}</ReactMarkdown>
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


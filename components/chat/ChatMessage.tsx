"use client";

import React, { useState } from "react";

export interface MessageProps {
  id?: string;
  role: "user" | "assistant";
  content: string;
  onDislike?: () => void;
  onLike?: () => void;
}

export default function ChatMessage({
  role,
  content,
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
          <div className="whitespace-pre-wrap">{content}</div>

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


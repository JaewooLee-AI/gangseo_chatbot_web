"use client";

import React from "react";

interface STTButtonProps {
  isListening: boolean;
  onToggle: () => void;
  variant?: "icon" | "full";
}

export default function STTButton({
  isListening,
  onToggle,
  variant = "icon",
}: STTButtonProps) {
  if (variant === "full") {
    return (
      <button
        type="button"
        onClick={onToggle}
        className={`group flex items-center gap-1 transition-colors focus:outline-none focus:ring-1 focus:ring-deep-umber rounded px-2 py-1 ${
          isListening
            ? "text-warm-brick font-semibold animate-pulse"
            : "text-ui-stone hover:text-deep-umber"
        }`}
      >
        <span className="material-symbols-outlined text-[18px]">
          {isListening ? "mic_off" : "mic"}
        </span>
        <span className="font-label-md text-label-md">
          {isListening ? "듣는 중..." : "음성 입력"}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={isListening ? "음성 입력 중지" : "음성 입력 시작"}
      className={`p-3 transition-colors flex-shrink-0 flex items-center justify-center rounded-lg ${
        isListening
          ? "text-warm-brick animate-pulse bg-warm-brick/10"
          : "text-outline hover:text-deep-umber"
      }`}
    >
      <span className="material-symbols-outlined text-[24px]">
        {isListening ? "graphic_eq" : "mic"}
      </span>
    </button>
  );
}


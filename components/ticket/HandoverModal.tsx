"use client";

import React, { useState, useEffect } from "react";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import STTButton from "../chat/STTButton";

interface HandoverModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function HandoverModal({
  isOpen,
  onClose,
  onSuccess,
}: HandoverModalProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { isListening, transcript, startListening, stopListening, setTranscript } =
    useSpeechToText();

  // Sync transcript from STT into the textarea
  useEffect(() => {
    if (transcript) {
      setReason(transcript);
    }
  }, [transcript]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || !reason.trim()) {
      alert("성함, 연락처, 상세 사유를 모두 입력해주세요.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, message: reason }),
      });

      if (response.ok) {
        alert("접수되었습니다. 담당자가 확인 후 신속히 연락드리겠습니다.");
        onSuccess();
      } else {
        alert("접수 중 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      }
    } catch (error) {
      console.error(error);
      alert("네트워크 오류가 발생했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-deep-umber/60 z-50 backdrop-blur-sm flex items-center justify-center p-4 md:p-8"
      aria-modal="true"
      role="dialog"
    >
      {/* Modal Container */}
      <main className="w-full max-w-2xl bg-canvas-ivory ghost-border ambient-shadow rounded-xl overflow-hidden flex flex-col md:flex-row relative max-h-[90vh]">
        {/* Decorative Side Panel (Desktop) */}
        <aside className="hidden md:block w-1/3 bg-ui-sand relative border-r border-ui-stone">
          <div
            className="absolute inset-0 bg-cover bg-center opacity-80"
            style={{
              backgroundImage:
                "url('https://lh3.googleusercontent.com/aida-public/AB6AXuDvDCriYttM2Rktd9a6XuIeg8x7ULVlQ5fsx52uIxKjyx8kzQwdalF6ldCUxkiQ_HMXlNKnFvei8CM3gNvxlmiWOphIwsqYLkT2DLBlvxErYuehci9kwqKTmHa3YbdenEx-oWX4s_uaHqHiJnvfpJxLKmei8ESbtnigy-ba1rg48aTaq587arn12yw4BxjJyy6J_Lb2cIZqAimzdZnUzS1jzQdNmA9cFNHmE69VxkyUFm2EQjLy8H3M8w')",
            }}
          ></div>
          <div className="absolute inset-0 bg-gradient-to-b from-ui-sand/50 to-ui-sand/90 mix-blend-multiply"></div>
          <div className="relative h-full flex flex-col justify-between p-6 z-10">
            <span
              className="material-symbols-outlined text-deep-umber opacity-60 text-[32px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              support_agent
            </span>
            <div className="text-deep-umber opacity-60 font-label-md text-label-md tracking-widest uppercase">
              Gangseo Care Center
            </div>
          </div>
        </aside>

        {/* Form Canvas */}
        <section className="flex-1 p-6 md:p-8 flex flex-col justify-between overflow-y-auto">
          {/* Close Button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="absolute top-4 right-4 text-deep-umber/60 hover:text-deep-umber transition-colors focus:outline-none p-1 z-20"
          >
            <span className="material-symbols-outlined text-[24px]">close</span>
          </button>

          <header className="mb-6 border-b ghost-border pb-4 pr-8">
            <h2 className="font-headline-md text-headline-md text-deep-umber mb-2 font-bold">
              담당자에게 메시지 남기기
            </h2>
            <p className="font-body-sm text-body-sm text-outline leading-relaxed">
              정확한 확인을 위해 내용과 연락처를 남겨주시면, 신속히 연락드리겠습니다.
            </p>
          </header>

          <form id="handover-form" onSubmit={handleSubmit} className="flex-grow flex flex-col justify-between">
            <div className="space-y-4 mb-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Name Field */}
                <div className="flex flex-col gap-2">
                  <label
                    className="font-label-lg text-label-lg text-deep-umber"
                    htmlFor="name"
                  >
                    성함 <span className="text-warm-brick">*</span>
                  </label>
                  <input
                    id="name"
                    type="text"
                    className="w-full bg-transparent border border-ui-stone rounded-lg px-4 py-3 font-body-md text-body-md text-deep-umber focus:outline-none focus:border-deep-umber transition-colors placeholder-outline"
                    placeholder="홍길동"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>

                {/* Phone Field */}
                <div className="flex flex-col gap-2">
                  <label
                    className="font-label-lg text-label-lg text-deep-umber"
                    htmlFor="phone"
                  >
                    연락처 <span className="text-warm-brick">*</span>
                  </label>
                  <input
                    id="phone"
                    type="tel"
                    className="w-full bg-transparent border border-ui-stone rounded-lg px-4 py-3 font-body-md text-body-md text-deep-umber focus:outline-none focus:border-deep-umber transition-colors placeholder-outline"
                    placeholder="010-0000-0000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Reason Field */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-end mb-1">
                  <label
                    className="font-label-lg text-label-lg text-deep-umber"
                    htmlFor="message"
                  >
                    상세 문의 및 불만 사유 <span className="text-warm-brick">*</span>
                  </label>
                  <STTButton
                    variant="full"
                    isListening={isListening}
                    onToggle={isListening ? stopListening : startListening}
                  />
                </div>
                <textarea
                  id="message"
                  rows={4}
                  className="w-full bg-transparent border border-ui-stone rounded-lg px-4 py-3 font-body-md text-body-md text-deep-umber focus:outline-none focus:border-deep-umber transition-colors resize-none placeholder-outline"
                  placeholder="문의하실 내용을 자세히 적어주세요..."
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setTranscript(e.target.value);
                  }}
                  required
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t ghost-border mt-auto">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-6 py-3 border border-deep-umber bg-transparent text-deep-umber font-label-lg text-label-lg rounded-lg hover:bg-ui-sand transition-colors"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-6 py-3 border border-transparent bg-warm-brick text-canvas-ivory font-label-lg text-label-lg rounded-lg hover:bg-secondary transition-colors shadow-sm disabled:opacity-50"
              >
                {isSubmitting ? "접수 중..." : "접수하기"}
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}


"use client";

import React, { useState, useRef, useEffect } from "react";
import ChatMessage, { MessageProps } from "./ChatMessage";
import STTButton from "./STTButton";
import HandoverModal from "../ticket/HandoverModal";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { PERSONA_LABELS } from "@/lib/personas";

export default function ChatInterface() {
  const [messages, setMessages] = useState<MessageProps[]>([
    {
      id: "1",
      role: "assistant",
      content:
        "안녕하세요. 강서나눔돌봄센터 AI 어시스턴트입니다. 무엇을 도와드릴까요?",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isChatLocked, setIsChatLocked] = useState(false);
  // 진입 시 선택하는 문의 유형. 선택하면 해당 분야 문서 안에서만 검색해
  // 다른 분야(예: 이용자 문의에 직원용 문서) 자료가 섞이는 것을 막는다.
  const [persona, setPersona] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Web Speech API hook
  const { isListening, transcript, startListening, stopListening, setTranscript } =
    useSpeechToText();

  // Sync transcript from STT into input state
  useEffect(() => {
    if (transcript) {
      setInput(transcript);
    }
  }, [transcript]);

  // Scroll to bottom when messages update
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleOpenHandover = () => {
    setIsModalOpen(true);
  };

  const handleHandoverSuccess = () => {
    setIsModalOpen(false);
    setIsChatLocked(true);
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: "assistant",
        content:
          "담당자에게 민원이 성공적으로 접수되었습니다. 확인 후 신속히 등록하신 연락처로 연락드리겠습니다. (추가 문의는 센터 대표전화로 연락 부탁드립니다.)",
      },
    ]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || isChatLocked) return;

    const userMessage: MessageProps = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setTranscript("");
    if (isListening) stopListening();
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          persona,
        }),
      });

      if (!response.ok) {
        throw new Error("Chat request failed");
      }

      // ReadableStream SSE reader for text streaming
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantResponse = "";

      const assistantMsgId = (Date.now() + 1).toString();
      setMessages((prev) => [
        ...prev,
        { id: assistantMsgId, role: "assistant", content: "" },
      ]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          assistantResponse += chunk;

          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, content: assistantResponse }
                : msg
            )
          );
        }
      }
    } catch (error) {
      console.error(error);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          content:
            "현재 답변을 불러오는 도중 오류가 발생했습니다. 화면 하단의 [담당자에게 메시지 남기기] 버튼을 이용해 주시기 바랍니다.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-canvas-ivory text-deep-umber antialiased">
      {/* TopAppBar */}
      <header className="bg-canvas-ivory text-deep-umber flex justify-between items-center w-full px-4 md:px-8 py-4 max-w-7xl mx-auto top-0 z-40 sticky border-b ghost-border">
        <button
          aria-label="메뉴"
          className="flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity p-1 rounded-lg"
          onClick={() => alert("강서나눔돌봄센터 AI 어시스턴트")}
        >
          <span className="material-symbols-outlined text-deep-umber" style={{ fontSize: "24px" }}>
            menu
          </span>
        </button>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-ui-sand flex items-center justify-center ghost-border shrink-0">
            <span className="material-symbols-outlined text-deep-umber text-[18px]">robot_2</span>
          </div>
          <h1 className="font-headline-md text-headline-md font-bold text-deep-umber">
            강서나눔돌봄센터
          </h1>
        </div>
        <button
          onClick={handleOpenHandover}
          className="font-label-lg text-label-lg text-deep-umber hover:text-warm-brick transition-colors border border-deep-umber/30 px-3 py-1.5 rounded-lg"
        >
          상담연결
        </button>
      </header>

      {/* Main Chat Canvas */}
      <main className="flex-grow flex flex-col max-w-4xl mx-auto w-full px-4 md:px-8 pb-36 md:pb-28 pt-4 chat-scroll">
        {/* Date Divider */}
        <div className="flex items-center justify-center w-full my-4">
          <div className="h-px bg-ui-stone w-1/4"></div>
          <span className="px-4 font-label-md text-label-md text-outline">오늘</span>
          <div className="h-px bg-ui-stone w-1/4"></div>
        </div>

        {/* Message Trajectory */}
        <div className="flex flex-col gap-6">
          {messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              role={msg.role}
              content={msg.content}
              onDislike={() => {
                handleOpenHandover();
              }}
            />
          ))}

          {/* 진입 유형 선택 — 아직 고르지 않았고 대화 시작 전일 때만 노출 */}
          {!persona && messages.length === 1 && (
            <div className="bg-ui-sand rounded-xl p-5 ambient-shadow ghost-border">
              <p className="font-body-md text-body-md text-deep-umber mb-4">
                어떤 도움이 필요하신가요? 아래에서 골라 주시면 더 정확하게 안내해 드릴 수 있습니다.
                <span className="block text-outline mt-1 font-label-md text-label-md">
                  (고르지 않고 바로 질문하셔도 됩니다.)
                </span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Object.entries(PERSONA_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setPersona(key)}
                    className="text-left px-4 py-3 rounded-xl border border-deep-umber/30 bg-canvas-ivory text-deep-umber hover:bg-deep-umber hover:text-canvas-ivory transition-colors font-label-lg text-label-lg"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 선택한 유형 표시 및 변경 */}
          {persona && (
            <div className="flex items-center gap-2 self-start">
              <span className="px-3 py-1.5 rounded-full bg-ui-sand text-deep-umber ghost-border font-label-md text-label-md">
                {PERSONA_LABELS[persona]}
              </span>
              <button
                onClick={() => setPersona(null)}
                className="font-label-md text-label-md text-outline underline hover:text-deep-umber transition-colors"
              >
                변경
              </button>
            </div>
          )}

          {isLoading && (
            <div className="flex gap-4 items-start w-full">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-ui-sand flex items-center justify-center ghost-border">
                <span
                  className="material-symbols-outlined text-deep-umber animate-spin"
                  style={{ fontSize: "20px" }}
                >
                  sync
                </span>
              </div>
              <div className="flex flex-col gap-1 max-w-[85%]">
                <span className="font-label-md text-label-md text-outline ml-1">
                  AI 어시스턴트
                </span>
                <div className="bg-ui-sand rounded-xl rounded-tl-sm p-4 text-deep-umber font-body-md text-body-md ambient-shadow flex items-center gap-2">
                  <span>답변을 작성하고 있습니다...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Escalation Button */}
        <div className="flex justify-center mt-8 mb-4">
          <button
            onClick={handleOpenHandover}
            className="flex items-center gap-2 px-6 py-3 border border-deep-umber text-deep-umber bg-transparent hover:bg-deep-umber hover:text-canvas-ivory transition-colors rounded-full font-label-lg text-label-lg group shadow-sm"
          >
            <span
              className="material-symbols-outlined text-deep-umber group-hover:text-canvas-ivory transition-colors"
              style={{ fontSize: "20px" }}
            >
              support_agent
            </span>
            담당자에게 메시지 남기기
          </button>
        </div>
      </main>

      {/* Floating / Sticky Chat Input Area */}
      <div className="fixed bottom-[56px] md:bottom-0 left-0 w-full bg-canvas-ivory/95 backdrop-blur-md border-t ghost-border px-4 md:px-8 py-3 z-40">
        <div className="max-w-4xl mx-auto relative">
          <div className="relative flex items-center bg-canvas-ivory border border-ui-stone focus-within:border-deep-umber rounded-xl p-1 transition-colors ambient-shadow">
            <STTButton
              isListening={isListening}
              onToggle={isListening ? stopListening : startListening}
            />
            <form onSubmit={handleSubmit} className="flex-1 flex items-center">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isChatLocked || isLoading}
                placeholder={
                  isChatLocked
                    ? "민원이 접수되어 채팅이 완료되었습니다."
                    : "메시지를 입력하세요..."
                }
                className="w-full bg-transparent border-none focus:ring-0 font-body-md text-body-md text-deep-umber placeholder-outline px-2 py-3 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isChatLocked || isLoading || !input.trim()}
                aria-label="전송"
                className="p-3 bg-deep-umber text-canvas-ivory rounded-lg hover:bg-opacity-90 transition-colors flex-shrink-0 ml-1 flex items-center justify-center disabled:opacity-40"
              >
                <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
                  send
                </span>
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Bottom Navigation Bar (Mobile) */}
      <nav className="md:hidden fixed bottom-0 w-full z-50 flex justify-around items-center px-4 py-2 bg-canvas-ivory border-t border-deep-umber/10">
        <button
          onClick={() => alert("홈 화면입니다.")}
          className="flex flex-col items-center justify-center text-outline hover:text-deep-umber transition-opacity py-1"
        >
          <span className="material-symbols-outlined mb-0.5" style={{ fontSize: "20px" }}>
            home
          </span>
          <span className="font-label-md text-[11px]">홈</span>
        </button>
        <button className="flex flex-col items-center justify-center text-deep-umber font-bold py-1">
          <span
            className="material-symbols-outlined mb-0.5"
            style={{ fontSize: "20px", fontVariationSettings: "'FILL' 1" }}
          >
            chat_bubble
          </span>
          <span className="font-label-md text-[11px]">문의</span>
        </button>
        <button
          onClick={() =>
            alert("강서나눔돌봄센터는 어르신 돌봄, 요양보호사 파견 등의 서비스를 제공합니다.")
          }
          className="flex flex-col items-center justify-center text-outline hover:text-deep-umber transition-opacity py-1"
        >
          <span className="material-symbols-outlined mb-0.5" style={{ fontSize: "20px" }}>
            info
          </span>
          <span className="font-label-md text-[11px]">안내</span>
        </button>
        <button
          onClick={() =>
            alert("장기요양등급 및 노인돌봄 서비스 요금은 공단 및 센터 기준에 따릅니다.")
          }
          className="flex flex-col items-center justify-center text-outline hover:text-deep-umber transition-opacity py-1"
        >
          <span className="material-symbols-outlined mb-0.5" style={{ fontSize: "20px" }}>
            payments
          </span>
          <span className="font-label-md text-[11px]">요금</span>
        </button>
      </nav>

      {/* Handover Modal */}
      <HandoverModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleHandoverSuccess}
      />
    </div>
  );
}


import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  classifyInquiry,
  formatConversationContext,
  generateInquirySummary,
  getGeminiApiKey,
  PERSONA_LABELS,
  type ChatHistoryMessage,
} from "@/lib/rag";

// 클라이언트가 보낸 값이므로 길이를 제한한다(DB 컬럼 길이와 스팸 방지).
const MAX_NAME = 50;
const MAX_PHONE = 30;
const MAX_MESSAGE = 2000;

export async function POST(req: Request) {
  try {
    const { name, phone, message, persona, history, isAdditional } = await req.json();

    if (!name?.trim() || !phone?.trim() || !message?.trim()) {
      return NextResponse.json({ error: "필수 정보가 누락되었습니다." }, { status: 400 });
    }
    if (name.length > MAX_NAME || phone.length > MAX_PHONE || message.length > MAX_MESSAGE) {
      return NextResponse.json({ error: "입력 길이가 너무 깁니다." }, { status: 400 });
    }

    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    const cleanMessage = message.trim();
    const personaLabel =
      typeof persona === "string" ? PERSONA_LABELS[persona] ?? null : null;
    const conversation = formatConversationContext(
      Array.isArray(history) ? (history as ChatHistoryMessage[]) : []
    );
    const additional = isAdditional === true;

    const category = classifyInquiry(cleanMessage);

    // 담당자가 "무엇 때문에 접수했는지" 알 수 있도록 문의 유형과 접수 직전 대화를 요약에
    // 참고로 넘긴다. 접수 후 이어진 대화는 기존 건에 붙이지 않고, 추가 내용은 새 건으로 받는다.
    const summaryContext = [
      personaLabel ? `[문의 유형] ${personaLabel}` : "",
      conversation,
    ].filter(Boolean).join("\n");

    // Fallback if the LLM call is unavailable/fails — same naive slice as before.
    let summary = cleanMessage.length > 60 ? `${cleanMessage.slice(0, 60)}...` : cleanMessage;
    const geminiKey = await getGeminiApiKey(supabaseAdmin);
    if (geminiKey) {
      const { data: providerRows } = await supabaseAdmin
        .from("llm_providers")
        .select("model_name")
        .eq("vendor_id", "gemini");
      const geminiModel = providerRows?.[0]?.model_name || "gemini-3.1-flash-lite";
      const aiSummary = await generateInquirySummary(
        cleanMessage, geminiKey, geminiModel, summaryContext || undefined
      );
      if (aiSummary) summary = aiSummary;
    }

    // anon은 INSERT 후 되읽기(SELECT)가 막혀 있어 DB가 만든 id를 돌려받을 수 없다.
    // 사용자에게 보여줄 접수번호를 위해 id를 여기서 만들어 넣는다.
    const id = crypto.randomUUID();
    const receiptNo = id.slice(0, 8).toUpperCase();

    // DB 스키마를 바꾸지 않고, 담당자 화면(CS 앱·관리자 대시보드)이 이미 보여주는 칸에
    // 맥락을 담는다. 두 화면 모두 원문을 줄바꿈 그대로 표시한다.
    // 접수번호를 원문 첫 줄에 넣는 이유: CS 앱 검색이 raw_message를 대상으로 하므로,
    // 어르신이 전화로 접수번호를 불러주면 담당자가 바로 찾을 수 있다.
    const tags = [additional ? "[추가 접수]" : "", personaLabel ? `[${personaLabel}]` : ""]
      .filter(Boolean)
      .join(" ");
    const rawMessage = [
      `접수번호: ${receiptNo}`,
      cleanMessage,
      conversation ? `\n──── 접수 직전 챗봇 대화 (최근) ────\n${conversation}` : "",
    ].filter(Boolean).join("\n");

    // No .select() chain — anon can INSERT into counselor_inquiries but
    // cannot SELECT it back (RLS), so return=representation would fail
    // even though the insert itself succeeds.
    const { error } = await supabase.from("counselor_inquiries").insert({
      id,
      user_name: cleanName,
      contact_info: cleanPhone,
      inquiry_summary: tags ? `${tags} ${summary}` : summary,
      raw_message: rawMessage,
      input_type: "text",
      category,
      status: "pending",
    });

    if (error) {
      console.error("counselor_inquiries insert error:", error);
      return NextResponse.json({ error: "데이터베이스 저장에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ success: true, category, receiptNo, summary });
  } catch (error) {
    console.error("Ticket route error:", error);
    return NextResponse.json({ error: "서버 내부 오류가 발생했습니다." }, { status: 500 });
  }
}

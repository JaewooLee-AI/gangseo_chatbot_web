import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { classifyInquiry, generateInquirySummary } from "@/lib/rag";

export async function POST(req: Request) {
  try {
    const { name, phone, message } = await req.json();

    if (!name?.trim() || !phone?.trim() || !message?.trim()) {
      return NextResponse.json({ error: "필수 정보가 누락되었습니다." }, { status: 400 });
    }

    const category = classifyInquiry(message);

    // Fallback if the LLM call is unavailable/fails — same naive slice as before.
    let summary = message.length > 60 ? `${message.slice(0, 60)}...` : message;
    const { data: geminiKey } = await supabaseAdmin.rpc("get_llm_api_key", {
      p_vendor_id: "gemini",
    });
    if (geminiKey) {
      const { data: providerRows } = await supabaseAdmin
        .from("llm_providers")
        .select("model_name")
        .eq("vendor_id", "gemini");
      const geminiModel = providerRows?.[0]?.model_name || "gemini-3.1-flash-lite";
      const aiSummary = await generateInquirySummary(message, geminiKey, geminiModel);
      if (aiSummary) summary = aiSummary;
    }

    // No .select() chain — anon can INSERT into counselor_inquiries but
    // cannot SELECT it back (RLS), so return=representation would fail
    // even though the insert itself succeeds.
    const { error } = await supabase.from("counselor_inquiries").insert({
      user_name: name,
      contact_info: phone,
      inquiry_summary: summary,
      raw_message: message,
      input_type: "text",
      category,
      status: "pending",
    });

    if (error) {
      console.error("counselor_inquiries insert error:", error);
      return NextResponse.json({ error: "데이터베이스 저장에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ success: true, category });
  } catch (error) {
    console.error("Ticket route error:", error);
    return NextResponse.json({ error: "서버 내부 오류가 발생했습니다." }, { status: 500 });
  }
}

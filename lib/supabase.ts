import { createClient } from "@supabase/supabase-js";

// Public (anon) client. Safe to use in both client and server components.
// RLS restricts this key to: SELECT rag_documents/bot_settings, INSERT-only
// on fallback_logs/counselor_inquiries. Never chain .select() after an
// insert on those two tables — anon has no SELECT grant, so the insert
// itself succeeds but the read-back is rejected by RLS.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

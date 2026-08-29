import "server-only";
import { createClient } from "@supabase/supabase-js";

// service_role client — bypasses RLS entirely. Only import this from
// server-side code (API route handlers). Never import from a "use client"
// component or expose SUPABASE_SERVICE_ROLE_KEY to the browser.
// Used solely to call get_llm_api_key()/read llm_providers, both of which
// anon/authenticated are revoked from at the database level.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

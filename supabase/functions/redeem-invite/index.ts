// smartPOA: redeems an invitation link. Verifies the token server-side and creates the sign-in account
// for the invited email only. Membership is granted later by accept_invitation, which requires MFA (aal2).
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED = (Deno.env.get("SMARTPOA_ALLOWED_ORIGINS") ?? "https://smartpoa.flitelinetech.com,https://flas-tech.github.io,http://localhost:8080,http://127.0.0.1:8080").split(",");
function cors(origin: string | null) {
  const o = origin && ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin", "Content-Type": "application/json" };
}
const j = (b: unknown, s: number, h: Record<string, string>) => new Response(JSON.stringify(b), { status: s, headers: h });

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return j({ error: "method" }, 405, h);
  let body: { token?: string; password?: string; action?: string };
  try { body = await req.json(); } catch { return j({ error: "bad request" }, 400, h); }
  const token = String(body.token ?? "");
  if (!/^[a-f0-9]{48}$/.test(token)) return j({ error: "Invitation link is not valid" }, 400, h);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: inv, error } = await admin.rpc("invite_lookup", { p_token: token });
  if (error || !inv) return j({ error: "Invitation is expired, used, or not valid" }, 404, h);
  if (body.action === "peek") return j({ email: inv.email, kind: inv.kind, org: inv.org ?? null, roles: inv.roles ?? [] }, 200, h);
  const password = String(body.password ?? "");
  if (password.length < 12 || password.length > 128 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return j({ error: "Password must be 12 to 128 characters with letters and numbers" }, 400, h);
  }
  const { error: cErr } = await admin.auth.admin.createUser({ email: inv.email, password, email_confirm: true });
  if (cErr) {
    const exists = /already|registered|exists/i.test(cErr.message);
    return j(exists ? { status: "exists", email: inv.email } : { error: "Could not create account" }, exists ? 200 : 500, h);
  }
  return j({ status: "created", email: inv.email }, 200, h);
});

// smartPOA: checks FAA source documents for changes. Platform owner only.
// Downloads each registered ACS/PTS PDF, hashes it, compares with the registry and records the result.
// It never changes a standard automatically: a changed hash is flagged pending_review for the owner.
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED = (Deno.env.get("SMARTPOA_ALLOWED_ORIGINS") ?? "https://flas-tech.github.io,http://localhost:8080,http://127.0.0.1:8080").split(",");
function cors(origin: string | null) {
  const o = origin && ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin", "Content-Type": "application/json" };
}
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  const auth = req.headers.get("authorization") ?? "";
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: isOwner, error: oErr } = await user.rpc("is_platform_owner");
  if (oErr || isOwner !== true) return new Response(JSON.stringify({ error: "Platform owner with MFA required" }), { status: 403, headers: h });
  const { data: who } = await user.auth.getUser();
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: docs } = await admin.from("standards_docs").select("id,doc_number,source_url,sha256,kind").in("kind", ["ACS", "PTS"]);
  const results: unknown[] = [];
  // Also look at the FAA ACS index page for document numbers we do not track yet.
  let indexNote: Record<string, unknown> = {};
  try {
    const r = await fetch("https://www.faa.gov/training_testing/testing/acs", { headers: { "User-Agent": "smartPOA source check" } });
    const html = await r.text();
    const nums = Array.from(new Set((html.match(/FAA-S-(?:ACS|8081)-[0-9A-Z]+/g) ?? [])));
    const known = new Set((docs ?? []).map((d) => d.doc_number));
    indexNote = { status: r.status, numbers_seen: nums, not_tracked: nums.filter((n) => !known.has(n)) };
  } catch (e) { indexNote = { error: String(e) }; }
  for (const d of docs ?? []) {
    try {
      const r = await fetch(d.source_url, { headers: { "User-Agent": "smartPOA source check" } });
      const buf = await r.arrayBuffer();
      const sha = hex(await crypto.subtle.digest("SHA-256", buf));
      const changed = !!d.sha256 && sha !== d.sha256;
      await admin.from("source_checks").insert({ doc_id: d.id, url: d.source_url, http_status: r.status, sha256: sha, changed, checked_by: who?.user?.id ?? null,
        detail: { bytes: buf.byteLength, last_modified: r.headers.get("last-modified") } });
      if (changed) await admin.from("standards_docs").update({ status: "pending_review", notes: "FAA file changed " + new Date().toISOString().slice(0, 10) + "; review before use." }).eq("id", d.id);
      results.push({ id: d.id, status: r.status, changed });
    } catch (e) { results.push({ id: d.id, error: String(e) }); }
  }
  await admin.from("source_checks").insert({ url: "https://www.faa.gov/training_testing/testing/acs", http_status: (indexNote.status as number) ?? null, changed: ((indexNote.not_tracked as string[]) ?? []).length > 0, checked_by: who?.user?.id ?? null, detail: indexNote });
  return new Response(JSON.stringify({ checked: results.length, results, index: indexNote }), { headers: h });
});

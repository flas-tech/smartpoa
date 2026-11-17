// smartPOA: AI drafting (master scenario, task sub-scenarios, oral questions with expected answers).
// Prompts carried over from the JPJ checkride management system (Grok). The xAI key lives in Supabase Vault and
// never reaches the browser. Only standards text, airports and aircraft model are sent; no applicant data.
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED = (Deno.env.get("SMARTPOA_ALLOWED_ORIGINS") ?? "https://flas-tech.github.io,http://localhost:8080,http://127.0.0.1:8080").split(",");
function cors(origin: string | null) {
  const o = origin && ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin", "Content-Type": "application/json" };
}
const j = (b: unknown, s: number, h: Record<string, string>) => new Response(JSON.stringify(b), { status: s, headers: h });
const MODEL = Deno.env.get("SMARTPOA_AI_MODEL") ?? "grok-4.3";
const HOURLY_LIMIT = 60;
const clip = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f]+/g, " ").slice(0, n);

type Style = { tone?: string; detail?: string; language?: string; narrative?: string; risk?: string; temperature?: number };
function styleLine(s: Style = {}) {
  return `Style: ${s.tone || "Professional"} tone, ${s.detail || "Concise"} detail, ${s.language || "Technical"} language, ${s.narrative || "Narrative"} style, ${s.risk || "Low Risk"} emphasis.`;
}
function temp(s: Style = {}, d = 0.5) { const t = Number(s.temperature); return Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : d; }

async function grok(key: string, system: string, user: string, max_tokens: number, temperature: number) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 110000);
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await fetch("https://api.x.ai/v1/chat/completions", { method: "POST", signal: ctl.signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens, temperature, messages: [{ role: "system", content: system }, { role: "user", content: user }] }) });
      if ((r.status === 502 || r.status === 503 || r.status === 429) && attempt < 2) { await new Promise((x) => setTimeout(x, 1200)); continue; }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`AI service error ${r.status}`);
      const content = d?.choices?.[0]?.message?.content;
      if (!content) throw new Error("AI service returned no content");
      return { content: String(content).trim(), usage: d.usage ?? {} };
    }
    throw new Error("AI service unavailable");
  } finally { clearTimeout(tm); }
}
function parseJsonArray(s: string) {
  let t = s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const a = t.indexOf("["), b = t.lastIndexOf("]");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  const v = JSON.parse(t);
  if (!Array.isArray(v)) throw new Error("not an array");
  return v;
}

const DISCLAIM = "Do not fabricate regulations or facts. If a specific reference is not certain, say so and give general best practice. Cite references specifically (for example 14 CFR 91.155(a), AIM 5-4-5), and cite handbooks at chapter level only when certain.";

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return j({ error: "method" }, 405, h);
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return j({ error: "Sign in required" }, 401, h);
  let body: any;
  try { body = await req.json(); } catch { return j({ error: "bad request" }, 400, h); }
  const orgId = String(body.org_id ?? "");
  if (!/^[0-9a-f-]{36}$/.test(orgId)) return j({ error: "organization required" }, 400, h);

  const url = Deno.env.get("SUPABASE_URL")!;
  const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: who } = await user.auth.getUser();
  if (!who?.user) return j({ error: "Sign in required" }, 401, h);
  const { data: allowed } = await user.rpc("has_role", { p_org: orgId, p_roles: ["org_admin", "examiner"] });
  if (!allowed) return j({ error: "Only examiners with a verified authenticator session can use AI drafting" }, 403, h);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from("ai_usage").select("id", { count: "exact", head: true }).eq("user_id", who.user.id).gte("at", since);
  if ((count ?? 0) >= HOURLY_LIMIT) return j({ error: "AI drafting limit reached for this hour. Try again later." }, 429, h);
  const { data: key } = await admin.rpc("app_secret", { p_name: "grok_api_key" });
  if (!key) return j({ error: "AI drafting is not configured" }, 503, h);

  const s: Style = body.style ?? {};
  const kind = String(body.kind ?? "");
  const log = (ok: boolean, u: any = {}) => admin.from("ai_usage").insert({ org_id: orgId, user_id: who.user.id, kind, model: MODEL, prompt_tokens: u.prompt_tokens ?? null, completion_tokens: u.completion_tokens ?? null, ok });
  try {
    if (kind === "master_scenario") {
      const p = body.payload ?? {};
      const sys = `You write the master scenario for an FAA practical test (checkride) plan of action. Write 4-7 sentences addressed to the applicant as "you", with a relaxed, professional tone and vivid, aviation-specific wording. Use the settings as starting points to create a realistic, cohesive context with one realistic challenge suited to the ${clip(p.cert, 60)} level (for example a GPS misreading, a VOR signal fade, a misread NOTAM). Avoid unrealistic drama (passenger crises, personal tragedies) and repetitive cliches. Use generalized weather (for example "VFR conditions") instead of exact visibility or ceilings. Do not preempt task-level details. ${styleLine(s)} Return plain text only.`;
      const usr = `Certificate or rating sought: ${clip(p.cert, 60)}${p.cls ? " (" + clip(p.cls, 10) + ")" : ""}
Governing standard: ${clip(p.standard, 40)}
Difficulty: ${clip(p.difficulty, 400)}
Scenario preference: ${clip(p.preference, 120)}
Weather: ${clip(p.weather, 120)}
Pilot factors: ${clip(p.pilot, 160)}
Aircraft factors: ${clip(p.aircraftFactors, 160)}
Environmental factors: ${clip(p.environment, 200)}
External pressures: ${clip(p.pressures, 200)}
Departure airport: ${clip(p.dep, 8) || "the departure airport"}
Destination airport: ${clip(p.dest, 8) || "the destination airport"}
Aircraft make and model: ${clip(p.aircraft, 60) || "the test aircraft"}`;
      const r = await grok(key, sys, usr, 450, temp(s, 0.7));
      await log(true, r.usage);
      return j({ text: r.content, model: MODEL }, 200, h);
    }
    if (kind === "task_scenarios") {
      const tasks = (Array.isArray(body.payload?.tasks) ? body.payload.tasks : []).slice(0, 30).map((t: any) => ({ key: clip(t.key, 12), title: clip(t.title, 120), skills: (Array.isArray(t.skills) ? t.skills : []).slice(0, 12).map((x: any) => clip(x, 200)) }));
      if (!tasks.length) return j({ items: [] }, 200, h);
      const sys = `You write short sub-scenarios (1-3 sentences) for FAA checkride tasks. Each one is a specific, situational challenge tied to the task's phase (preflight for ground tasks, in-flight for flight tasks) that prompts the applicant to apply the listed skills by inference, without restating them word for word. End with a prompt such as "Explain how you would handle...", "What steps would you take...", or "How do you proceed?", varying wording. Address the applicant as "you" about 70% of the time and "the applicant" 30%, vary openings, and avoid vague words like "address a scenario". Do not add weather or pilot stressors unless a skill requires them. ${styleLine(s)} Return only a JSON array of objects {"key": task key, "text": sub-scenario}.`;
      const usr = `Master scenario (context only): ${clip(body.payload?.master, 1500)}\nTasks:\n${JSON.stringify(tasks)}`;
      const r = await grok(key, sys, usr, Math.min(4000, 160 * tasks.length + 200), temp(s, 0.5));
      const items = parseJsonArray(r.content).map((x: any) => ({ key: clip(x.key, 12), text: clip(x.text, 900) })).filter((x: any) => x.key && x.text);
      await log(true, r.usage);
      return j({ items, model: MODEL }, 200, h);
    }
    if (kind === "questions") {
      const els = (Array.isArray(body.payload?.elements) ? body.payload.elements : []).slice(0, 40).map((e: any) => ({ code: clip(e.code, 24), type: clip(e.type, 2), description: clip(e.text, 400), references: clip(e.references, 300) }));
      if (!els.length) return j({ items: [] }, 200, h);
      const sys = `You write oral-exam questions and expected answers for an FAA practical test, aligned with the Airman Certification Standards. For each element write one concise question (1 sentence) focusing on a single action or decision, derived from the element and its task references, and an expected answer (2-3 sentences) that cites a specific reference. Vary phrasing across questions.
Knowledge (K) and AKTR elements: no scenario context; test factual understanding.
Risk management (R) elements: no scenario context; ask about the risk's impact and mitigation.
Skill (S) elements: ask the applicant to explain how they would perform or evaluate the skill.
Difficulty: ${clip(body.payload?.difficulty, 400)}
${DISCLAIM} ${styleLine(s)} Return only a JSON array of objects {"code", "question", "expectedAnswer"}.`;
      const r = await grok(key, sys, JSON.stringify(els), Math.min(6000, 230 * els.length + 300), temp(s, 0.3));
      const items = parseJsonArray(r.content).map((x: any) => ({ code: clip(x.code, 24), question: clip(x.question, 800), expected: clip(x.expectedAnswer ?? x.expected, 1500) })).filter((x: any) => x.code && x.question);
      await log(true, r.usage);
      return j({ items, model: MODEL }, 200, h);
    }
    return j({ error: "unknown kind" }, 400, h);
  } catch (e) {
    await log(false);
    return j({ error: e instanceof SyntaxError ? "The AI response could not be read. Try again." : (e as Error).message }, 502, h);
  }
});

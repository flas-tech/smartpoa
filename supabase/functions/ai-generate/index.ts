// smartPOA: AI drafting (master scenario, task sub-scenarios, oral questions with expected answers).
// Prompts carried over from the JPJ checkride management system (Grok). The xAI key lives in Supabase Vault and
// never reaches the browser. Only standards text, airports and aircraft model are sent; no applicant data.
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED = (Deno.env.get("SMARTPOA_ALLOWED_ORIGINS") ?? "https://smartpoa.flitelinetech.com,https://flas-tech.github.io,http://localhost:8080,http://127.0.0.1:8080").split(",");
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
  try { const v = JSON.parse(t); if (Array.isArray(v)) return v; } catch { /* salvage below */ }
  // A long reply can be cut off; keep every complete object before the cut.
  const st = t.indexOf("["); if (st < 0) throw new SyntaxError("no array");
  let end = t.length;
  for (let n = 0; n < 80; n++) {
    end = t.lastIndexOf("}", end - 1); if (end <= st) break;
    try { const v = JSON.parse(t.slice(st, end + 1) + "]"); if (Array.isArray(v) && v.length) return v; } catch { /* keep trimming */ }
  }
  throw new SyntaxError("unreadable");
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
      const tasks = (Array.isArray(body.payload?.tasks) ? body.payload.tasks : []).slice(0, 14).map((t: any) => ({ key: clip(t.key, 12), title: clip(t.title, 120), method: clip(t.method, 10), elements: (Array.isArray(t.elements) ? t.elements : (Array.isArray(t.skills) ? t.skills : [])).slice(0, 20).map((x: any) => clip(x, 220)) }));
      if (!tasks.length) return j({ items: [] }, 200, h);
      const sys = `You write task scenarios for an FAA checkride plan of action. The purpose of every scenario is to make the applicant DEMONSTRATE the task by doing it, not describe it. Each element line is "TYPE CODE: text" where S = skill, K = knowledge, R = risk management.
For EVERY task given, write:
1. "text": a task scenario (2-3 sentences) set inside the master scenario at the right phase. Create a concrete operational need that the applicant can only meet by performing the task. Flight tasks: give a real reason to fly the maneuver or procedure in the aircraft (for example a short runway with an obstacle calls for a short-field landing, traffic on the runway calls for a go-around, the examiner's simulated engine failure calls for the emergency approach and landing). Oral and planning tasks: require the applicant to produce a result with the real materials, such as compute performance or weight and balance, plan or brief, find and show an item in the logbooks or POH/AFM, or make and justify a go or no-go decision. End with a direct instruction for what the applicant must now do. Put the skill element codes this scenario requires in "codes".
2. "subs": 2 or 3 sub-scenarios (1-2 sentences each). Each changes one condition during the task (wind, weight, runway, equipment, ATC, traffic, a passenger, a risk factor) so the applicant must adjust and demonstrate specific skill elements; put those codes in "codes". Between the task scenario and its subs, require every skill element listed for the task. When a task has no skill elements, make the applicant apply the listed knowledge and risk elements to a decision they must make and act on, and list those codes.
Do not copy element text word for word. Emergencies and failures are simulated by the examiner as the standard allows; never require an unsafe action. Address the applicant as "you" about 70% of the time and "the applicant" 30%. Stay consistent with the master scenario's aircraft, airports and story. Use generalized weather. ${DISCLAIM} ${styleLine(s)} Return only a JSON array of objects {"key": task key, "text": string, "codes": [element codes], "subs": [{"text": string, "codes": [element codes]}]}.`;
      const usr = `Master scenario (context only): ${clip(body.payload?.master, 1500)}\nTasks:\n${JSON.stringify(tasks)}`;
      const r = await grok(key, sys, usr, Math.min(9000, 600 * tasks.length + 800), temp(s, 0.5));
      const codes = (v: any) => (Array.isArray(v) ? v : []).slice(0, 20).map((c: any) => clip(c, 24)).filter(Boolean);
      const items = parseJsonArray(r.content).map((x: any) => ({ key: clip(x.key, 12), text: clip(x.text, 900), codes: codes(x.codes), subs: (Array.isArray(x.subs) ? x.subs : []).slice(0, 4).map((y: any) => typeof y === "string" ? { text: clip(y, 600), codes: [] } : { text: clip(y?.text, 600), codes: codes(y?.codes) }).filter((y: any) => y.text) })).filter((x: any) => x.key && x.text);
      await log(true, r.usage);
      return j({ items, model: MODEL }, 200, h);
    }
    if (kind === "questions") {
      const els = (Array.isArray(body.payload?.elements) ? body.payload.elements : []).slice(0, 30).map((e: any) => {
        const mode = ["single", "pair", "follow"].includes(e.mode) ? e.mode : "single";
        const o: any = { code: clip(e.code, 24), type: clip(e.type, 2), description: clip(e.text, 400), references: clip(e.references, 300), task: clip(e.task, 12), mode };
        if (e.scenario) o.scenario = clip(e.scenario, 700);
        if (mode === "follow") { o.firstQuestion = clip(e.firstQuestion, 600); o.firstExpected = clip(e.firstExpected, 900); }
        return o;
      });
      if (!els.length) return j({ items: [] }, 200, h);
      const sys = `You write oral-exam questions and expected answers for an FAA practical test, aligned with the Airman Certification Standards. Every question must test the specific element given (its code and description), not the task in general.
Knowledge (K) elements: test understanding of that element. Risk management (R) elements: ask the applicant to identify, assess and mitigate that specific risk. AKTR (A) elements: the applicant missed this area on the knowledge test, so confirm the knowledge was corrected. Skill (S) elements: the applicant has just performed this skill in the given "scenario" (a task scenario or sub-scenario); ask a follow-up about what they just did, such as why they chose that action, what standard or tolerance applied, what cue told them to act, or what they would change. Refer to the scenario; do not ask them to perform it again. The expected answer names the correct technique and the acceptable performance.
Each item has a "mode":
- "single": write one question (1-2 sentences) and its expected answer.
- "pair": write the first question and a follow-up. The follow-up builds on the expected answer to the first, going one step deeper: apply it to the test flight, change one condition, or ask why or what if. It must still test the same element.
- "follow": the first question and its expected answer are given; write only the follow-up as described above, returned in "question" and "expectedAnswer".
Expected answers are 2-3 sentences and cite a specific reference (14 CFR section, AIM paragraph, handbook or AC). Vary phrasing.
Difficulty: ${clip(body.payload?.difficulty, 400)}
${DISCLAIM} ${styleLine(s)} Return only a JSON array with one object per input item, in order: {"code", "mode", "question", "expectedAnswer", "followUp", "followUpAnswer"} (followUp fields only for "pair").`;
      const r = await grok(key, sys, JSON.stringify(els), Math.min(9000, 420 * els.length + 600), temp(s, 0.3));
      const items = parseJsonArray(r.content).map((x: any) => ({ code: clip(x.code, 24), mode: clip(x.mode, 8), question: clip(x.question, 800), expected: clip(x.expectedAnswer ?? x.expected, 1500), followUp: clip(x.followUp, 800), followUpExpected: clip(x.followUpAnswer ?? x.followUpExpected, 1500) })).filter((x: any) => x.code && x.question);
      await log(true, r.usage);
      return j({ items, model: MODEL }, 200, h);
    }
    if (kind === "pretest_checklist") {
      const p = body.payload ?? {};
      const ex = (Array.isArray(p.example) ? p.example : []).slice(0, 40).map((x: any) => clip(x, 240));
      const sys = `You draft an examiner's pre-test eligibility checklist for an FAA practical test under 14 CFR part 61. Produce two lists: required logbook or application endorsements, and required aeronautical experience. Base them on 14 CFR 61.39 (prerequisites), 61.43, the section for the certificate or rating sought (for example 61.103/61.109 private, 61.65 instrument, 61.123/61.129 commercial, 61.183/61.187/61.191 flight instructor, 61.153/61.159/61.160 ATP, 61.63 additional ratings, 61.197/61.199 instructor renewal or reinstatement), 61.49 for a retest (instructor retest endorsement), and for a test continued after a Letter of Discontinuance the original Letter of Discontinuance and 61.43(f) time limits. Name an AC 61-65 endorsement number only when you are certain of it. One short item per line; start a sub-item with "- ". Keep each list under 18 lines. Write each item as a plain requirement with its citation; never put notes about uncertainty, best practice or verification inside an item. If a list does not apply to this type of test (for example, no new aeronautical experience is required to continue a discontinued test), return a single item saying so with the citation. ${DISCLAIM} Return only a JSON object {"endorsements": [strings], "experience": [strings]}.`;
      const usr = `Grade: ${clip(p.grade, 60)}\nType of practical test: ${clip(p.testType, 80)}${ex.length ? "\nExisting checklist for a related test (format reference only):\n" + ex.join("\n") : ""}`;
      const r = await grok(key, sys, usr, 1400, temp(s, 0.2));
      let t = String(r.content ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const i = t.indexOf("{"), k = t.lastIndexOf("}"); if (i >= 0 && k > i) t = t.slice(i, k + 1);
      const o = JSON.parse(t);
      const list = (v: any) => (Array.isArray(v) ? v : []).slice(0, 30).map((x: any) => clip(x, 300)).filter(Boolean);
      await log(true, r.usage);
      return j({ endorsements: list(o.endorsements), experience: list(o.experience), model: MODEL }, 200, h);
    }
    return j({ error: "unknown kind" }, 400, h);
  } catch (e) {
    await log(false);
    return j({ error: e instanceof SyntaxError ? "The AI response could not be read. Try again." : (e as Error).message }, 502, h);
  }
});

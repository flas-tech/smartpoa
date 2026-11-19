/* smartPOA checkride records (merged from the JPJ checkride management system): schedule, checkride record,
   outcome reports, organization settings for scenario profiles / AI style / default briefings, and the AI drafting client. */
(function () {
  'use strict';
  const A = window.SPOA; const E = window.SPE;
  const { sb, S, esc, qs, qsa, fmtDate, fmtDT, today, q, act, toast, friendly, go, org, can, shell, head, modal, confirmBox, bindRows, noOrg } = A;

  const TEST_TYPES = ['Original Certificate', 'Retest for Original Certificate', 'Additional Rating', 'Retest For Additional Rating', 'Continued from Previously Discontinued Test', 'Instrument Rating', 'Retest for Instrument Rating', 'Reinstatement of CFI', 'Type Rating', 'Mock Checkride'];
  const BASES = ['Completion of Test or Activity', 'U.S. Military Competence or Experience', 'Graduate of Approved Course', 'Holder of Foreign License', 'Air Carrier Training Program'];
  const RESULTS = { temporary: 'Temporary Certificate', disapproval: 'Notice of Disapproval', discontinuance: 'Letter of Discontinuance', cancelled: 'Cancelled' };
  const RESULT_PILL = { temporary: 'ok', disapproval: 'bad', discontinuance: 'warn', cancelled: '' };
  const GRADES = { private: 'Private Pilot', commercial: 'Commercial Pilot', instrument: 'Instrument Rating', cfi: 'Flight Instructor', cfii: 'Flight Instructor Instrument', atp: 'Airline Transport Pilot' };
  const CLASSES = ['ASEL', 'AMEL', 'ASES', 'AMES', 'RH', 'RG'];
  const RETEST_OF = { 'Original Certificate': 'Retest for Original Certificate', 'Additional Rating': 'Retest For Additional Rating', 'Instrument Rating': 'Retest for Instrument Rating' };
  // test type -> plan of action purpose
  const PURPOSE_OF = { 'Original Certificate': 'practical_test', 'Instrument Rating': 'practical_test', 'Additional Rating': 'added_rating', 'Retest for Original Certificate': 'retest', 'Retest For Additional Rating': 'retest', 'Retest for Instrument Rating': 'retest', 'Continued from Previously Discontinued Test': 'continuation', 'Reinstatement of CFI': 'reinstatement', 'Type Rating': 'type_rating', 'Mock Checkride': 'mock_checkride' };
  const resultPill = (r) => r ? `<span class="pill ${RESULT_PILL[r]}">${esc(RESULTS[r])}</span>` : '<span class="pill info">Scheduled</span>';
  const name = (a) => a ? a.last_name + ', ' + a.first_name : '—';
  const hrs = (v) => v == null || v === '' ? '' : (+v).toFixed(1);

  let OPTS = null;
  async function loadOpts() { if (!OPTS) OPTS = await fetch('data/scenario_options.json?v=' + window.SPOA_CONFIG.version).then((r) => r.json()); return OPTS; }
  let BREQ = null;
  async function loadBriefReq() { if (!BREQ) BREQ = await fetch('data/briefing_requirements.json?v=' + window.SPOA_CONFIG.version).then((r) => r.json()); ORGBR = (await orgSettings()).brief_req || {}; return BREQ; }
  let ORGBR = {};
  function briefReqFor(cert, testType) {
    const ov = ORGBR[cert + '|' + testType];
    if (ov && (ov.endorsements.length || ov.experience.length)) return Object.assign({ grade: cert, grade_label: GRADES[cert], test_type: testType, org: true }, ov);
    if (!BREQ) return null;
    return BREQ.items.find((x) => x.grade === cert && x.test_type === testType && (x.endorsements.length || x.experience.length)) ||
      BREQ.items.find((x) => x.grade === cert && /^(Original Certificate|Instrument Rating)$/.test(x.test_type) && (x.endorsements.length || x.experience.length)) || null;
  }
  async function orgSettings() {
    try { const o = await q(sb.from('orgs').select('settings').eq('id', S.orgId).single()); return o.settings || {}; } catch (_) { return {}; }
  }

  // ---------- AI drafting client ----------
  async function ai(kind, payload) {
    const st = await orgSettings();
    const { data, error } = await sb.functions.invoke('ai-generate', { body: { org_id: S.orgId, kind, payload, style: st.ai_style || {} } });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (_) {}
      throw new Error(msg);
    }
    return data;
  }

  // ---------- schedule ----------
  async function viewSchedule(m, params) {
    const c = shell('schedule'); if (!org()) return noOrg(c);
    const [rows, apps] = await Promise.all([
      q(sb.from('checkrides').select('*').eq('org_id', S.orgId).order('scheduled_at', { ascending: true })),
      q(sb.from('applicants').select('*').eq('org_id', S.orgId).order('last_name')),
    ]);
    const AP = Object.fromEntries(apps.map((a) => [a.id, a]));
    const canEdit = can('org_admin', 'examiner', 'office');
    const st = { future: params.get('all') ? false : true, from: '', to: '', apt: '', type: '', name: '', grade: '', cls: '' };
    c.innerHTML = head('Checkride schedule', 'Scheduled and completed checkrides with results and ground and flight times. Build a plan of action from any scheduled checkride.',
      (canEdit ? '<button class="btn" id="add">Schedule checkride</button>' : '') + (can('org_admin', 'examiner', 'auditor') ? '<a class="btn ghost" href="#/checkride-reports">Outcome reports</a>' : '')) +
      `<div class="card"><div class="form-grid3" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
        <label class="check sm" style="margin-top:1.6rem"><input type="checkbox" id="fu" ${st.future ? 'checked' : ''}> Future only</label>
        <label>From<input type="date" id="f1"></label><label>To<input type="date" id="f2"></label>
        <label>Airport<input id="f3" placeholder="KPBI" maxlength="5"></label>
        <label>Test type<select id="f4"><option value="">All</option>${TEST_TYPES.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
        <label>Applicant<input id="f5" placeholder="Name"></label>
        <label>Grade<select id="f6"><option value="">All</option>${Object.entries(GRADES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label>Class<select id="f7"><option value="">All</option>${CLASSES.map((x) => `<option>${x}</option>`).join('')}</select></label></div></div>
      <div class="card flush"><div class="table-wrap"><table class="t" id="tb"><thead><tr><th>Date / time</th><th>Applicant</th><th>Certificate</th><th>Test type</th><th>Airport</th><th>Aircraft</th><th>Result</th></tr></thead><tbody></tbody></table></div></div>`;
    const render = () => {
      const now = new Date().toISOString();
      const list = rows.filter((r) => {
        const a = AP[r.applicant_id];
        if (st.future && (!r.scheduled_at || r.scheduled_at < now.slice(0, 10))) return false;
        if (st.from && (!r.scheduled_at || r.scheduled_at.slice(0, 10) < st.from)) return false;
        if (st.to && (!r.scheduled_at || r.scheduled_at.slice(0, 10) > st.to)) return false;
        if (st.apt && !(r.departure_airport || '').toUpperCase().includes(st.apt.toUpperCase())) return false;
        if (st.type && r.test_type !== st.type) return false;
        if (st.grade && r.grade_sought !== st.grade) return false;
        if (st.cls && r.class !== st.cls) return false;
        if (st.name && !(a ? a.first_name + ' ' + a.last_name : '').toLowerCase().includes(st.name.toLowerCase())) return false;
        return true;
      });
      if (!st.future) list.reverse();
      qs('#tb tbody', c).innerHTML = list.length ? list.map((r) => { const a = AP[r.applicant_id]; return `<tr class="click" data-id="${r.id}"><td class="sm">${esc(fmtDT(r.scheduled_at) || 'Not scheduled')}</td><td><span class="strong sm">${esc(name(a))}</span><div class="xs muted">${esc(r.school || '')}</div></td><td class="sm">${esc(GRADES[r.grade_sought] || '—')} ${esc(r.class || '')}</td><td class="sm">${esc(r.test_type)}</td><td class="sm mono">${esc(r.departure_airport || '')}</td><td class="sm">${esc(r.aircraft_make_model || '')}<div class="xs muted">${esc(r.tail_number || '')}</div></td><td>${resultPill(r.result)}${r.poa_id ? ' <span class="pill accent">POA</span>' : ''}</td></tr>`; }).join('')
        : `<tr><td colspan="7"><div class="empty"><span class="strong">No checkrides match</span>${st.future ? 'Untick "Future only" to see past checkrides.' : ''}</div></td></tr>`;
      qsa('tr[data-id]', c).forEach((tr) => tr.onclick = () => checkrideForm(rows.find((r) => r.id === tr.dataset.id), apps, () => viewSchedule(m, params)));
    };
    qs('#fu', c).onchange = (e) => { st.future = e.target.checked; render(); };
    [['#f1', 'from'], ['#f2', 'to'], ['#f3', 'apt'], ['#f4', 'type'], ['#f5', 'name'], ['#f6', 'grade'], ['#f7', 'cls']].forEach(([s, k]) => { const el = qs(s, c); el.oninput = el.onchange = () => { st[k] = el.value.trim(); render(); }; });
    render();
    if (qs('#add', c)) qs('#add', c).onclick = () => checkrideForm(params.get('applicant') ? { applicant_id: params.get('applicant') } : null, apps, () => viewSchedule(m, params));
    if (params.get('new') && qs('#add', c)) qs('#add', c).click();
    const op = params.get('open') && rows.find((r) => r.id === params.get('open')); if (op) checkrideForm(op, apps, () => viewSchedule(m, params));
  }

  function checkrideForm(cr, apps, done) {
    cr = cr || {};
    const isNew = !cr.id;
    const canEdit = can('org_admin', 'examiner', 'office');
    const dis = canEdit ? '' : 'disabled';
    const dt = cr.scheduled_at ? new Date(cr.scheduled_at) : null;
    const local = dt ? new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    modal(`<h2>${isNew ? 'Schedule checkride' : 'Checkride record'}</h2><div id="err"></div><form id="f"><div class="form-grid">
      <div class="full" id="flg"></div><label class="full">Applicant<select name="applicant_id" ${dis}><option value="">Select…</option>${apps.map((a) => `<option value="${a.id}" ${a.id === cr.applicant_id ? 'selected' : ''}>${esc(name(a))}${a.ftn ? ' — FTN ' + esc(a.ftn) : ''}</option>`).join('')}</select></label>
      <label>Date and time<input type="datetime-local" name="scheduled_at" value="${esc(local)}" ${dis}></label>
      <label>Departure airport<input name="departure_airport" maxlength="5" value="${esc(cr.departure_airport)}" placeholder="KPBI" ${dis}></label>
      <label>Type of practical test<select name="test_type" ${dis}>${TEST_TYPES.map((t) => `<option ${t === (cr.test_type || 'Original Certificate') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label>Grade of certificate sought<select name="grade_sought" ${dis}><option value="">Select…</option>${Object.entries(GRADES).map(([k, v]) => `<option value="${k}" ${k === cr.grade_sought ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Category / class<select name="class" ${dis}><option value="">Select…</option>${CLASSES.map((x) => `<option ${x === cr.class ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Applied for on basis of<select name="basis" ${dis}><option value="">Select…</option>${BASES.map((x) => `<option ${x === cr.basis ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
      <label>Aircraft make and model<input name="aircraft_make_model" value="${esc(cr.aircraft_make_model)}" placeholder="Cessna 172S" ${dis}></label>
      <label>Tail number<input name="tail_number" value="${esc(cr.tail_number)}" maxlength="8" ${dis}></label>
      <label>Preapproval number<input name="preapproval_number" value="${esc(cr.preapproval_number)}" ${dis}></label>
      <label>IACRA application ID<input name="iacra_app_id" value="${esc(cr.iacra_app_id)}" ${dis}></label>
      <label>School / flight department<input name="school" value="${esc(cr.school)}" ${dis}></label>
      <label>Recommending instructor<input name="recommending_instructor" value="${esc(cr.recommending_instructor)}" ${dis}></label>
      <label>Instructor certificate number<input name="instructor_cert_number" maxlength="20" value="${esc(cr.instructor_cert_number)}" ${dis}></label>
      <div class="full" id="ktWrap"></div><p class="full xs muted" id="ktPre" style="display:none;margin-top:-.4rem"></p>
      <div class="full"><h3>Outcome</h3></div>
      <label>Result<select name="result" ${dis}><option value="">Not yet recorded</option>${Object.entries(RESULTS).map(([k, v]) => `<option value="${k}" ${k === cr.result ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <div class="form-grid" style="gap:.6rem"><label>Ground time (h)<input name="ground_time" inputmode="decimal" value="${esc(hrs(cr.ground_time))}" ${dis}></label><label>Flight time (h)<input name="flight_time" inputmode="decimal" value="${esc(hrs(cr.flight_time))}" ${dis}></label></div>
      <label class="full">Evaluator notes<textarea name="notes" style="min-height:70px" ${dis}>${esc(cr.notes)}</textarea></label></div>
      ${cr.source === 'airtable_import' ? '<p class="xs muted">Imported from the previous checkride system.</p>' : ''}
      <div class="btn-row" style="justify-content:space-between;flex-wrap:wrap">
        <div class="btn-row">${!isNew ? A.flagButton('checkride', cr.id) : ''}${!isNew && canEdit ? '<button type="button" class="btn ghost sm" id="dup">Duplicate as retest</button>' : ''}${!isNew && can('org_admin', 'examiner') ? (cr.poa_id ? `<a class="btn ghost sm" href="#/poa/${cr.poa_id}">Open plan of action</a>` : '<button type="button" class="btn ghost sm" id="poa">Build plan of action</button>') : ''}${!isNew && can('org_admin') ? '<button type="button" class="btn danger sm" id="del">Delete</button>' : ''}</div>
        <div class="btn-row"><button type="button" class="btn ghost" data-close>${canEdit ? 'Cancel' : 'Close'}</button>${canEdit ? '<button class="btn" type="submit">Save</button>' : ''}</div></div></form>`,
    (bg, close) => {
      const f = qs('#f', bg);
      const kte = A.ktEditor(qs('#ktWrap', bg), E.ktTests(cr.knowledge_test));
      if (!canEdit) qsa('#ktWrap input, #ktWrap textarea, #ktWrap button', bg).forEach((x) => { x.disabled = true; });
      // New checkride: offer details still on the older applicant record, filtered to tests for the grade sought.
      const prefill = () => {
        if (!isNew) return; const ap = apps.find((x) => x.id === f.applicant_id.value); if (!ap) return;
        ['school', 'recommending_instructor', 'instructor_cert_number', 'iacra_app_id'].forEach((k) => { if (!f[k].value && ap[k]) f[k].value = ap[k]; });
        const old = E.ktTests(ap.knowledge_test); const ok = E.KT_FOR_CERT[f.grade_sought.value] || [];
        const use = old.filter((t) => ok.includes(E.ktCode(t)));
        if (use.length && kte.isEmpty()) { kte.set(use); const el = qs('#ktPre', bg); el.style.display = ''; el.textContent = 'Filled in from the earlier applicant record: ' + use.map((t) => E.ktCode(t)).join(', ') + '. Check before saving.'; }
      };
      f.applicant_id.addEventListener('change', prefill); f.grade_sought.addEventListener('change', prefill); prefill();
      if (!isNew) { A.bindFlagButtons(bg); A.flagsFor(cr.id).then((fl) => { const el = qs('#flg', bg); if (el && fl.length) el.innerHTML = `<div class="banner warn sm"><b>Flagged in Data Review:</b> ${fl.map((x) => esc(x.title)).join('; ')}</div>`; }); }
      const read = () => {
        const num = (v) => { v = String(v).trim(); if (!v) return null; const n = +v; return Number.isFinite(n) && n >= 0 && n < 24 ? Math.round(n * 10) / 10 : NaN; };
        const row = { applicant_id: f.applicant_id.value || null, scheduled_at: f.scheduled_at.value ? new Date(f.scheduled_at.value).toISOString() : null, departure_airport: f.departure_airport.value.trim().toUpperCase() || null,
          test_type: f.test_type.value, grade_sought: f.grade_sought.value || null, class: f.class.value || null, basis: f.basis.value || null, aircraft_make_model: f.aircraft_make_model.value.trim() || null,
          tail_number: f.tail_number.value.trim().toUpperCase() || null, preapproval_number: f.preapproval_number.value.trim() || null, result: f.result.value || null,
          ground_time: num(f.ground_time.value), flight_time: num(f.flight_time.value), notes: f.notes.value.trim() || null,
          iacra_app_id: f.iacra_app_id.value.trim() || null, school: f.school.value.trim() || null, recommending_instructor: f.recommending_instructor.value.trim() || null, instructor_cert_number: f.instructor_cert_number.value.trim() || null };
        const kt = kte.read(); if (kt.error) { qs('#err', bg).innerHTML = `<div class="err">${esc(kt.error)}</div>`; return null; }
        row.knowledge_test = { tests: kt.tests, aktr: kt.aktr };
        if (Number.isNaN(row.ground_time) || Number.isNaN(row.flight_time)) { qs('#err', bg).innerHTML = '<div class="err">Ground and flight time must be hours between 0 and 24, for example 1.5.</div>'; return null; }
        return row;
      };
      f.addEventListener('submit', async (e) => {
        e.preventDefault(); const row = read(); if (!row) return;
        try {
          await act(qs('button[type=submit]', f), () => isNew ? q(sb.from('checkrides').insert(Object.assign(row, { org_id: S.orgId, created_by: S.ctx.user_id, examiner_id: can('examiner') ? S.ctx.user_id : null })).select('id').single()) : q(sb.from('checkrides').update(row).eq('id', cr.id).select('id').single()), 'Saved');
          close(); done && done();
        } catch (_) {}
      });
      const dup = qs('#dup', bg); if (dup) dup.onclick = async () => {
        const row = read(); if (!row) return;
        Object.assign(row, { test_type: RETEST_OF[row.test_type] || row.test_type, result: null, ground_time: null, flight_time: null, scheduled_at: null, notes: null, preapproval_number: null, iacra_app_id: null });
        try { await act(dup, () => q(sb.from('checkrides').insert(Object.assign(row, { org_id: S.orgId, created_by: S.ctx.user_id })).select('id').single()), 'Retest record created; set the date'); close(); done && done(); } catch (_) {}
      };
      const pb = qs('#poa', bg); if (pb) pb.onclick = () => { close(); go('#/poa/new?checkride=' + cr.id); };
      const del = qs('#del', bg); if (del) del.onclick = () => { close(); deleteCheckride(cr, null, done); };
    });
  }

  // Delete a checkride; when it has a plan of action the admin chooses whether the plan (and its result) goes too.
  async function deleteCheckride(cr, plans, done) {
    let pl = cr.poa_id ? (plans && plans[cr.poa_id]) : null;
    if (cr.poa_id && !pl) { try { pl = await q(sb.from('poas').select('id,title,status').eq('id', cr.poa_id).maybeSingle()); } catch (_) {} }
    modal(`<h2>Delete checkride?</h2><p class="sm">${esc([cr.test_type, GRADES[cr.grade_sought], cr.class, cr.scheduled_at ? fmtDT(cr.scheduled_at) : ''].filter(Boolean).join(' · '))}</p>
      ${pl ? `<label class="check sm"><input type="checkbox" id="wp"> Also delete its plan of action "${esc(pl.title)}" (${esc(pl.status)}) and any recorded result</label>` : ''}
      <p class="xs muted">This cannot be undone. The audit log keeps a record of the deletion.</p>
      <div class="btn-row" style="justify-content:flex-end"><button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="ok">Delete</button></div>`, (bg, close) => {
      qs('#ok', bg).onclick = async () => { const wp = qs('#wp', bg); try { await act(qs('#ok', bg), () => A.rpc('delete_checkride', { p_id: cr.id, p_with_plan: !!(wp && wp.checked) }), 'Deleted'); close(); done && done(); } catch (_) {} };
    });
  }

  // ---------- outcome reports ----------
  async function viewCheckrideReports() {
    const c = shell('reports'); if (!org()) return noOrg(c);
    if (!can('org_admin', 'examiner', 'auditor')) { c.innerHTML = '<div class="banner warn">Outcome reports are available to examiners, administrators and auditors.</div>'; return; }
    const [rows, apps] = await Promise.all([q(sb.from('checkrides').select('*').eq('org_id', S.orgId)), q(sb.from('applicants').select('id,first_name,last_name,school,recommending_instructor').eq('org_id', S.orgId))]);
    const AP = Object.fromEntries(apps.map((a) => [a.id, a]));
    const schools = Array.from(new Set(apps.map((a) => a.school).filter(Boolean))).sort();
    const cfis = Array.from(new Set(apps.map((a) => a.recommending_instructor).filter(Boolean))).sort();
    const st = { type: '', grade: '', cls: '', school: '', cfi: '', from: '', to: '' };
    c.innerHTML = head('Checkride outcomes', 'Results, pass rate and average ground and flight time from checkride records. Pass rate = temporary certificates / (temporary certificates + disapprovals).', '<a class="btn ghost" href="#/reports">Debrief reports</a><button class="btn ghost" id="csv">Export CSV</button>') +
      `<div class="card"><div class="form-grid3" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
      <label>Test type<select id="r1"><option value="">All</option>${TEST_TYPES.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
      <label>Grade<select id="r2"><option value="">All</option>${Object.entries(GRADES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label>Class<select id="r3"><option value="">All</option>${CLASSES.map((x) => `<option>${x}</option>`).join('')}</select></label>
      <label>School<select id="r4"><option value="">All</option>${schools.map((x) => `<option>${esc(x)}</option>`).join('')}</select></label>
      <label>Instructor<select id="r5"><option value="">All</option>${cfis.map((x) => `<option>${esc(x)}</option>`).join('')}</select></label>
      <label>From<input type="date" id="r6"></label><label>To<input type="date" id="r7"></label></div></div><div id="rep"></div>`;
    let list = [];
    const render = () => {
      list = rows.filter((r) => { const a = AP[r.applicant_id] || {}; const d = (r.scheduled_at || '').slice(0, 10);
        return (!st.type || r.test_type === st.type) && (!st.grade || r.grade_sought === st.grade) && (!st.cls || r.class === st.cls) && (!st.school || a.school === st.school) && (!st.cfi || a.recommending_instructor === st.cfi) && (!st.from || d >= st.from) && (!st.to || (d && d <= st.to)); });
      const n = (k) => list.filter((r) => r.result === k).length;
      const T = n('temporary'), D = n('disapproval'), L = n('discontinuance'), X = n('cancelled'), open = list.filter((r) => !r.result).length;
      const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '—';
      const avg = (k) => { const v = list.filter((r) => r.result && r.result !== 'cancelled' && r[k] != null).map((r) => +r[k]); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) + ' h' : '—'; };
      const group = (fn) => { const g = {}; list.forEach((r) => { const k = fn(r) || 'Not recorded'; g[k] = g[k] || { n: 0, t: 0, d: 0, l: 0, x: 0 }; g[k].n++; if (r.result === 'temporary') g[k].t++; if (r.result === 'disapproval') g[k].d++; if (r.result === 'discontinuance') g[k].l++; if (r.result === 'cancelled') g[k].x++; }); return Object.entries(g).sort((a, b) => b[1].n - a[1].n); };
      const tbl = (title, rowsG) => `<div class="card"><h2>${title}</h2>${rowsG.length ? `<div class="table-wrap"><table class="t"><thead><tr><th></th><th>Records</th><th>Temporary</th><th>Disapproval</th><th>Discontinuance</th><th>Cancelled</th><th>Pass rate</th></tr></thead>${rowsG.map(([k, v]) => `<tr><td class="sm">${esc(k)}</td><td>${v.n}</td><td>${v.t}</td><td>${v.d}</td><td>${v.l}</td><td>${v.x}</td><td>${pct(v.t, v.t + v.d)}</td></tr>`).join('')}</table></div>` : '<div class="empty sm">No data.</div>'}</div>`;
      const months = {}; list.filter((r) => r.result && r.scheduled_at).forEach((r) => { const k = r.scheduled_at.slice(0, 7); months[k] = months[k] || { temporary: 0, disapproval: 0, discontinuance: 0, cancelled: 0 }; months[k][r.result]++; });
      const mk = Object.keys(months).sort().slice(-12); const mmax = Math.max(1, ...mk.map((k) => Object.values(months[k]).reduce((a, b) => a + b, 0)));
      qs('#rep', c).innerHTML = `<div class="kpis">
        <div class="kpi"><div class="kpi-label">Records</div><div class="kpi-value">${list.length}</div><div class="kpi-note">${open} without a result yet</div></div>
        <div class="kpi"><div class="kpi-label">Pass rate</div><div class="kpi-value">${pct(T, T + D)}</div><div class="kpi-note">${T} temporary · ${D} disapproval</div></div>
        <div class="kpi"><div class="kpi-label">Average ground time</div><div class="kpi-value">${avg('ground_time')}</div><div class="kpi-note">Completed tests</div></div>
        <div class="kpi"><div class="kpi-label">Average flight time</div><div class="kpi-value">${avg('flight_time')}</div><div class="kpi-note">${L} discontinued · ${X} cancelled</div></div></div>
        <div class="grid2"><div class="card"><h2>Result summary</h2><div class="bars">${Object.entries(RESULTS).map(([k, v]) => { const x = n(k); return `<div class="bar"><span class="xs">${esc(v)}</span><div><i style="width:${list.length ? 100 * x / Math.max(1, T, D, L, X) : 0}%"></i></div><b class="xs">${x}</b></div>`; }).join('')}</div></div>
        <div class="card"><h2>Results by month</h2>${mk.length ? `<div class="cols">${mk.map((k) => { const m = months[k]; return `<div class="col"><div class="stack" style="height:140px">${[['cancelled', 'discontinued'], ['discontinuance', 'discontinued'], ['disapproval', 'fail'], ['temporary', 'pass']].map(([o, cls]) => `<i class="o-${cls}" style="height:${100 * m[o] / mmax}%;${o === 'cancelled' ? 'opacity:.35' : ''}" title="${RESULTS[o]}: ${m[o]}"></i>`).join('')}</div><span class="xs">${esc(k.slice(2))}</span></div>`; }).join('')}</div><div class="legend xs"><i class="o-pass"></i> Temporary <i class="o-fail"></i> Disapproval <i class="o-discontinued"></i> Discontinuance / cancelled (light)</div>` : '<div class="empty sm">No results recorded.</div>'}</div></div>
        ${tbl('By grade sought', group((r) => GRADES[r.grade_sought]))}
        <div class="grid2">${tbl('By test type', group((r) => r.test_type))}${tbl('By class', group((r) => r.class))}</div>
        ${tbl('By recommending instructor', group((r) => (AP[r.applicant_id] || {}).recommending_instructor))}
        ${tbl('By flight school', group((r) => (AP[r.applicant_id] || {}).school))}`;
    };
    [['#r1', 'type'], ['#r2', 'grade'], ['#r3', 'cls'], ['#r4', 'school'], ['#r5', 'cfi'], ['#r6', 'from'], ['#r7', 'to']].forEach(([s, k]) => { qs(s, c).onchange = (e) => { st[k] = e.target.value; render(); }; });
    qs('#csv', c).onclick = () => {
      const out = [['scheduled_at', 'applicant', 'school', 'recommending_instructor', 'grade_sought', 'class', 'test_type', 'basis', 'departure_airport', 'aircraft', 'tail', 'result', 'ground_time', 'flight_time']];
      list.forEach((r) => { const a = AP[r.applicant_id] || {}; out.push([r.scheduled_at, a.last_name ? a.last_name + ', ' + a.first_name : '', a.school, a.recommending_instructor, GRADES[r.grade_sought], r.class, r.test_type, r.basis, r.departure_airport, r.aircraft_make_model, r.tail_number, RESULTS[r.result] || '', r.ground_time, r.flight_time]); });
      const csv = out.map((r) => r.map((v) => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'smartpoa-checkrides-' + today() + '.csv'; a.click();
    };
    render();
  }

  // ---------- organization settings ----------
  const PROFILE_FIELDS = [['preference', 'Scenario preference', 'scenarioPreferences'], ['weather', 'Weather', 'weather'], ['pilot', 'Pilot factors', 'pilotFactors'], ['aircraftFactors', 'Aircraft factors', 'aircraftFactors'],
    ['environment', 'Environmental factors', 'environmentalFactors'], ['pressures', 'External pressures', 'externalPressures'], ['difficulty', 'Difficulty adjustment', 'difficultyAdjustment']];
  const STYLE_FIELDS = [['tone', 'Tone', 'tone'], ['detail', 'Detail level', 'detailLevel'], ['language', 'Language complexity', 'languageComplexity'], ['narrative', 'Narrative style', 'narrativeStyle'], ['risk', 'Risk emphasis', 'riskEmphasis']];
  async function viewOrgSettings(m, params) {
    const c = shell('orgsettings'); if (!org()) return noOrg(c);
    if (!can('org_admin')) { c.innerHTML = '<div class="banner warn">Organization settings are managed by organization administrators.</div>'; return; }
    const [O, st] = await Promise.all([loadOpts(), orgSettings()]);
    const prof = st.scenario_profiles || {}; const sty = st.ai_style || {}; const br = st.briefings || {};
    let grade = 'private'; await loadBriefReq(); const rq = { g: params && params.get('g') || 'private', t: params && params.get('t') || 'Original Certificate' };
    const sel = (opts, v, nm, allowFree) => { const list = (opts || []).slice(); if (v && !list.includes(v)) list.unshift(v); return `<select name="${nm}"><option value="">${allowFree ? 'None' : 'Select…'}</option>${list.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`; };
    const TABS = [['drafting', 'Scenarios and AI'], ['checklists', 'Pre-test checklists'], ['briefings', 'Briefing scripts']];
    let tab = params && (params.get('g') || params.get('t')) ? 'checklists' : (params && params.get('tab')) || 'drafting';
    let brk = 'pretest';
    const BRIEFS = [['pretest', 'Pretest', 'Pretest briefing'], ['preflight', 'Preflight', 'Preflight briefing'], ['postflight', 'Postflight', 'Postflight debriefing']];
    const nSet = (o) => Object.keys(o || {}).filter((k) => k !== 'temperature').length;
    const render = () => {
      const p = prof[grade] || {};
      const body = tab === 'drafting' ? `<div class="card"><form id="pf">
          <div class="card-head" style="align-items:flex-end"><div><h2>Scenario profile</h2><p class="xs muted" style="margin:.15rem 0 0">Optional. Fields left on "None" are chosen by the AI draft.</p></div>
          <label style="margin:0;min-width:240px">Grade<select id="g" style="margin:.2rem 0 0">${Object.entries(GRADES).map(([k, v]) => `<option value="${k}" ${k === grade ? 'selected' : ''}>${v}${nSet(prof[k]) ? ' (customized)' : ''}</option>`).join('')}</select></label></div>
          <div class="form-grid">${PROFILE_FIELDS.map(([k, l, o]) => `<label>${l}${sel(O[o], p[k], k, true)}</label>`).join('')}
          <label>Planned arrival airport<input name="arrival" maxlength="5" value="${esc(p.arrival)}" placeholder="e.g. KBNA"></label></div>
          <details class="os-more" ${nSet(sty) ? 'open' : ''}><summary class="sm strong">Writing style (all grades)${nSet(sty) ? ` <span class="pill ok">${nSet(sty)} set</span>` : ''}</summary>
          <div class="form-grid3" style="margin-top:.5rem">${STYLE_FIELDS.map(([k, l, o]) => `<label>${l}${sel(O[o], sty[k], k, true)}</label>`).join('')}<label>Creativity${sel(O.temperature, sty.temperatureLabel, 'temperature', true)}</label></div></details>
          <p class="xs muted">AI drafts go to xAI (Grok) with standards text, airports and aircraft model only. No applicant information is sent. Examiners review every draft.</p>
          <div class="btn-row" style="justify-content:flex-end"><button class="btn">Save</button></div></form></div>`
        : tab === 'checklists' ? `<div class="card" id="breq"><h2>Pre-test checklists</h2><p class="xs muted" style="margin-top:0">Endorsements and aeronautical experience shown on the plan review and the printed plan.</p>
          <form id="rf"><div class="form-grid"><label>Grade<select name="g">${Object.entries(GRADES).map(([k, v]) => `<option value="${k}" ${k === rq.g ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Type of practical test<select name="t">${TEST_TYPES.map((t) => `<option ${t === rq.t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label></div>
          ${(() => { const cur = briefReqFor(rq.g, rq.t); const exact = cur && cur.test_type === rq.t; return `<p class="sm">${!cur ? '<span class="pill warn">None yet</span> No checklist exists for this test.' : exact ? (cur.org ? '<span class="pill ok">Organization list</span>' : '<span class="pill">Imported list</span> Saving makes an organization copy.') : '<span class="pill warn">None yet</span> This test uses the ' + esc(cur.test_type) + ' list.'}</p>
          <div class="form-grid"><label>Endorsements required<textarea name="e" style="min-height:180px" placeholder="One item per line. Start a line with - for a sub-item.">${esc(exact ? cur.endorsements.join('\n') : '')}</textarea></label><label>Aeronautical experience required<textarea name="x" style="min-height:180px" placeholder="One item per line. Start a line with - for a sub-item.">${esc(exact ? cur.experience.join('\n') : '')}</textarea></label></div>
          <p class="xs muted">To go back to the imported list, clear both boxes and save.</p>`; })()}
          <div id="aiCk"></div><div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn ghost" id="aiDraft">Draft with AI</button><button class="btn" id="ckSave">Save checklist</button></div></form></div>`
        : (() => { const custom = !!(br[brk] || '').trim(); const B = BRIEFS.find((x) => x[0] === brk); return `<div class="card"><div class="card-head"><h2>Briefing scripts</h2><div class="seg" role="group" aria-label="Script">${BRIEFS.map(([k, l]) => `<button type="button" data-b="${k}" class="${k === brk ? 'on' : ''}">${l}${(br[k] || '').trim() ? ' (custom)' : ''}</button>`).join('')}</div></div>
          <p class="xs muted" style="margin-top:0">New plans of action start with these scripts. {std} is replaced by the standard number.</p>
          <form id="bf"><p class="sm">${custom ? '<span class="pill ok">Customized</span>' : '<span class="pill">smartPOA default</span> Edit and save to customize it.'}</p>
          <label>${B[2]}<textarea name="txt" style="min-height:340px">${esc(custom ? br[brk] : E.DEFAULT_BRIEFINGS[brk])}</textarea></label>
          <div class="btn-row" style="justify-content:flex-end">${custom ? '<button type="button" class="btn ghost" id="bReset">Reset to default</button>' : ''}<button class="btn">Save</button></div></form></div>`; })();
      c.innerHTML = head('Organization settings', 'Defaults used when examiners build a plan of action.') +
        `<div class="os-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" aria-selected="${k === tab}" class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>${body}`;
      qsa('[data-tab]', c).forEach((t) => t.onclick = () => { tab = t.dataset.tab; render(); });
      const saveSt = async (b) => { await act(b, () => q(sb.from('orgs').update({ settings: st }).eq('id', S.orgId).select('id').single()), 'Saved'); };
      if (tab === 'drafting') {
        qs('#g', c).onchange = (e) => { grade = e.target.value; render(); };
        qs('#pf', c).onsubmit = async (e) => { e.preventDefault(); const f = e.target; const v = {}; PROFILE_FIELDS.forEach(([k]) => { if (f[k].value) v[k] = f[k].value; }); if (f.arrival.value.trim()) v.arrival = f.arrival.value.trim().toUpperCase(); prof[grade] = v; st.scenario_profiles = prof;
          const w = {}; STYLE_FIELDS.forEach(([k]) => { if (f[k].value) w[k] = f[k].value; }); if (f.temperature.value) { w.temperatureLabel = f.temperature.value; w.temperature = parseFloat(f.temperature.value); } Object.keys(sty).forEach((k) => delete sty[k]); Object.assign(sty, w); st.ai_style = sty;
          try { await saveSt(qs('.btn-row .btn', f)); render(); } catch (_) {} };
        return;
      }
      if (tab === 'briefings') {
        qsa('[data-b]', c).forEach((b) => b.onclick = () => { brk = b.dataset.b; render(); });
        const bf = qs('#bf', c);
        bf.onsubmit = async (e) => { e.preventDefault(); const t = bf.txt.value; if (t.trim() && t.trim() !== E.DEFAULT_BRIEFINGS[brk].trim()) br[brk] = t; else delete br[brk]; st.briefings = br; try { await saveSt(qs('.btn-row .btn:not(.ghost)', bf)); render(); } catch (_) {} };
        const rs = qs('#bReset', c); if (rs) rs.onclick = async () => { if (!(await A.confirmBox('Reset to the default script?', 'New plans will use the smartPOA default. Existing plans keep their own text.', 'Reset'))) return; delete br[brk]; st.briefings = br; try { await saveSt(rs); render(); } catch (_) {} };
        return;
      }
      const rf = qs('#rf', c); rf.g.onchange = rf.t.onchange = () => { rq.g = rf.g.value; rq.t = rf.t.value; render(); qs('#breq', c).scrollIntoView(); };
      qs('#aiDraft', c).onclick = async (e) => {
        if ((rf.e.value.trim() || rf.x.value.trim()) && !(await A.confirmBox('Replace the current text?', 'The endorsements and experience boxes will be replaced with an AI draft. Nothing is saved until you press Save checklist.', 'Replace'))) return;
        const cur = briefReqFor(rq.g, rq.t); const example = cur ? [].concat(cur.endorsements, cur.experience).slice(0, 40) : [];
        try {
          const r = await A.act(e.target, () => ai('pretest_checklist', { grade: GRADES[rq.g] || rq.g, testType: rq.t, example }), null);
          rf.e.value = (r.endorsements || []).join('\n'); rf.x.value = (r.experience || []).join('\n');
          qs('#aiCk', c).innerHTML = '<div class="banner warn">AI draft from Grok. Check every line against 14 CFR part 61 and AC 61-65 before you save. Nothing is saved until you press Save checklist.</div>';
        } catch (_) {}
      };
      rf.onsubmit = async (e) => { e.preventDefault(); const lines = (v) => v.split('\n').map((x) => x.trim()).filter(Boolean);
        const v = { endorsements: lines(rf.e.value), experience: lines(rf.x.value) }; const all = Object.assign({}, st.brief_req || {});
        if (v.endorsements.length || v.experience.length) all[rq.g + '|' + rq.t] = v; else delete all[rq.g + '|' + rq.t];
        st.brief_req = all; try { await saveSt(qs('#ckSave', rf)); ORGBR = all; render(); qs('#breq', c).scrollIntoView(); } catch (_) {} };
    };
    render();
  }

  Object.assign(A, { ai, orgSettings, loadBriefReq, briefReqFor, CR: { TEST_TYPES, RESULTS, GRADES, PURPOSE_OF, resultPill, checkrideForm, deleteCheckride } });

  // ---------- past checkrides (examiner history) ----------
  async function viewPastCheckrides(m, params) {
    const c = shell('past-checkrides'); if (!org()) return noOrg(c);
    if (!can('org_admin', 'examiner', 'auditor')) { c.innerHTML = '<div class="banner warn">Past checkrides are available to examiners, administrators and auditors.</div>'; return; }
    const [all, apps] = await Promise.all([
      q(sb.from('checkrides').select('*').eq('org_id', S.orgId).order('scheduled_at', { ascending: false })),
      q(sb.from('applicants').select('*').eq('org_id', S.orgId).order('last_name')),
    ]);
    const AP = Object.fromEntries(apps.map((a) => [a.id, a]));
    const nowIso = new Date().toISOString();
    const rows = all.filter((r) => r.result || (r.scheduled_at && r.scheduled_at < nowIso));
    // attempt numbers per applicant and grade (cancelled bookings are not attempts)
    const att = {}; const tot = {};
    rows.slice().sort((a, b) => (a.scheduled_at || '').localeCompare(b.scheduled_at || '')).forEach((r) => {
      if (!r.applicant_id || r.result === 'cancelled') return; const k = r.applicant_id + '|' + r.grade_sought; tot[k] = (tot[k] || 0) + 1; att[r.id] = tot[k]; });
    const attemptOf = (r) => { const k = r.applicant_id + '|' + r.grade_sought; return att[r.id] && tot[k] > 1 ? `Attempt ${att[r.id]} of ${tot[k]}` : ''; };
    const years = Array.from(new Set(rows.map((r) => (r.scheduled_at || '').slice(0, 4)).filter(Boolean))).sort().reverse();
    const schools = Array.from(new Set(apps.map((a) => a.school).filter(Boolean))).sort();
    const st = { qq: '', result: params.get('result') || '', grade: '', cls: '', type: '', school: '', year: '' };
    const sel = (id, label, opts) => `<label>${label}<select id="${id}"><option value="">All</option>${opts}</select></label>`;
    c.innerHTML = head('Past checkrides', 'Every checkride you have conducted, including records brought over from the previous system. Select a row to open the full record.',
      '<a class="btn ghost" href="#/checkride-reports">Outcome report</a><button class="btn ghost" id="csv">Export CSV</button>') +
      `<div class="kpis" id="pk"></div>
      <div class="card"><div class="form-grid3" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
        <label>Search<input id="p0" type="search" placeholder="Name, FTN or tail"></label>
        ${sel('p1', 'Result', Object.entries(RESULTS).map(([k, v]) => `<option value="${k}" ${st.result === k ? 'selected' : ''}>${esc(v)}</option>`).join('') + `<option value="none" ${st.result === 'none' ? 'selected' : ''}>No result recorded</option>`)}
        ${sel('p2', 'Grade', Object.entries(GRADES).map(([k, v]) => `<option value="${k}">${v}</option>`).join(''))}
        ${sel('p3', 'Class', CLASSES.map((x) => `<option>${x}</option>`).join(''))}
        ${sel('p4', 'Test type', TEST_TYPES.map((t) => `<option>${esc(t)}</option>`).join(''))}
        ${sel('p5', 'Flight school', schools.map((x) => `<option>${esc(x)}</option>`).join(''))}
        ${sel('p6', 'Year', years.map((y) => `<option>${y}</option>`).join(''))}
      </div></div>
      <div class="card flush"><div class="table-wrap"><table class="t" id="pt"><thead><tr><th>Date</th><th>Applicant</th><th>Certificate</th><th>Test type</th><th>Aircraft</th><th>Result</th><th>Ground / flight</th></tr></thead><tbody></tbody></table></div><div class="xs muted" id="pc" style="padding:.6rem 1rem"></div></div>`;
    let list = [];
    const render = () => {
      const needle = st.qq.toLowerCase();
      list = rows.filter((r) => { const a = AP[r.applicant_id] || {};
        if (st.result && (st.result === 'none' ? r.result : r.result !== st.result)) return false;
        if (st.grade && r.grade_sought !== st.grade) return false;
        if (st.cls && r.class !== st.cls) return false;
        if (st.type && r.test_type !== st.type) return false;
        if (st.school && a.school !== st.school) return false;
        if (st.year && (r.scheduled_at || '').slice(0, 4) !== st.year) return false;
        if (needle && ![a.first_name, a.last_name, a.ftn, r.preapproval_number, r.tail_number, r.aircraft_make_model, a.recommending_instructor].join(' ').toLowerCase().includes(needle)) return false;
        return true; });
      const n = (k) => list.filter((r) => r.result === k).length;
      const T = n('temporary'), D = n('disapproval'), L = n('discontinuance'), X = n('cancelled'), O = list.filter((r) => !r.result).length;
      const kpi = (l, v, note, res) => `<button type="button" class="kpi kpi-btn${st.result === res && res ? ' on' : ''}" data-r="${res}" aria-pressed="${st.result === res && !!res}"><div class="kpi-label">${l}</div><div class="kpi-value">${v}</div><div class="kpi-note">${note}</div></button>`;
      qs('#pk', c).innerHTML = kpi('Checkrides', list.length, 'Matching the filters', '') + kpi('Passed', T, (T + D ? Math.round(100 * T / (T + D)) + '% pass rate' : 'Temporary certificate'), 'temporary') +
        kpi('Disapproved', D, 'Notice of Disapproval', 'disapproval') + kpi('Discontinued', L, 'Letter of Discontinuance', 'discontinuance') + kpi('Cancelled', X, 'Not conducted', 'cancelled') +
        kpi('No result', O, O ? 'Needs an outcome' : 'All recorded', 'none');
      qsa('#pk [data-r]', c).forEach((k) => k.onclick = () => { st.result = st.result === k.dataset.r ? '' : k.dataset.r; qs('#p1', c).value = st.result; render(); });
      qs('#pt tbody', c).innerHTML = list.length ? list.map((r) => { const a = AP[r.applicant_id];
        return `<tr class="click" data-id="${r.id}"><td class="sm" style="white-space:nowrap">${esc(fmtDate((r.scheduled_at || '').slice(0, 10)) || '—')}</td>
          <td>${a ? `<a class="strong sm" href="#/applicant/${a.id}" data-stop>${esc(name(a))}</a>` : '<span class="sm muted">No applicant</span>'}<div class="xs muted">${esc([a && a.school, attemptOf(r)].filter(Boolean).join(' · '))}</div></td>
          <td class="sm">${esc(GRADES[r.grade_sought] || '—')}<div class="xs muted">${esc(r.class || '')}</div></td>
          <td class="sm">${esc(r.test_type)}${r.source === 'airtable_import' ? '<div class="xs muted">Imported</div>' : ''}</td>
          <td class="sm">${esc(r.aircraft_make_model || '—')}<div class="xs muted mono">${esc(r.tail_number || '')}</div></td>
          <td>${r.result ? resultPill(r.result) : '<span class="pill warn">No result</span>'}${r.notes ? `<div class="xs muted" style="max-width:220px">${esc(r.notes.length > 70 ? r.notes.slice(0, 70) + '…' : r.notes)}</div>` : ''}</td>
          <td class="sm mono">${r.ground_time != null || r.flight_time != null ? esc((hrs(r.ground_time) || '—') + ' / ' + (hrs(r.flight_time) || '—')) : '—'}</td></tr>`; }).join('')
        : '<tr><td colspan="7"><div class="empty"><span class="strong">No past checkrides match</span>Clear a filter to see more.</div></td></tr>';
      qs('#pc', c).textContent = list.length + ' of ' + rows.length + ' past checkride record(s)';
      qsa('#pt [data-stop]', c).forEach((x) => x.onclick = (e) => e.stopPropagation());
      qsa('#pt tr[data-id]', c).forEach((tr) => tr.onclick = () => checkrideForm(rows.find((r) => r.id === tr.dataset.id), apps, () => viewPastCheckrides(m, params)));
    };
    qs('#p0', c).oninput = (e) => { st.qq = e.target.value.trim(); render(); };
    [['#p1', 'result'], ['#p2', 'grade'], ['#p3', 'cls'], ['#p4', 'type'], ['#p5', 'school'], ['#p6', 'year']].forEach(([s, k]) => { qs(s, c).onchange = (e) => { st[k] = e.target.value; render(); }; });
    qs('#csv', c).onclick = () => {
      const out = [['date', 'applicant', 'ftn', 'school', 'recommending_instructor', 'grade_sought', 'class', 'test_type', 'basis', 'preapproval', 'departure_airport', 'aircraft', 'tail', 'result', 'ground_time', 'flight_time', 'notes', 'source']];
      list.forEach((r) => { const a = AP[r.applicant_id] || {}; out.push([(r.scheduled_at || '').slice(0, 10), a.last_name ? a.last_name + ', ' + a.first_name : '', a.ftn, a.school, a.recommending_instructor, GRADES[r.grade_sought], r.class, r.test_type, r.basis, r.preapproval_number, r.departure_airport, r.aircraft_make_model, r.tail_number, RESULTS[r.result] || '', r.ground_time, r.flight_time, r.notes, r.source]); });
      const csv = out.map((r) => r.map((v) => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'smartpoa-past-checkrides-' + today() + '.csv'; a.click();
    };
    render();
  }

  A.addRoute(/^\/schedule$/, viewSchedule);
  A.addRoute(/^\/past-checkrides$/, viewPastCheckrides);
  A.addRoute(/^\/checkride-reports$/, viewCheckrideReports);
  A.addRoute(/^\/org-settings$/, viewOrgSettings);
})();

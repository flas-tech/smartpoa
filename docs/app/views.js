/* smartPOA secondary views: debrief, question bank, reports, members, settings, standards, audit, platform. */
(function () {
  'use strict';
  const A = window.SPOA; const E = window.SPE; const C = window.SPOA_CONFIG;
  const { sb, S, esc, qs, qsa, fmtDate, fmtDT, today, uid, rpc, q, act, toast, friendly, go, org, can, isOwner, shell, head, modal, confirmBox, loadStd, stdDoc, bindRows, statusPill, outcomePill, ROLE_LABEL, ROLE_DESC, noOrg } = A;
  const OUTCOME = { pass: 'Pass — certificate / rating issued', fail: 'Disapproved — Notice of Disapproval', discontinued: 'Discontinued — Letter of Discontinuance', incomplete: 'Incomplete (not yet finished)' };

  // ---------- debrief (tablet / paper transcription) ----------
  const QKEY = 'spoa_dbq';
  const queue = () => { try { return JSON.parse(localStorage.getItem(QKEY) || '{}'); } catch (_) { return {}; } };
  async function flushQueue() {
    const qq = queue(); const ids = Object.keys(qq); if (!ids.length || !navigator.onLine) return;
    for (const id of ids) {
      try { await q(sb.from('debriefs').update(qq[id]).eq('id', id)); const n = queue(); delete n[id]; localStorage.setItem(QKEY, JSON.stringify(n)); } catch (e) { if (/locked/i.test(e.message)) { const n = queue(); delete n[id]; localStorage.setItem(QKEY, JSON.stringify(n)); } }
    }
  }
  window.addEventListener('online', flushQueue);
  setInterval(flushQueue, 30000);

  async function viewDebrief(m, params) {
    const poaId = m[1];
    const c = shell('poas');
    await loadStd();
    const p = await q(sb.from('poas').select('*').eq('id', poaId).single());
    const doc = stdDoc(p.standard_id);
    const app = p.applicant_id ? await q(sb.from('applicants').select('id,first_name,last_name,ftn').eq('id', p.applicant_id).single()) : null;
    let d = (await q(sb.from('debriefs').select('*').eq('poa_id', poaId).order('created_at', { ascending: false }).limit(1)))[0];
    if (!d) {
      if (!can('org_admin', 'examiner')) { c.innerHTML = '<div class="banner warn">No debrief has been started for this plan.</div>'; return; }
      if (p.status !== 'final') { c.innerHTML = '<div class="banner warn">Finalize the plan of action before starting the checkride.</div>'; return; }
      try { d = await q(sb.from('debriefs').insert({ org_id: p.org_id, poa_id: p.id, applicant_id: p.applicant_id, examiner_id: S.ctx.user_id, entry_mode: params.get('paper') ? 'paper' : 'tablet', test_date: p.test_date || today(), results: {} }).select().single()); }
      catch (e) { d = (await q(sb.from('debriefs').select('*').eq('poa_id', poaId).limit(1)))[0]; if (!d) throw e; }
    }
    const pending = queue()[d.id]; if (pending) Object.assign(d, pending);
    const locked = d.status === 'signed' || !can('org_admin', 'examiner');
    const tasks = E.requiredTasks(doc, p.test_profile).filter((t) => p.content.tasks[t.key] && p.content.tasks[t.key].included);
    d.results = d.results || {};
    if (locked) { const fix = (st, en, m) => en || (st ? new Date(new Date(st).getTime() + (m || 0) * 60000).toISOString() : null);
      d.ground_end = fix(d.ground_start, d.ground_end, d.oral_minutes); d.flight_end = fix(d.flight_start, d.flight_end, d.flight_minutes != null ? d.flight_minutes : Math.round((d.flight_hours || 0) * 60)); }
    let saveT;
    const unsat = () => { const s = new Set(); tasks.forEach((t) => { const r = d.results[t.key]; if (r && r.grade === 'U') (r.codes || []).forEach((x) => s.add(x)); }); return Array.from(s); };
    const save = () => {
      if (locked) return; clearTimeout(saveT);
      const st = qs('#dbSave', c); if (st) st.textContent = 'Saving…';
      saveT = setTimeout(async () => {
        const patch = { results: d.results, outcome: d.outcome || null, unsat_codes: unsat(), remarks: d.remarks || null, oral_minutes: d.oral_minutes ?? null, flight_hours: d.flight_hours ?? null, flight_minutes: d.flight_minutes ?? null, ground_start: d.ground_start || null, flight_start: d.flight_start || null, ground_end: d.ground_end || null, flight_end: d.flight_end || null, hobbs_start: d.hobbs_start ?? null, hobbs_end: d.hobbs_end ?? null, test_date: d.test_date || null, entry_mode: d.entry_mode };
        const qq = queue(); qq[d.id] = patch; localStorage.setItem(QKEY, JSON.stringify(qq));
        if (!navigator.onLine) { if (qs('#dbSave', c)) qs('#dbSave', c).textContent = 'Offline — saved on this device'; return; }
        try { await q(sb.from('debriefs').update(patch).eq('id', d.id)); const n = queue(); delete n[d.id]; localStorage.setItem(QKEY, JSON.stringify(n)); if (qs('#dbSave', c)) qs('#dbSave', c).textContent = 'Saved ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
        catch (e) { if (qs('#dbSave', c)) qs('#dbSave', c).textContent = 'Saved on this device; will retry'; }
      }, 500);
    };
    const pad = (n) => String(n).padStart(2, '0');
    const hhmm = (m) => m == null || m === '' || isNaN(m) ? '' : pad(Math.floor(m / 60)) + ':' + pad(Math.round(m) % 60);
    const parseHM = (v) => { v = String(v || '').trim(); if (!v) return null; let m = v.match(/^(\d{1,2}):([0-5]\d)$/); if (m) return +m[1] * 60 + +m[2];
      m = v.match(/^(\d{1,2})([0-5]\d)$/); if (m && v.length >= 3) return +m[1] * 60 + +m[2]; return undefined; };
    const clock = (st, en) => { if (!st) return '00:00:00'; const t = Math.max(0, Math.floor(((en ? new Date(en) : Date.now()) - new Date(st)) / 1000)); return pad(Math.floor(t / 3600)) + ':' + pad(Math.floor(t / 60) % 60) + ':' + pad(t % 60); };
    const mins = (st, en) => Math.max(0, Math.round(((en ? new Date(en) : Date.now()) - new Date(st)) / 60000));
    const hobbs = () => (d.hobbs_start != null && d.hobbs_end != null && +d.hobbs_end >= +d.hobbs_start) ? Math.round((+d.hobbs_end - +d.hobbs_start) * 10) / 10 : null;
    const hobbsNote = () => { const h = hobbs(); if (d.hobbs_start != null && d.hobbs_end != null && h == null) return 'Hobbs end must be at or above Hobbs start.'; return h != null ? 'Hobbs ' + h.toFixed(1) + ' hours = ' + hhmm(Math.round(h * 60)) + ' flight time.' : 'Enter Hobbs start and end to fill flight time automatically.'; };
    const setFlight = (m) => { d.flight_minutes = m; d.flight_hours = m == null ? null : Math.round(m / 6) / 10; };
    const graded = () => tasks.filter((t) => d.results[t.key] && d.results[t.key].grade).length;
    // Expandable task detail: the quoted standard for what was planned, so the examiner can grade against it.
    const openK = new Set();
    const LEAD = { K: 'Knowledge — the applicant demonstrates understanding of:', R: 'Risk management — the applicant is able to identify, assess, and mitigate risk associated with:', S: 'Skills — the applicant exhibits the skill to:', O: 'Objective — the applicant:' };
    const elText = {};
    const apx = E.appendixFor(doc, { profile: p.test_profile, content: p.content || {}, tasks });
    const apxNote = ((p.content || {}).appendix || {}).note || {};
    const apxHtml = (key) => apx.items.filter((it) => (it.tasks || []).includes(key)).map((it) => `<div class="db-sec apx-task"><span class="pill warn">Appendix requirement</span> <b class="sm">${esc(it.head)}</b>${it.text && it.text !== it.head ? `<div class="xs muted">${esc(it.text)}</div>` : ''}<div class="sm"><b>How this will be met:</b> ${apxNote[it.id] ? esc(apxNote[it.id]) : '<span class="muted">No note entered on the plan.</span>'}</div></div>`).join('');
    const isOralM = (m) => (m || 'oral') === 'oral' || m === 'both';
    const detail = (t, ct, portion) => {
      const codes = E.elementCodes(doc, t.area, t.task); const sel = new Set(ct.elements || []);
      // Selected knowledge and risk elements, plus every applicable skill element (skills are listed, not questioned).
      const rows = t.task.elements.map((e, i) => ({ e, ref: codes[i] })).filter((x) => x.e.type === 'S' ? E.elementApplies(doc, t.task, x.e, p.test_profile.cls) && !(x.e.sub == null && t.task.elements.some((y) => y.sub && y.type === 'S' && y.num === x.e.num)) : sel.has(x.ref));
      const skillRefs = new Set(t.task.elements.map((e, i) => e.type === 'S' ? codes[i] : null).filter(Boolean));
      const tsc = portion !== 'flight' && isOralM(ct.method) ? ((p.content.scenario || {}).taskScenarios || {})[t.key] : '';
      rows.forEach(({ e, ref }) => { elText[ref] = e.text; });
      const parentOf = (e) => e.sub ? t.task.elements.find((x) => x.type === e.type && x.num === e.num && !x.sub) : null;
      const groups = ['K', 'R', 'S', 'O'].map((ty) => ({ ty, list: rows.filter((x) => x.e.type === ty) })).filter((g) => g.list.length);
      const qsT = (portion === 'flight' && ct.method === 'both') ? [] : (p.content.questions || []).filter((x) => (x.task === t.key || (!x.task && x.ref && codes.includes(x.ref))) && !skillRefs.has(x.ref));
      const notes = Array.isArray(t.task.notes) ? t.task.notes : t.task.notes ? [t.task.notes] : [];
      return `<div class="db-detail">
        ${tsc ? `<div class="db-sec"><div class="xs strong">Task scenario</div><blockquote class="sm">${esc(tsc)}</blockquote></div>` : ''}
        ${apxHtml(t.key)}
        ${portion === 'flight' && ct.method === 'both' ? '<div class="xs muted db-sec">Knowledge and risk questions for this task are in the ground portion.</div>' : ''}
        ${t.task.objective ? `<div class="db-sec"><div class="xs strong">Objective</div><blockquote class="sm">${esc(t.task.objective)}</blockquote></div>` : ''}
        ${t.task.quick ? `<div class="db-sec"><span class="pill info">Examiner tolerance summary</span> <span class="sm">${esc(t.task.quick)}</span>${t.task.quick_src === 'examiner' ? ' <span class="xs muted">(examiner practice; this task has no ACS numeric tolerance)</span>' : ''}</div>` : ''}
        ${t.task.references ? `<div class="db-sec"><div class="xs strong">References</div><div class="sm">${esc(t.task.references)}</div></div>` : ''}
        ${notes.length ? `<div class="db-sec"><div class="xs strong">Task notes</div>${notes.map((n) => `<blockquote class="sm">${esc(typeof n === 'string' ? n : n.text || '')}</blockquote>`).join('')}</div>` : ''}
        ${groups.length ? groups.map((g) => `<div class="db-sec"><div class="xs strong">${esc(LEAD[g.ty])}</div><ul class="db-els">${g.list.map(({ e, ref }) => { const par = parentOf(e); const na = !E.elementApplies(doc, t.task, e, p.test_profile.cls);
          return `<li><span class="mono xs">${esc(ref)}</span> ${par ? `<span class="muted sm">${esc(par.text)} </span>` : ''}<span class="sm">${esc(e.text)}</span>${na ? ' <span class="pill warn">Not for ' + esc(p.test_profile.cls) + ' — not graded</span>' : ''}</li>`; }).join('')}</ul></div>`).join('') : '<div class="sm muted">No elements were selected for this task.</div>'}
        ${qsT.length ? `<div class="db-sec"><div class="xs strong">Planned questions (${qsT.length})</div><ol class="db-qs">${qsT.slice().sort((a, b) => ((codes.indexOf(a.ref) + 1 || 999) - (codes.indexOf(b.ref) + 1 || 999)) || ((a.seq || 9) - (b.seq || 9))).map((x) => `<li class="sm${x.seq === 2 ? ' q-fu' : ''}">${x.ref ? `<span class="mono xs muted">${esc(x.ref)}</span> ` : ''}${x.seq === 2 ? '<span class="pill info">Follow-up</span> ' : ''}${esc(x.prompt)}${x.expected ? `<div class="xs muted">Expected: ${esc(x.expected)}</div>` : ''}</li>`).join('')}</ol></div>` : ''}
        <div class="xs muted">Quoted from ${doc.url ? `<a href="${esc(doc.url)}" target="_blank" rel="noopener">${esc(doc.num)}</a>` : esc(doc.num)}. Grade against the current FAA document.</div></div>`;
    };
    const elapsed = (iso) => { if (!iso) return '—'; const s = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 1000)); return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0'); };
    const ground = tasks.filter((t) => isOralM(p.content.tasks[t.key].method));
    const flight = tasks.filter((t) => (p.content.tasks[t.key].method || 'oral') !== 'oral');
    const openS = new Set();
    const section = (title, html, id) => `<details class="card db-brief" data-s="${id}" ${openS.has(id) ? 'open' : ''}><summary class="strong">${esc(title)}</summary>${html}</details>`;
    const brief = (k) => { const b = (p.content.briefings || {})[k]; return b && b.trim() ? `<div class="sm" style="white-space:pre-wrap;margin-top:.5rem">${esc(b)}</div>` : '<p class="sm muted">No briefing written on the plan.</p>'; };
    const infoHtml = () => { const ck = p.content.checkride || {}; const kl = p.content.ktests || []; const ak = p.content.aktr || [];
      const rows = [['Applicant', app ? app.first_name + ' ' + app.last_name : ''], ['FTN', app && app.ftn], ['Test', ck.test_type || E.PURPOSE_LABEL[p.purpose]], ['Standard', doc.num + ' (' + doc.edition_date + ')'], ['IACRA application', ck.iacra_app_id], ['Recommending instructor', [ck.recommending_instructor, ck.instructor_cert_number].filter(Boolean).join(' · ')], ['School', ck.school], ['Knowledge test', kl.map((t) => E.ktCode(t) + (t.score ? ' ' + t.score + '%' : '')).join(', ') || 'None recorded']];
      return `<table class="t" style="margin-top:.5rem">${rows.map(([k, v]) => `<tr><td class="sm muted" style="width:38%">${k}</td><td class="sm">${esc(v || '—')}</td></tr>`).join('')}</table>
        <div class="xs strong" style="margin:.5rem 0 .2rem">AKTR codes to be tested</div>${ak.length ? `<div class="chips">${ak.map((x) => `<span class="chip mono">${esc(x)}</span>`).join('')}</div>` : '<span class="sm muted">None</span>'}`; };
    const areaCards = (list, portion) => { if (!list.length) return `<div class="card"><p class="sm muted">No tasks are marked ${portion === 'ground' ? 'Oral' : 'Flight'}.</p></div>`;
      const ba = []; list.forEach((t) => { let a = ba.find((x) => x.area === t.area); if (!a) ba.push(a = { area: t.area, list: [] }); a.list.push(t); });
      return ba.map(({ area, list: l }) => `<div class="card"><h2><span class="mono muted">${area.roman}.</span> ${esc(area.title)}</h2>${l.map((t) => taskCard(t, portion)).join('')}</div>`).join(''); };
    const taskCard = (t, portion) => {
      const ct = p.content.tasks[t.key];
      // A task flown and asked on the ground is graded in the flight portion; on the ground it shows its scenario and questions only.
      if (portion === 'ground' && ct.method === 'both') { const ok = 'g:' + t.key;
        return `<div class="db-ref"><div class="task-row"><span class="tl">${t.key}</span><div class="tt"><div class="sm strong">${esc(t.task.title)}</div><div class="xs muted">Oral and flight · graded in the flight portion</div></div></div>
          <details class="db-more" data-k="${ok}" ${openK.has(ok) ? 'open' : ''}><summary>Scenario and questions</summary>${detail(t, ct, 'ground')}</details></div>`; }
      const r = d.results[t.key] || {}; 
          const codes = (ct.elements || []);
          return `<div class="db-task" data-k="${t.key}"><div class="task-row"><span class="tl">${t.key}</span><div class="tt"><div class="sm strong">${esc(t.task.title)}</div><div class="xs muted">${esc({ oral: 'Oral', flight: 'Flight', both: 'Oral and flight' }[ct.method] || '')} · ${codes.length} element(s)</div></div>
            <div class="grade" role="group" aria-label="Grade">${['S', 'U', 'NT'].map((x) => `<button type="button" class="g-${x} ${r.grade === x ? 'on' : ''}" data-g="${x}" ${locked ? 'disabled' : ''}>${x === 'NT' ? 'Not tested' : x === 'S' ? 'Sat' : 'Unsat'}</button>`).join('')}</div></div>
            ${r.grade === 'U' ? `<div class="xs muted" style="margin:.4rem 0 .2rem">Tap the element(s) that were not met (these go on the Notice of Disapproval):</div><div class="chips">${codes.map((x) => `<button type="button" class="chip ${(r.codes || []).includes(x) ? 'on' : ''}" data-c="${esc(x)}" title="${esc(elText[x] || '')}" ${locked ? 'disabled' : ''}>${esc(x)}</button>`).join('')}</div>` : ''}
            <details class="db-more" data-k="${t.key}" ${openK.has(t.key) ? 'open' : ''}><summary>Standards, elements and questions</summary>${detail(t, ct, portion)}</details>
            ${r.grade || r.note ? `<input class="note" placeholder="Note" value="${esc(r.note)}" ${locked ? 'disabled' : ''} style="margin:.45rem 0 0">` : ''}</div>`;
    };
    const render = () => {
      tasks.forEach((t) => { const cs = E.elementCodes(doc, t.area, t.task); t.task.elements.forEach((e, i) => { elText[cs[i]] = e.text; }); });
      const byArea = []; tasks.forEach((t) => { let a = byArea.find((x) => x.area === t.area); if (!a) byArea.push(a = { area: t.area, list: [] }); a.list.push(t); });
      const g = graded();
      c.innerHTML = head('Checkride debrief', `${esc(p.title)} · ${esc(doc.num)}${app ? ' · ' + esc(app.first_name + ' ' + app.last_name) : ''}`,
        `<a class="btn ghost" href="#/poa/${p.id}">Plan of action</a><a class="btn ghost" href="#/print/sheet/${p.id}">Paper grade sheet</a>${d.status === 'signed' ? `<a class="btn ghost" href="#/print/result/${p.id}">Print result</a>` : ''}`) +
        (d.status === 'signed' ? `<div class="banner ok">Signed ${fmtDT(d.signed_at)}. Fingerprint <span class="mono">${esc((d.signed_hash || '').slice(0, 20))}…</span>. This record is locked.</div>` : '') +
        `<div class="card"><div class="form-grid3"><label>Entry mode<select id="mode" ${locked ? 'disabled' : ''}><option value="tablet" ${d.entry_mode === 'tablet' ? 'selected' : ''}>Tablet (live)</option><option value="paper" ${d.entry_mode === 'paper' ? 'selected' : ''}>Transcribed from paper</option></select></label>
          <label>Test date<input type="date" id="tdate" value="${esc(d.test_date)}" ${locked ? 'disabled' : ''}></label><div><div class="xs muted" style="margin-bottom:.3rem">Progress</div><div class="meter"><i style="width:${tasks.length ? Math.round(100 * g / tasks.length) : 0}%"></i></div><div class="xs">${g} of ${tasks.length} tasks graded</div></div></div>
          <div class="db-time">
            ${['g', 'f'].map((w) => { const st = w === 'g' ? d.ground_start : d.flight_start, en = w === 'g' ? d.ground_end : d.flight_end; const run = st && !en;
              return `<div class="timer${run ? ' running' : ''}" id="tm${w}"><span class="xs muted">${w === 'g' ? 'Ground' : 'Flight'}</span> <span class="rec" aria-hidden="true"></span><b class="mono" id="t${w}">${clock(st, en)}</b>
                <span class="xs run-lbl">${run ? 'Running' : st ? 'Stopped' : ''}</span>${locked ? '' : run ? `<button class="btn sm" id="x${w}">Stop</button>` : `<button class="btn ghost sm" id="s${w}">${st ? 'Restart' : 'Start'}</button>`}</div>`; }).join('')}
          </div>
          <div class="form-grid4 db-dur">
            <label>Ground (HH:MM)<input id="om" inputmode="numeric" placeholder="00:00" value="${esc(hhmm(d.oral_minutes))}" ${locked ? 'disabled' : ''}></label>
            <label>Flight (HH:MM)<input id="fh" inputmode="numeric" placeholder="00:00" value="${esc(hhmm(d.flight_minutes != null ? d.flight_minutes : d.flight_hours != null ? Math.round(d.flight_hours * 60) : null))}" ${locked ? 'disabled' : ''}></label>
            <label>Hobbs start<input id="hs" inputmode="decimal" placeholder="0000.0" value="${esc(d.hobbs_start != null ? Number(d.hobbs_start).toFixed(1) : '')}" ${locked ? 'disabled' : ''}></label>
            <label>Hobbs end<input id="he" inputmode="decimal" placeholder="0000.0" value="${esc(d.hobbs_end != null ? Number(d.hobbs_end).toFixed(1) : '')}" ${locked ? 'disabled' : ''}></label>
          </div>
          <div class="btn-row" style="margin-top:.2rem"><span class="xs muted" id="hobbsNote">${hobbsNote()}</span><span style="flex:1"></span><span class="xs muted" id="dbSave">${navigator.onLine ? '' : 'Offline — changes stay on this device'}</span></div></div>
        <div class="btn-row" style="justify-content:flex-end;margin:-.2rem 0 .6rem"><button type="button" class="btn ghost sm" id="dbExp">${openK.size >= tasks.length ? 'Collapse all' : 'Expand all'}</button></div>
        ${section('Applicant and test information', infoHtml(), 'info')}
        ${section('Pretest briefing', brief('pretest'), 'pre')}
        <h2 class="db-portion">Ground portion</h2>
        ${areaCards(ground, 'ground')}
        ${section('Preflight briefing', brief('preflight'), 'pfl')}
        <h2 class="db-portion">Flight portion</h2>
        ${areaCards(flight, 'flight')}
        ${section('Postflight debriefing', brief('postflight'), 'post')}
        <div class="card"><h2>Outcome</h2><div class="form-grid">${Object.entries(OUTCOME).map(([k, v]) => `<label class="check sm"><input type="radio" name="oc" value="${k}" ${d.outcome === k ? 'checked' : ''} ${locked ? 'disabled' : ''}><span>${esc(v)}</span></label>`).join('')}</div>
        ${unsat().length ? `<p class="sm">Unsatisfactory ACS codes: <span class="mono">${esc(unsat().join(', '))}</span></p>` : ''}
        ${d.outcome === 'discontinued' ? `<div class="banner info">${esc(S.regs ? S.regs.cfr['61.43'].paragraphs.find((x) => /^\(f\)/.test(x)) || '' : '')} Tasks graded Satisfactory may be credited for 60 days (14 CFR 61.43(f)).</div>` : ''}
        <label>Remarks / debrief notes<textarea id="rem" ${locked ? 'disabled' : ''} style="min-height:110px">${esc(d.remarks)}</textarea></label>
        ${locked ? '' : '<div class="btn-row" style="justify-content:flex-end"><button class="btn" id="sign">Sign and lock</button></div>'}</div>`;
      bind();
    };
    const bind = () => {
      qsa('details.db-brief', c).forEach((dt) => dt.addEventListener('toggle', () => { dt.open ? openS.add(dt.dataset.s) : openS.delete(dt.dataset.s); }));
      qsa('details.db-more', c).forEach((dt) => dt.addEventListener('toggle', () => { dt.open ? openK.add(dt.dataset.k) : openK.delete(dt.dataset.k); const b = qs('#dbExp', c); if (b) b.textContent = openK.size >= tasks.length ? 'Collapse all' : 'Expand all'; }));
      const ex = qs('#dbExp', c); if (ex) ex.onclick = () => { const all = openK.size < tasks.length; tasks.forEach((t) => { [t.key, 'g:' + t.key].forEach((k) => all ? openK.add(k) : openK.delete(k)); }); const y = window.scrollY; render(); window.scrollTo(0, y); };
      if (locked) return;
      qs('#mode', c).onchange = (e) => { d.entry_mode = e.target.value; save(); };
      qs('#tdate', c).onchange = (e) => { d.test_date = e.target.value; save(); };
      const hm = (id, set) => { const inp = qs(id, c); inp.oninput = () => { const v = parseHM(inp.value); inp.classList.toggle('bad', v === undefined); if (v !== undefined) { set(v); save(); } };
        inp.onblur = () => { const v = parseHM(inp.value); if (v !== undefined && v !== null) inp.value = hhmm(v); }; };
      hm('#om', (v) => { d.oral_minutes = v; });
      hm('#fh', (v) => { setFlight(v); });
      const hb = (id, k) => { const inp = qs(id, c); inp.oninput = () => { const t = inp.value.trim(); const v = t === '' ? null : Number(t); const ok = v === null || (Number.isFinite(v) && v >= 0);
        inp.classList.toggle('bad', !ok); if (!ok) return; d[k] = v === null ? null : Math.round(v * 10) / 10; const h = hobbs(); if (h != null) { setFlight(Math.round(h * 60)); qs('#fh', c).value = hhmm(d.flight_minutes); }
        qs('#hobbsNote', c).textContent = hobbsNote(); save(); }; inp.onblur = () => { if (d[k] != null) inp.value = Number(d[k]).toFixed(1); }; };
      hb('#hs', 'hobbs_start'); hb('#he', 'hobbs_end');
      const rer = () => { save(); const y = window.scrollY; render(); window.scrollTo(0, y); };
      const startG = async () => { if (d.ground_start && !(await confirmBox('Restart the ground timer?', 'The recorded ground time will be replaced.', 'Restart'))) return; d.ground_start = new Date().toISOString(); d.ground_end = null; rer(); };
      const stopG = () => { d.ground_end = new Date().toISOString(); d.oral_minutes = mins(d.ground_start, d.ground_end); rer(); };
      const startF = async () => { if (d.flight_start && !(await confirmBox('Restart the flight timer?', 'The recorded flight time will be replaced.', 'Restart'))) return;
        if (d.ground_start && !d.ground_end) { d.ground_end = new Date().toISOString(); d.oral_minutes = mins(d.ground_start, d.ground_end); }
        d.flight_start = new Date().toISOString(); d.flight_end = null; rer(); };
      const stopF = () => { d.flight_end = new Date().toISOString(); if (hobbs() == null) setFlight(mins(d.flight_start, d.flight_end)); rer(); };
      [['#sg', startG], ['#xg', stopG], ['#sf', startF], ['#xf', stopF]].forEach(([id, fn]) => { const b = qs(id, c); if (b) b.onclick = fn; });
      qsa('.db-task', c).forEach((el) => {
        const k = el.dataset.k; const r = d.results[k] = d.results[k] || {};
        qsa('[data-g]', el).forEach((b) => b.onclick = () => { r.grade = r.grade === b.dataset.g ? null : b.dataset.g; if (r.grade !== 'U') r.codes = []; save(); const y = window.scrollY; render(); window.scrollTo(0, y); });
        qsa('[data-c]', el).forEach((b) => b.onclick = () => { const s = new Set(r.codes || []); s.has(b.dataset.c) ? s.delete(b.dataset.c) : s.add(b.dataset.c); r.codes = Array.from(s); b.classList.toggle('on'); save(); });
        const n = qs('.note', el); if (n) n.oninput = () => { r.note = n.value; save(); };
      });
      qsa('input[name=oc]', c).forEach((r) => r.onchange = () => { d.outcome = r.value; save(); const y = window.scrollY; render(); window.scrollTo(0, y); });
      qs('#rem', c).oninput = (e) => { d.remarks = e.target.value; save(); };
      qs('#sign', c).onclick = async (e) => {
        if (!d.outcome) { toast('Select an outcome first.', true); return; }
        const ungraded = tasks.length - graded();
        if (d.outcome === 'pass' && (ungraded || tasks.some((t) => d.results[t.key] && d.results[t.key].grade === 'U'))) { toast('A pass requires every task graded Satisfactory.', true); return; }
        if (d.outcome === 'fail' && !unsat().length) { toast('Mark at least one unsatisfactory element for a disapproval.', true); return; }
        if (!navigator.onLine) { toast('Connect to the internet to sign.', true); return; }
        if (!(await confirmBox('Sign this debrief?', 'The result will be locked and fingerprinted. ' + (ungraded ? ungraded + ' task(s) are not graded. ' : '') + 'This cannot be edited afterwards.', 'Sign and lock'))) return;
        try {
          clearTimeout(saveT);
          await q(sb.from('debriefs').update({ results: d.results, outcome: d.outcome, unsat_codes: unsat(), remarks: d.remarks || null, oral_minutes: d.oral_minutes ?? null, flight_hours: d.flight_hours ?? null, flight_minutes: d.flight_minutes ?? null, hobbs_start: d.hobbs_start ?? null, hobbs_end: d.hobbs_end ?? null, ground_start: d.ground_start || null, flight_start: d.flight_start || null, ground_end: d.ground_end || (d.ground_start ? new Date().toISOString() : null), flight_end: d.flight_end || (d.flight_start ? new Date().toISOString() : null), test_date: d.test_date || null, entry_mode: d.entry_mode }).eq('id', d.id));
          const n = queue(); delete n[d.id]; localStorage.setItem(QKEY, JSON.stringify(n));
          await act(e.target, () => rpc('sign_debrief', { p_id: d.id }), 'Debrief signed'); A.route();
        } catch (_) {}
      };
    };
    render();
    const tick = setInterval(() => { const a = qs('#tg', c), b = qs('#tf', c); if (!a || !document.body.contains(a)) { clearInterval(tick); return; } a.textContent = clock(d.ground_start, d.ground_end); b.textContent = clock(d.flight_start, d.flight_end); }, 1000);
  }

  // ---------- question bank ----------
  async function viewQuestions() {
    const c = shell('questions'); if (!org()) return noOrg(c);
    await loadStd();
    c.innerHTML = head('Question bank', 'Loading questions…');
    const rows = await A.fetchAll(() => sb.from('questions').select('*').eq('org_id', S.orgId).order('element_code', { ascending: true }).order('id', { ascending: true }));
    const ed = can('org_admin', 'examiner');
    const TYPE = { K: 'Knowledge', R: 'Risk management', S: 'Skill' };
    const typeOf = (r) => { const m = /\.([KRS])\d/.exec(r.element_code || ''); return m ? m[1] : ''; };
    const areaOf = (r) => (r.element_code || '').split('.')[1] || '';
    const docs = S.std.filter((d) => rows.some((r) => r.standard_id === d.id));
    const st = { fs: docs.length === 1 ? docs[0].id : '', fa: '', fk: '', ftp: '', ft: '', s: '', shown: 50 };
    const cnt = (s) => rows.filter((r) => r.status === s).length;
    const aiDrafts = rows.filter((r) => r.status === 'draft' && r.source === 'ai_draft').length;
    c.innerHTML = head('Question bank', 'Your organization\'s questions, tied to ACS element codes. Approved questions can be added to any plan that selects the same element.', ed ? '<button class="btn" id="add">Add question</button>' : '') +
      (aiDrafts ? `<div class="banner warn">${aiDrafts.toLocaleString()} AI-drafted question${aiDrafts === 1 ? ' is' : 's are'} waiting for review. Read each question and expected answer against the current references before approving. Only approved questions can be added to plans.</div>` : '') +
      `<div class="kpis" id="qk"></div>
      <div class="card"><div class="form-grid3">
        <label>Standard<select id="fs"><option value="">All standards</option>${S.std.map((d) => `<option value="${d.id}" ${st.fs === d.id ? 'selected' : ''}>${esc(d.num)} — ${esc(d.title)}</option>`).join('')}</select></label>
        <label>Area of operation<select id="fa"></select></label>
        <label>Task<select id="ftp"></select></label>
        <label>Element type<select id="fk"><option value="">All types</option>${Object.entries(TYPE).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label>Status<select id="ft"><option value="">All statuses</option><option value="draft">Draft</option><option value="approved">Approved</option><option value="retired">Retired</option></select></label>
        <label>Search<input id="srch" placeholder="Element code or text"></label></div>
        <div class="btn-row" id="qbar" style="margin-top:.6rem;align-items:center"></div></div>
      <div class="card flush"><div class="table-wrap"><table class="t" id="tb"><thead><tr><th style="width:9rem">Element</th><th>Question and expected answer</th><th style="width:6rem">Status</th><th style="width:1%"></th></tr></thead><tbody></tbody></table></div><div id="more" style="padding:.8rem;text-align:center"></div></div>`;
    const docOf = (id) => S.std.find((d) => d.id === id);
    const fillAreas = () => {
      const d = docOf(st.fs);
      qs('#fa', c).innerHTML = `<option value="">${d ? 'All areas' : 'Choose a standard first'}</option>` + (d ? d.areas.map((a) => `<option value="${a.roman}" ${st.fa === a.roman ? 'selected' : ''}>${a.roman}. ${esc(a.title)}</option>`).join('') : '');
      qs('#fa', c).disabled = !d;
      const a = d && d.areas.find((x) => x.roman === st.fa);
      qs('#ftp', c).innerHTML = `<option value="">${a ? 'All tasks' : 'Choose an area first'}</option>` + (a ? a.tasks.map((t) => `<option value="${t.letter}" ${st.ftp === t.letter ? 'selected' : ''}>${t.letter}. ${esc(t.title)}</option>`).join('') : '');
      qs('#ftp', c).disabled = !a;
    };
    const filtered = () => rows.filter((r) => (!st.fs || r.standard_id === st.fs) && (!st.fa || areaOf(r) === st.fa) && (!st.ftp || (r.element_code || '').split('.')[2] === st.ftp) && (!st.fk || typeOf(r) === st.fk) && (!st.ft || r.status === st.ft) && (!st.s || (r.prompt + ' ' + (r.expected || '') + ' ' + (r.element_code || '')).toLowerCase().includes(st.s)));
    const kpis = () => {
      qs('#qk', c).innerHTML = [['', 'All questions', rows.length], ['draft', 'Drafts to review', cnt('draft')], ['approved', 'Approved', cnt('approved')], ['retired', 'Retired', cnt('retired')]].map(([k, l, n]) => `<button type="button" class="kpi kpi-btn ${st.ft === k ? 'on' : ''}" data-st="${k}"><div class="kpi-label">${l}</div><div class="kpi-value">${n.toLocaleString()}</div></button>`).join('');
      qsa('[data-st]', c).forEach((b) => b.onclick = () => { st.ft = b.dataset.st; qs('#ft', c).value = st.ft; st.shown = 50; render(); });
    };
    const rowHtml = (r) => `<tr data-row="${r.id}"><td class="mono xs">${esc(r.element_code || '')}<div class="muted">${esc((docOf(r.standard_id) || {}).num || '')}</div><div class="muted">${esc(TYPE[typeOf(r)] || '')}</div></td>
      <td class="sm">${esc(r.prompt)}${r.expected ? `<div class="xs muted" style="margin-top:.25rem"><b>Expected:</b> ${esc(r.expected)}</div>` : ''}${r.refs ? `<div class="xs muted"><b>References:</b> ${esc(r.refs)}</div>` : ''}${r.source === 'ai_draft' ? '<span class="pill warn" style="margin-top:.3rem">AI draft' + (r.status === 'approved' ? ', reviewed' : ' — examiner review') + '</span>' : ''}</td>
      <td><span class="pill ${r.status === 'approved' ? 'ok' : r.status === 'retired' ? '' : 'warn'}">${r.status === 'draft' ? 'Draft' : r.status === 'approved' ? 'Approved' : 'Retired'}</span></td>
      <td>${ed ? `<div class="btn-row" style="flex-wrap:nowrap">${r.status !== 'approved' ? `<button class="btn ghost sm" data-ap="${r.id}">Approve</button>` : ''}<button class="btn ghost sm" data-ed="${r.id}">Edit</button>${r.status !== 'retired' ? `<button class="btn ghost sm" data-rt="${r.id}">Retire</button>` : ''}</div>` : ''}</td></tr>`;
    const setStatus = async (ids, status, b) => {
      const patch = status === 'approved' ? { status, approved_by: S.ctx.user_id, approved_at: new Date().toISOString() } : { status };
      await act(b, async () => { for (let i = 0; i < ids.length; i += 200) await q(sb.from('questions').update(patch).in('id', ids.slice(i, i + 200)).eq('org_id', S.orgId)); }, ids.length === 1 ? (status === 'approved' ? 'Approved' : 'Retired') : ids.length.toLocaleString() + ' questions ' + (status === 'approved' ? 'approved' : 'retired'));
      const set = new Set(ids); rows.forEach((r) => { if (set.has(r.id)) Object.assign(r, patch); });
      render();
    };
    function render() {
      kpis();
      const list = filtered();
      const drafts = list.filter((r) => r.status === 'draft');
      qs('#qbar', c).innerHTML = `<span class="sm muted">Showing ${Math.min(st.shown, list.length).toLocaleString()} of ${list.length.toLocaleString()} matching question${list.length === 1 ? '' : 's'}</span>` +
        (ed && drafts.length && drafts.length <= 60 ? `<button class="btn sm" id="apAll" type="button" style="margin-left:auto">Approve ${drafts.length} draft${drafts.length === 1 ? '' : 's'} shown</button>` : '') +
        (ed && drafts.length > 60 ? `<span class="xs muted" style="margin-left:auto">Filter to a single task to approve its drafts together after reading them.</span>` : '');
      qs('#tb tbody', c).innerHTML = list.length ? list.slice(0, st.shown).map(rowHtml).join('') : '<tr><td colspan="4"><div class="empty"><span class="strong">No questions</span>Change the filters or add a question.</div></td></tr>';
      qs('#more', c).innerHTML = list.length > st.shown ? `<button class="btn ghost" id="moreBtn" type="button">Show ${Math.min(50, list.length - st.shown)} more</button>` : '';
      const mb = qs('#moreBtn', c); if (mb) mb.onclick = () => { st.shown += 50; render(); };
      const aa = qs('#apAll', c); if (aa) aa.onclick = async () => { if (await A.confirmBox('Approve drafts', `Approve the ${drafts.length} draft question(s) shown? Confirm you have read each question and expected answer.`, 'Approve')) { try { await setStatus(drafts.map((r) => r.id), 'approved', aa); } catch (_) {} } };
      qsa('[data-ap]', c).forEach((b) => b.onclick = async () => { try { await setStatus([b.dataset.ap], 'approved', b); } catch (_) {} });
      qsa('[data-rt]', c).forEach((b) => b.onclick = async () => { try { await setStatus([b.dataset.rt], 'retired', b); } catch (_) {} });
      qsa('[data-ed]', c).forEach((b) => b.onclick = () => form(rows.find((r) => r.id === b.dataset.ed)));
    }
    qs('#fs', c).onchange = (e) => { st.fs = e.target.value; st.fa = ''; st.ftp = ''; st.shown = 50; fillAreas(); render(); };
    qs('#fa', c).onchange = (e) => { st.fa = e.target.value; st.ftp = ''; st.shown = 50; fillAreas(); render(); };
    qs('#ftp', c).onchange = (e) => { st.ftp = e.target.value; st.shown = 50; render(); };
    qs('#fk', c).onchange = (e) => { st.fk = e.target.value; st.shown = 50; render(); };
    qs('#ft', c).onchange = (e) => { st.ft = e.target.value; st.shown = 50; render(); };
    let tm; qs('#srch', c).oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => { st.s = e.target.value.trim().toLowerCase(); st.shown = 50; render(); }, 200); };
    fillAreas(); render();
    const form = (r) => {
      r = r || { portion: 'oral', difficulty: 2 };
      modal(`<h2>${r.id ? 'Edit question' : 'Add question'}</h2><form id="f"><div class="form-grid"><label>Standard<select name="std">${S.std.map((d) => `<option value="${d.id}" ${r.standard_id === d.id ? 'selected' : ''}>${esc(d.num)} — ${esc(d.title)}</option>`).join('')}</select></label>
        <label>ACS element code<input name="code" value="${esc(r.element_code)}" placeholder="PA.I.C.K2"></label><label>Portion<select name="portion">${['oral', 'scenario', 'flight'].map((x) => `<option ${r.portion === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label>Difficulty<select name="dif">${[1, 2, 3].map((x) => `<option value="${x}" ${r.difficulty === x ? 'selected' : ''}>${['', 'Basic', 'Applied', 'Correlative'][x]}</option>`).join('')}</select></label>
        <label class="full">Prompt<textarea name="prompt" required>${esc(r.prompt)}</textarea></label><label class="full">Expected answer / evaluation notes<textarea name="exp">${esc(r.expected)}</textarea></label><label class="full">References<input name="refs" value="${esc(r.refs)}" placeholder="14 CFR 91.103; PHAK Ch. 12"></label></div>
        <div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Save</button></div></form>`, (bg, close) => {
        qs('#f', bg).onsubmit = async (e) => {
          e.preventDefault(); const f = e.target; const code = f.code.value.trim().toUpperCase();
          if (code && !A.AKTR_RE.test(code)) { toast('Element code should look like PA.I.C.K2', true); return; }
          const row = { standard_id: f.std.value, element_code: code || null, task_ref: code ? code.split('.').slice(0, 3).join('.') : null, portion: f.portion.value, difficulty: +f.dif.value, prompt: f.prompt.value.trim(), expected: f.exp.value.trim() || null, refs: f.refs.value.trim() || null };
          try { await act(qs('button:not([data-close])', f), () => r.id ? q(sb.from('questions').update(row).eq('id', r.id)) : q(sb.from('questions').insert(Object.assign(row, { org_id: S.orgId, created_by: S.ctx.user_id }))), 'Saved'); close(); if (r.id) { Object.assign(r, row); render(); } else A.route(); } catch (_) {}
        };
      });
    };
    if (qs('#add', c)) qs('#add', c).onclick = () => form();
  }

  // ---------- reports ----------
  async function viewReports() {
    const c = shell('reports'); if (!org()) return noOrg(c);
    await loadStd();
    const [dbs, poas, apps, mem] = await Promise.all([q(sb.from('debriefs').select('*').eq('org_id', S.orgId).eq('status', 'signed')), q(sb.from('poas').select('id,purpose,test_profile,standard_id,examiner_id,applicant_id,title,content').eq('org_id', S.orgId)), q(sb.from('applicants').select('id,first_name,last_name,recommending_instructor,school').eq('org_id', S.orgId)), rpc('org_members_list', { p_org: S.orgId })]);
    const P = Object.fromEntries(poas.map((p) => [p.id, p])); const AP = Object.fromEntries(apps.map((a) => [a.id, a]));
    const mname = Object.fromEntries((mem || []).map((m) => [m.user_id, m.full_name || m.email]));
    let from = '', to = '', cert = '', exam = '';
    const render = () => {
      const list = dbs.filter((d) => { const p = P[d.poa_id] || {}; return (!from || d.test_date >= from) && (!to || d.test_date <= to) && (!cert || (p.test_profile || {}).cert === cert) && (!exam || d.examiner_id === exam) && p.purpose !== 'mock_checkride' && p.purpose !== 'training'; });
      const mocks = dbs.filter((d) => ['mock_checkride', 'training'].includes((P[d.poa_id] || {}).purpose));
      const n = list.length, pass = list.filter((d) => d.outcome === 'pass').length, fail = list.filter((d) => d.outcome === 'fail').length, disc = list.filter((d) => d.outcome === 'discontinued').length;
      // first-time pass: applicant's first signed result
      const firsts = {}; list.slice().sort((a, b) => (a.test_date || '').localeCompare(b.test_date || '')).forEach((d) => { const k = d.applicant_id + '|' + (P[d.poa_id] || {}).standard_id; if (!firsts[k]) firsts[k] = d; });
      const fl = Object.values(firsts).filter((d) => d.outcome !== 'discontinued'); const ftp = fl.filter((d) => d.outcome === 'pass').length;
      const retests = list.filter((d) => (P[d.poa_id] || {}).purpose === 'retest');
      // by month
      const months = {}; list.forEach((d) => { const k = (d.test_date || '').slice(0, 7) || 'undated'; months[k] = months[k] || { pass: 0, fail: 0, discontinued: 0 }; if (months[k][d.outcome] != null) months[k][d.outcome]++; });
      const mk = Object.keys(months).sort().slice(-12); const mmax = Math.max(1, ...mk.map((k) => months[k].pass + months[k].fail + months[k].discontinued));
      const count = (arr) => Object.entries(arr.reduce((a, x) => (a[x] = (a[x] || 0) + 1, a), {})).sort((a, b) => b[1] - a[1]);
      const codes = count(list.flatMap((d) => d.unsat_codes || []));
      const tasksU = count(list.flatMap((d) => Object.entries(d.results || {}).filter(([, r]) => r.grade === 'U').map(([k]) => k)));
      const byStd = {}; list.forEach((d) => { const p = P[d.poa_id] || {}; const k = (stdDoc(p.standard_id) || {}).num || '—'; byStd[k] = byStd[k] || { n: 0, pass: 0 }; byStd[k].n++; if (d.outcome === 'pass') byStd[k].pass++; });
      const byCfi = {}; list.forEach((d) => { const a = AP[d.applicant_id] || {}; const k = a.recommending_instructor || 'Not recorded'; byCfi[k] = byCfi[k] || { n: 0, pass: 0, school: a.school || '' }; byCfi[k].n++; if (d.outcome === 'pass') byCfi[k].pass++; });
      const avg = (xs) => xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length) : null;
      const oral = avg(list.map((d) => d.oral_minutes).filter(Boolean)), fh = avg(list.map((d) => +d.flight_hours).filter(Boolean));
      // coverage heatmap: how often each area's elements appear in this org's plans for the most-used standard
      const stdCount = count(poas.map((p) => p.standard_id)); const hs = stdCount[0] ? stdDoc(stdCount[0][0]) : null;
      let heat = '';
      if (hs) {
        const use = {}; poas.filter((p) => p.standard_id === hs.id).forEach((p) => Object.values((p.content && p.content.tasks) || {}).forEach((t) => (t.included ? t.elements || [] : []).forEach((x) => use[x] = (use[x] || 0) + 1)));
        const np = poas.filter((p) => p.standard_id === hs.id).length;
        heat = `<div class="card"><h2>Element coverage — ${esc(hs.num)}</h2><p class="xs muted">Share of your ${np} plan(s) that selected each knowledge and risk element, by task. Light cells are elements rarely tested; rotating them in keeps plans unique.</p><div class="heat">${hs.areas.map((a) => a.tasks.map((t) => { const els = t.elements.filter((e) => e.type !== 'S'); if (!els.length) return ''; const codes = E.elementCodes(hs, a, t); return `<div class="heat-row"><span class="mono xs">${esc(E.taskKey(a, t))}</span><div class="cells">${t.elements.map((e, i) => e.type === 'S' ? '' : `<i title="${esc(codes[i])}: ${use[codes[i]] || 0} of ${np}" style="opacity:${np ? 0.12 + 0.88 * Math.min(1, (use[codes[i]] || 0) / np) : 0.12}" class="t-${e.type}"></i>`).join('')}</div></div>`; }).join('')).join('')}</div><div class="legend xs"><i class="t-K"></i> Knowledge <i class="t-R"></i> Risk management · darker = used more often</div></div>`;
      }
      const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '—';
      qs('#rep', c).innerHTML = `<div class="kpis"><div class="kpi"><div class="kpi-label">Signed tests</div><div class="kpi-value">${n}</div><div class="kpi-note">${pass} pass · ${fail} disapproved · ${disc} discontinued</div></div>
        <div class="kpi"><div class="kpi-label">Pass rate</div><div class="kpi-value">${pct(pass, pass + fail)}</div><div class="kpi-note">Excludes discontinued</div></div>
        <div class="kpi"><div class="kpi-label">First-time pass</div><div class="kpi-value">${pct(ftp, fl.length)}</div><div class="kpi-note">${ftp} of ${fl.length} first attempts</div></div>
        <div class="kpi"><div class="kpi-label">Average duration</div><div class="kpi-value">${oral ? String(Math.floor(oral / 60)).padStart(2, '0') + ':' + String(Math.round(oral) % 60).padStart(2, '0') : '—'}</div><div class="kpi-note">Ground (HH:MM)${fh ? ' · flight ' + String(Math.floor(fh * 60 / 60)).padStart(2, '0') + ':' + String(Math.round(fh * 60) % 60).padStart(2, '0') : ''} · ${retests.length} retest(s) · ${mocks.length} mock</div></div></div>
        <div class="grid2"><div class="card"><h2>Outcomes by month</h2>${mk.length ? `<div class="cols">${mk.map((k) => { const m = months[k]; return `<div class="col"><div class="stack" style="height:140px">${['discontinued', 'fail', 'pass'].map((o) => `<i class="o-${o}" style="height:${100 * m[o] / mmax}%" title="${o}: ${m[o]}"></i>`).join('')}</div><span class="xs">${esc(k.slice(2))}</span></div>`; }).join('')}</div><div class="legend xs"><i class="o-pass"></i> Pass <i class="o-fail"></i> Disapproved <i class="o-discontinued"></i> Discontinued</div>` : '<div class="empty sm">No signed results in range.</div>'}</div>
        <div class="card"><h2>By standard</h2>${Object.keys(byStd).length ? `<table class="t"><thead><tr><th>Standard</th><th>Tests</th><th>Pass</th></tr></thead>${Object.entries(byStd).map(([k, v]) => `<tr><td class="sm">${esc(k)}</td><td>${v.n}</td><td>${pct(v.pass, v.n)}</td></tr>`).join('')}</table>` : '<div class="empty sm">No data.</div>'}</div></div>
        <div class="grid2"><div class="card"><h2>Most-missed ACS codes</h2>${codes.length ? `<div class="bars">${codes.slice(0, 12).map(([k, v]) => `<div class="bar"><span class="mono xs">${esc(k)}</span><div><i style="width:${100 * v / codes[0][1]}%"></i></div><b class="xs">${v}</b></div>`).join('')}</div>` : '<div class="empty sm">No unsatisfactory codes recorded.</div>'}</div>
        <div class="card"><h2>Most-missed tasks</h2>${tasksU.length ? `<div class="bars">${tasksU.slice(0, 12).map(([k, v]) => `<div class="bar"><span class="mono xs">${esc(k)}</span><div><i style="width:${100 * v / tasksU[0][1]}%"></i></div><b class="xs">${v}</b></div>`).join('')}</div>` : '<div class="empty sm">No unsatisfactory tasks recorded.</div>'}</div></div>
        <div class="card"><h2>By recommending instructor</h2>${Object.keys(byCfi).length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Instructor</th><th>School</th><th>Tests</th><th>Pass rate</th></tr></thead>${Object.entries(byCfi).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `<tr><td class="sm">${esc(k)}</td><td class="sm muted">${esc(v.school)}</td><td>${v.n}</td><td>${pct(v.pass, v.n)}</td></tr>`).join('')}</table></div>` : '<div class="empty sm">No data.</div>'}</div>${heat}`;
      A._repList = list;
    };
    c.innerHTML = head('Reports', 'Checkride outcomes and trends from signed debriefs. Mock checkrides and training events are counted separately.', '<a class="btn ghost" href="#/checkride-reports">Checkride outcome report</a><button class="btn ghost" id="csv">Export CSV</button>') +
      `<div class="banner info sm">This page counts checkrides graded in smartPOA. For all checkride records, including ones from the previous system, open the <a href="#/checkride-reports">checkride outcome report</a> or <a href="#/past-checkrides">Past checkrides</a>.</div><div class="card"><div class="form-grid3" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))"><label>From<input type="date" id="f1"></label><label>To<input type="date" id="f2"></label><label>Certificate<select id="f3"><option value="">All</option>${Object.entries(E.CERT_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label>Examiner<select id="f4"><option value="">All</option>${(mem || []).filter((m) => (m.roles || []).includes('examiner')).map((m) => `<option value="${m.user_id}">${esc(m.full_name || m.email)}</option>`).join('')}</select></label></div></div><div id="rep"></div>`;
    qs('#f1', c).onchange = (e) => { from = e.target.value; render(); }; qs('#f2', c).onchange = (e) => { to = e.target.value; render(); };
    qs('#f3', c).onchange = (e) => { cert = e.target.value; render(); }; qs('#f4', c).onchange = (e) => { exam = e.target.value; render(); };
    qs('#csv', c).onclick = () => {
      const hm2 = (m) => m == null || isNaN(m) ? '' : String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.round(m) % 60).padStart(2, '0');
      const rows = [['test_date', 'applicant', 'recommending_instructor', 'school', 'plan', 'purpose', 'standard', 'outcome', 'unsat_codes', 'ground_hhmm', 'flight_hhmm', 'hobbs_start', 'hobbs_end', 'examiner', 'entry_mode', 'signed_at', 'signed_hash']];
      (A._repList || []).forEach((d) => { const p = P[d.poa_id] || {}; const a = AP[d.applicant_id] || {}; rows.push([d.test_date, a.last_name ? a.last_name + ', ' + a.first_name : '', a.recommending_instructor, a.school, p.title, p.purpose, (stdDoc(p.standard_id) || {}).num, d.outcome, (d.unsat_codes || []).join(' '), hm2(d.oral_minutes), hm2(d.flight_minutes != null ? d.flight_minutes : d.flight_hours != null ? Math.round(d.flight_hours * 60) : null), d.hobbs_start, d.hobbs_end, mname[d.examiner_id] || '', d.entry_mode, d.signed_at, d.signed_hash]); });
      const csv = rows.map((r) => r.map((v) => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'smartpoa-results-' + today() + '.csv'; a.click();
    };
    render();
  }

  // ---------- members ----------
  async function viewMembers() {
    const c = shell('members'); if (!org()) return noOrg(c);
    if (!can('org_admin') && !isOwner()) { c.innerHTML = '<div class="banner warn">Only organization administrators can manage members.</div>'; return; }
    const [mem, inv] = await Promise.all([rpc('org_members_list', { p_org: S.orgId }), rpc('org_invitations_list', { p_org: S.orgId })]);
    const roleBoxes = (sel, name) => Object.keys(ROLE_LABEL).map((r) => `<label class="check sm"><input type="checkbox" name="${name}" value="${r}" ${(sel || []).includes(r) ? 'checked' : ''}><span><b>${ROLE_LABEL[r]}</b><br><span class="xs muted">${ROLE_DESC[r]}</span></span></label>`).join('');
    const pendingInv = (inv || []).filter((i) => !i.used_at && !i.revoked_at && new Date(i.expires_at) > new Date());
    c.innerHTML = head('Members & roles', 'Every member signs in with a password and an authenticator app. Roles control what each person can see.', '<button class="btn" id="inv">Invite member</button>') +
      `<div class="card flush"><div class="table-wrap"><table class="t"><thead><tr><th>Member</th><th>Roles</th><th>Status</th><th></th></tr></thead><tbody>${(mem || []).map((m) => `<tr><td><span class="strong">${esc(m.full_name || m.email)}</span><div class="xs muted">${esc(m.email)}</div></td><td class="sm">${(m.roles || []).map((r) => `<span class="pill">${esc(ROLE_LABEL[r] || r)}</span>`).join(' ')}</td><td>${m.status === 'active' ? '<span class="pill ok">Active</span>' : '<span class="pill bad">Suspended</span>'}</td><td><button class="btn ghost sm" data-u="${m.user_id}">Edit</button></td></tr>`).join('')}</tbody></table></div></div>
      <div class="card"><h2>Pending invitations</h2>${pendingInv.length ? `<table class="t">${pendingInv.map((i) => `<tr><td class="sm">${esc(i.email)}</td><td class="sm">${(i.roles || []).map((r) => ROLE_LABEL[r] || r).join(', ')}</td><td class="xs muted">Expires ${fmtDT(i.expires_at)}</td><td><button class="btn ghost sm" data-rv="${i.id}">Revoke</button></td></tr>`).join('')}</table>` : '<p class="sm muted">None.</p>'}</div>`;
    qsa('[data-rv]', c).forEach((b) => b.onclick = async () => { try { await act(b, () => rpc('revoke_invitation', { p_id: b.dataset.rv }), 'Invitation revoked'); A.route(); } catch (_) {} });
    qsa('[data-u]', c).forEach((b) => b.onclick = () => {
      const m = mem.find((x) => x.user_id === b.dataset.u);
      modal(`<h2>${esc(m.full_name || m.email)}</h2><form id="f">${roleBoxes(m.roles, 'r')}<label>Status<select name="st"><option value="active" ${m.status === 'active' ? 'selected' : ''}>Active</option><option value="suspended" ${m.status !== 'active' ? 'selected' : ''}>Suspended (no access)</option></select></label>
        <div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Save</button></div></form>`, (bg, close) => {
        qs('#f', bg).onsubmit = async (e) => { e.preventDefault(); const rs = qsa('input[name=r]:checked', bg).map((x) => x.value); try { await act(qs('button:not([data-close])', e.target), () => rpc('set_member_roles', { p_org: S.orgId, p_user: m.user_id, p_roles: rs, p_status: e.target.st.value }), 'Saved'); close(); A.route(); } catch (_) {} };
      });
    });
    qs('#inv', c).onclick = () => modal(`<h2>Invite a member</h2><form id="f"><label>Email<input name="email" type="email" required></label>${roleBoxes(['examiner'], 'r')}
      <div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Create invitation</button></div></form><div id="out"></div>`, (bg) => {
      qs('#f', bg).onsubmit = async (e) => {
        e.preventDefault(); const rs = qsa('input[name=r]:checked', bg).map((x) => x.value); if (!rs.length) { toast('Choose at least one role.', true); return; }
        try {
          const tok = await act(qs('button:not([data-close])', e.target), () => rpc('create_invitation', { p_org: S.orgId, p_email: e.target.email.value.trim(), p_roles: rs }));
          const link = location.origin + location.pathname + '#/invite/' + tok;
          qs('#f', bg).style.display = 'none';
          qs('#out', bg).innerHTML = `<p class="sm">Send this link to <b>${esc(e.target.email.value)}</b>. It works once, only for that email, and expires in 7 days. It is shown only now.</p><div class="linkbox mono xs">${esc(link)}</div><div class="btn-row" style="justify-content:flex-end"><button class="btn ghost" id="cp">Copy link</button><button class="btn" data-close id="dn">Done</button></div>`;
          qs('#cp', bg).onclick = () => navigator.clipboard.writeText(link).then(() => toast('Copied'));
          qs('#dn', bg).onclick = () => { bg.remove(); A.route(); };
        } catch (_) {}
      };
    });
  }

  // ---------- settings ----------
  async function viewSettings() {
    const c = shell('settings');
    const me = org() ? ((await rpc('org_members_list', { p_org: S.orgId })) || []).find((m) => m.user_id === S.ctx.user_id) : null;
    const ei = (me && me.examiner_info) || {};
    const { data: lf } = await sb.auth.mfa.listFactors();
    c.innerHTML = head('My profile', esc((S.ctx.profile || {}).email || '')) +
      `<div class="grid2"><div class="card"><h2>Name</h2><form id="pf"><label>Full name<input name="n" value="${esc((S.ctx.profile || {}).full_name)}" required></label><button class="btn sm">Save</button></form></div>
      <div class="card"><h2>Security</h2><p class="sm">Authenticator app: ${(lf.totp || []).filter((f) => f.status === 'verified').length ? '<span class="pill ok">Enabled</span>' : '<span class="pill bad">Not set</span>'}</p>
      <form id="pw"><label>New password<input name="p" type="password" minlength="12" autocomplete="new-password" required></label><button class="btn ghost sm">Change password</button></form></div></div>
      ${org() && A.can('examiner') ? `<div class="card"><h2>Examiner information (${esc(org().name)})</h2><p class="xs muted">Shown on printed plans and proof forms.</p><form id="ef"><div class="form-grid">
        <label>Designation<select name="kind">${['DPE', 'Aircrew Program Designee (APD)', 'Training Center Evaluator (TCE)', 'Check airman', 'Flight school chief / assistant chief', 'Instructor (mock checkride)'].map((x) => `<option ${ei.kind === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Designee / certificate number (optional)<input name="num" value="${esc(ei.num)}"></label><label>Managing FSDO / office<input name="fsdo" value="${esc(ei.fsdo)}"></label><label>Managing specialist<input name="ms" value="${esc(ei.ms)}"></label>
        <label class="full">Authorized functions / limits<input name="auth" value="${esc(ei.auth)}" placeholder="e.g. Private, Commercial, Instrument ASEL/AMEL"></label></div><button class="btn sm">Save examiner information</button></form></div>` : ''}`;
    qs('#pf', c).onsubmit = async (e) => { e.preventDefault(); try { await act(qs('button', e.target), () => rpc('update_my_profile', { p_full_name: e.target.n.value.trim() }), 'Saved'); S.ctx.profile = Object.assign(S.ctx.profile || {}, { full_name: e.target.n.value.trim() }); } catch (_) {} };
    qs('#pw', c).onsubmit = async (e) => { e.preventDefault(); try { await act(qs('button', e.target), async () => { const { error } = await sb.auth.updateUser({ password: e.target.p.value }); if (error) throw error; }, 'Password changed'); e.target.reset(); } catch (_) {} };
    const ef = qs('#ef', c); if (ef) ef.onsubmit = async (e) => { e.preventDefault(); const f = e.target; try { await act(qs('button', f), () => rpc('set_examiner_info', { p_org: S.orgId, p_info: { kind: f.kind.value, num: f.num.value.trim(), fsdo: f.fsdo.value.trim(), ms: f.ms.value.trim(), auth: f.auth.value.trim() } }), 'Saved'); } catch (_) {} };
  }

  // ---------- standards library ----------
  async function viewStandards(m, params) {
    const c = shell('standards');
    await loadStd(); await A.loadDocsDb();
    const id = params.get('doc');
    if (id && stdDoc(id)) {
      const d = stdDoc(id);
      c.innerHTML = head(esc(d.num), esc(d.title) + ' · ' + esc(d.edition_date), `<a class="btn ghost" href="#/standards">All standards</a><a class="btn ghost" href="${esc(d.url)}" target="_blank" rel="noopener">FAA PDF</a>`) +
        `<div class="card"><input id="srch" placeholder="Search tasks and elements" style="margin:0"></div><div id="list">${d.areas.map((a) => `<div class="area"><div class="area-head"><span class="roman">${a.roman}</span><span class="title">${esc(a.title)}</span><span class="xs muted">${a.tasks.length} tasks</span></div><div class="area-body" style="display:none">${a.tasks.map((t) => { const codes = E.elementCodes(d, a, t); return `<div class="task"><div class="sm strong"><span class="mono">${esc(E.taskKey(a, t))}</span> ${esc(t.title)}</div>${t.references ? `<div class="xs muted">References: ${esc(t.references)}</div>` : ''}${t.objective ? `<div class="xs" style="margin:.2rem 0">${esc(t.objective)}</div>` : ''}<div class="els">${t.elements.map((e, i) => `<div class="el t-${e.type}"><span class="code">${esc(codes[i])}</span><span>${esc(e.text)}</span></div>`).join('')}</div></div>`; }).join('')}</div></div>`).join('')}</div>`;
      qsa('.area-head', c).forEach((h) => h.onclick = () => { const b = h.nextElementSibling; b.style.display = b.style.display === 'none' ? '' : 'none'; });
      qs('#srch', c).oninput = (e) => { const s = e.target.value.toLowerCase(); qsa('.area', c).forEach((a) => { let any = false; qsa('.task', a).forEach((t) => { const hit = !s || t.textContent.toLowerCase().includes(s); t.style.display = hit ? '' : 'none'; any = any || hit; }); a.style.display = any ? '' : 'none'; qs('.area-body', a).style.display = s && any ? '' : 'none'; }); };
      return;
    }
    const reg = S.docsDb || [];
    c.innerHTML = head('Standards library', 'The FAA documents smartPOA plans against. Each ACS and PTS is fingerprinted; the source watcher compares the FAA file to the loaded edition.') +
      `<div class="banner info">Last FAA source check: ${esc(S.lastCheck || 'not yet run')}. Summaries of Orders, Notices and Advisory Circulars inside smartPOA are unofficial; the FAA document governs.</div>
      <div class="card flush"><div class="table-wrap"><table class="t"><thead><tr><th>Document</th><th>Edition</th><th>Status</th><th>SHA-256</th><th></th></tr></thead><tbody>
      ${reg.sort((a, b) => a.kind.localeCompare(b.kind) || a.doc_number.localeCompare(b.doc_number)).map((r) => `<tr><td><span class="strong sm">${esc(r.doc_number)}</span><div class="xs muted">${esc(r.title)}</div></td><td class="sm">${esc(r.edition_date || '')}${r.effective_date ? `<div class="xs muted">Effective ${fmtDate(r.effective_date)}</div>` : ''}</td><td>${r.status === 'current' ? '<span class="pill ok">Current</span>' : `<span class="pill warn">${esc(r.status)}</span>`}</td><td class="mono xs">${esc((r.sha256 || '').slice(0, 12))}${r.sha256 ? '…' : ''}</td><td><div class="btn-row">${stdDoc(r.id) ? `<a class="btn ghost sm" href="#/standards?doc=${r.id}">Browse</a>` : ''}<a class="btn ghost sm" href="${esc(r.source_url)}" target="_blank" rel="noopener">FAA</a></div></td></tr>`).join('')}</tbody></table></div></div>`;
  }

  // ---------- audit ----------
  async function viewAudit() {
    const c = shell('audit'); if (!org()) return noOrg(c);
    const rows = await q(sb.from('audit_log').select('*').eq('org_id', S.orgId).order('id', { ascending: false }).limit(300));
    const mem = await rpc('org_members_list', { p_org: S.orgId }); const mn = Object.fromEntries((mem || []).map((m) => [m.user_id, m.full_name || m.email]));
    c.innerHTML = head('Audit trail', 'Every change to records is written to a hash-chained log. The most recent 300 entries are shown.') +
      `<div class="card flush"><div class="table-wrap"><table class="t"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Hash</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="xs">${fmtDT(r.at)}</td><td class="sm">${esc(mn[r.actor] || (r.actor ? r.actor.slice(0, 8) : 'system'))}</td><td class="sm">${esc(r.action)}</td><td class="sm">${esc(r.entity)} <span class="mono xs muted">${esc((r.entity_id || '').slice(0, 8))}</span></td><td class="mono xs muted">${esc(r.hash.slice(0, 12))}…</td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">No entries.</div></td></tr>'}</tbody></table></div></div>`;
  }

  // ---------- platform (owner) ----------
  async function viewPlatform() {
    const c = shell('platform');
    if (!isOwner()) { c.innerHTML = '<div class="banner warn">Platform owner only.</div>'; return; }
    const [orgs, checks] = await Promise.all([q(sb.from('orgs').select('*').order('created_at')), q(sb.from('source_checks').select('*').order('checked_at', { ascending: false }).limit(40))]);
    c.innerHTML = head('Platform', 'Organizations, owner invitations and FAA source monitoring.', '<button class="btn" id="newOrg">Create organization</button>') +
      `<div class="grid2"><div class="card"><h2>Organizations</h2>${orgs.length ? `<table class="t">${orgs.map((o) => `<tr><td class="sm strong">${esc(o.name)}</td><td class="sm">${esc({ dpe_practice: 'DPE practice', flight_school: 'Flight school', flight_department: 'Flight department' }[o.kind] || o.kind)}</td><td><button class="btn ghost sm" data-oi="${o.id}">Invite admin</button></td></tr>`).join('')}</table>` : '<p class="sm muted">None yet. Create your examiner organization first.</p>'}</div>
      <div class="card"><h2>Integrity</h2><p class="sm">Verify that no audit log entry has been altered or removed.</p><button class="btn ghost" id="vac">Verify audit chain</button><div id="vacr" class="sm" style="margin-top:.5rem"></div>
      <h3>Platform owner invitation</h3><p class="xs muted">Adds another platform owner. Use sparingly.</p><button class="btn ghost sm" id="ownInv">Invite platform owner</button></div></div>
      <div class="card"><div class="card-head"><h2>FAA source watch</h2><button class="btn" id="chk">Check FAA now</button></div><p class="xs muted">Downloads each FAA document, compares its fingerprint to the loaded edition and flags any change for review. A change does not update the app automatically; a new edition must be loaded and reviewed.</p>
      <div class="table-wrap"><table class="t"><thead><tr><th>Checked</th><th>Document</th><th>HTTP</th><th>Result</th></tr></thead><tbody>${checks.map((k) => `<tr><td class="xs">${fmtDT(k.checked_at)}</td><td class="sm">${esc(k.doc_id || k.url)}</td><td class="sm">${esc(k.http_status || '')}</td><td>${k.changed ? '<span class="pill warn">Changed</span>' : k.http_status === 200 ? '<span class="pill ok">Unchanged</span>' : '<span class="pill bad">Error</span>'}</td></tr>`).join('') || '<tr><td colspan="4"><div class="empty sm">No checks run yet.</div></td></tr>'}</tbody></table></div></div>`;
    qs('#vac', c).onclick = async (e) => { try { const r = await act(e.target, () => rpc('verify_audit_chain', { p_limit: 50000 })); qs('#vacr', c).innerHTML = r.mismatches ? `<span class="pill bad">${r.mismatches} mismatch(es)</span> in ${r.checked} entries` : `<span class="pill ok">Intact</span> ${r.checked} entries verified`; } catch (_) {} };
    qs('#chk', c).onclick = async (e) => {
      try {
        await act(e.target, async () => {
          const { data: { session } } = await sb.auth.getSession();
          const r = await fetch(C.url + '/functions/v1/source-watch', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.key, Authorization: 'Bearer ' + session.access_token }, body: '{}' });
          const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Check failed');
          toast('Checked ' + (j.checked || 0) + ' document(s); ' + (j.results || []).filter((x) => x.changed).length + ' changed');
        });
        S.docsDb = null; A.route();
      } catch (_) {}
    };
    const showLink = (bg, tok, email, days) => { const link = location.origin + location.pathname + '#/invite/' + tok; qs('#out', bg).innerHTML = `<p class="sm">Invitation for <b>${esc(email)}</b>, valid ${days}. Shown only now.</p><div class="linkbox mono xs">${esc(link)}</div><div class="btn-row" style="justify-content:flex-end"><button class="btn ghost" id="cp">Copy</button><button class="btn" data-close id="dn">Done</button></div>`; qs('#cp', bg).onclick = () => navigator.clipboard.writeText(link).then(() => toast('Copied')); qs('#dn', bg).onclick = () => { bg.remove(); A.route(); }; };
    qs('#newOrg', c).onclick = () => modal(`<h2>Create organization</h2><form id="f"><label>Name<input name="n" required></label><label>Type<select name="k"><option value="dpe_practice">DPE practice</option><option value="flight_school">Flight school</option><option value="flight_department">Flight department</option></select></label>
      <label class="check sm"><input type="checkbox" name="me" checked><span>Add me as administrator and examiner</span></label><div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Create</button></div></form>`, (bg, close) => {
      qs('#f', bg).onsubmit = async (e) => { e.preventDefault(); const f = e.target; try { const id = await act(qs('button:not([data-close])', f), () => rpc('create_org', { p_name: f.n.value.trim(), p_kind: f.k.value, p_admin_self: f.me.checked }), 'Organization created'); close(); S.ctx = await rpc('my_context'); S.orgId = id; localStorage.setItem('spoa_org', id); go('#/home'); } catch (_) {} };
    });
    qsa('[data-oi]', c).forEach((b) => b.onclick = () => modal(`<h2>Invite organization administrator</h2><form id="f"><label>Email<input name="e" type="email" required></label><div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Create invitation</button></div></form><div id="out"></div>`, (bg) => {
      qs('#f', bg).onsubmit = async (e) => { e.preventDefault(); try { const tok = await act(qs('button:not([data-close])', e.target), () => rpc('create_invitation', { p_org: b.dataset.oi, p_email: e.target.e.value.trim(), p_roles: ['org_admin'] })); qs('#f', bg).style.display = 'none'; showLink(bg, tok, e.target.e.value, '7 days'); } catch (_) {} };
    }));
    qs('#ownInv', c).onclick = () => modal(`<h2>Invite platform owner</h2><form id="f"><label>Email<input name="e" type="email" required></label><div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Create invitation</button></div></form><div id="out"></div>`, (bg) => {
      qs('#f', bg).onsubmit = async (e) => { e.preventDefault(); try { const tok = await act(qs('button:not([data-close])', e.target), () => rpc('create_invitation', { p_org: null, p_email: e.target.e.value.trim(), p_roles: null })); qs('#f', bg).style.display = 'none'; showLink(bg, tok, e.target.e.value, '72 hours'); } catch (_) {} };
    });
  }

  A.addRoute(/^\/debrief\/([\w-]+)$/, viewDebrief);
  A.addRoute(/^\/questions$/, viewQuestions);
  A.addRoute(/^\/reports$/, viewReports);
  A.addRoute(/^\/members$/, viewMembers);
  A.addRoute(/^\/settings$/, viewSettings);
  A.addRoute(/^\/standards$/, viewStandards);
  A.addRoute(/^\/audit$/, viewAudit);
  A.addRoute(/^\/platform$/, viewPlatform);
})();

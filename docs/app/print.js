/* smartPOA print documents: plan of action, proof of compliance, applicant packet, paper grade sheet, result. */
(function () {
  'use strict';
  const A = window.SPOA; const E = window.SPE;
  const { sb, S, esc, qs, fmtDate, fmtDT, q, rpc, shell, loadStd, stdDoc, can } = A;
  const DISCLAIMER = 'smartPOA documents the design of this plan of action against the cited FAA requirements. It is evidence of plan design, not FAA approval or acceptance. Summaries of FAA Orders, Notices and Advisory Circulars are unofficial; the current FAA document governs. The examiner remains responsible for the conduct of the test.';
  const STATUS = { met: 'MET', gap: 'GAP', review: 'REVIEW', attested: 'ATTESTED' };

  async function load(id) {
    await loadStd(); if (!S.docsDb) await A.loadDocsDb();
    const p = await q(sb.from('poas').select('*').eq('id', id).single());
    const doc = stdDoc(p.standard_id);
    const [app, ac, mem, dbs, prior] = await Promise.all([
      p.applicant_id ? q(sb.from('applicants').select('*').eq('id', p.applicant_id).single()) : null,
      p.aircraft_id ? q(sb.from('aircraft').select('*').eq('id', p.aircraft_id).single()) : null,
      rpc('org_members_list', { p_org: p.org_id }),
      q(sb.from('debriefs').select('*').eq('poa_id', p.id).order('created_at', { ascending: false }).limit(1)),
      q(sb.from('poas').select('id,title,content').eq('org_id', p.org_id).eq('examiner_id', p.examiner_id).neq('id', p.id).neq('status', 'void').order('created_at', { ascending: false }).limit(25)),
    ]);
    const ex = (mem || []).find((m) => m.user_id === p.examiner_id) || {};
    const tasks = E.requiredTasks(doc, p.test_profile);
    const docStatus = ((S.docsDb || []).find((d) => d.id === doc.id) || {}).status || 'current';
    const comp = E.complianceChecks({ doc, profile: p.test_profile, tasks, content: p.content, priorPoas: prior, aktr: p.content.aktr || [], docStatus, lastCheck: S.lastCheck });
    return { p, doc, app, ac, ex, debrief: dbs[0], tasks, comp, org: A.org() };
  }
  function frame(box, title, back, body) {
    const c = box;
    document.title = title + ' — smartPOA';
    c.innerHTML = `<div class="print-bar"><a class="btn ghost" href="${back}">Back</a><button class="btn" id="doPrint">Print or save as PDF</button><span class="xs muted">Letter size. Use your browser's "Save as PDF" to file a copy.</span></div>${body}`;
    qs('#doPrint', c).onclick = () => window.print();
  }
  const docHead = (kind, x) => `<div class="doc-head"><div><div class="xs" style="letter-spacing:.08em;text-transform:uppercase;color:#555">${esc(kind)}</div><h1>${esc(x.p.title)}</h1></div><div class="xs" style="text-align:right">smartPOA · ${esc(x.org ? x.org.name : '')}<br>Version ${x.p.version} · ${esc(x.p.status === 'draft' ? 'DRAFT' : x.p.status.toUpperCase())}</div></div>`;
  const meta = (x) => `<div class="meta">
    <div><b>Applicant</b>${esc(x.app ? x.app.first_name + ' ' + x.app.last_name : '—')}</div>
    <div><b>Purpose</b>${esc(E.PURPOSE_LABEL[x.p.purpose])}</div>
    <div><b>Test date</b>${esc(fmtDate(x.p.test_date) || '—')}</div>
    <div><b>Standard</b>${esc(x.doc.num)} (${esc(x.doc.edition_date)})</div>
    <div><b>Certificate / class</b>${esc(E.CERT_LABEL[x.p.test_profile.cert] || '')} · ${esc(x.p.test_profile.cls)}${x.p.test_profile.typeDesignator ? ' · ' + esc(x.p.test_profile.typeDesignator) : ''}</div>
    <div><b>Aircraft</b>${esc(x.ac ? x.ac.tail + ' — ' + x.ac.make_model : '—')}</div>
    <div><b>Examiner</b>${esc(x.ex.full_name || x.ex.email || '')}${x.ex.examiner_info && x.ex.examiner_info.kind ? ' · ' + esc(x.ex.examiner_info.kind) : ''}</div>
    <div><b>Location</b>${esc(x.p.location || '—')}</div>
    <div><b>Recommending instructor</b>${esc(x.app && x.app.recommending_instructor || '—')}</div></div>`;
  const foot = (x, extra) => `<div class="foot">${extra || ''}Plan fingerprint (SHA-256): <span style="font-family:var(--mono)">${esc(x.p.content_hash || 'not finalized')}</span><br>Standard file fingerprint: <span style="font-family:var(--mono)">${esc(x.p.standard_sha256 || '')}</span><br>Printed ${esc(fmtDT(new Date().toISOString()))}. ${esc(DISCLAIMER)}</div>`;
  const nl = (s) => esc(s || '').replace(/\n/g, '<br>');
  const included = (x) => x.tasks.filter((t) => x.p.content.tasks[t.key] && x.p.content.tasks[t.key].included);
  const byArea = (list) => { const out = []; list.forEach((t) => { let a = out.find((y) => y.area === t.area); if (!a) out.push(a = { area: t.area, list: [] }); a.list.push(t); }); return out; };
  const elText = (x, t) => { const codes = E.elementCodes(x.doc, t.area, t.task); const sel = new Set(x.p.content.tasks[t.key].elements || []); return t.task.elements.map((e, i) => sel.has(codes[i]) ? { code: codes[i], e } : null).filter(Boolean); };

  async function printPoa(m) {
    const box = shell('poas'); const x = await load(m[1]); if (!box.isConnected) return; const c = x.p.content; const sc = c.scenario || {};
    const qsByTask = {}; (c.questions || []).forEach((qq) => { (qsByTask[qq.task || '_'] = qsByTask[qq.task || '_'] || []).push(qq); });
    frame(box, 'Plan of action', '#/poa/' + x.p.id, `<div class="doc">${docHead('Plan of action', x)}${meta(x)}
      ${x.p.status === 'draft' ? '<p style="color:#a11c2d;font-weight:700">DRAFT — not finalized.</p>' : ''}
      ${testDetails(x)}
      <h2>Pretest briefing</h2><p>${nl(c.briefings && c.briefings.pretest)}</p>
      <h2>Scenario</h2><p><b>${esc(sc.missionName || 'Mission')}</b>${sc.dep || sc.dest ? ' — ' + esc([sc.dep, sc.dest].filter(Boolean).join(' to ')) + (sc.alt ? ', alternate ' + esc(sc.alt) : '') : ''}</p><p>${nl(sc.mission)}</p>
      ${sc.route || sc.pax || sc.weather || sc.constraints ? `<table><tbody>${[['Route / altitude', sc.route], ['Passengers & cargo', sc.pax], ['Weather', sc.weather], ['Constraints', sc.constraints]].filter((r) => r[1]).map((r) => `<tr><th style="width:24%">${r[0]}</th><td>${nl(r[1])}</td></tr>`).join('')}</tbody></table>` : ''}
      ${(sc.triggers || []).length ? `<h3>Planned events (examiner only)</h3><table><thead><tr><th>Phase</th><th>Event</th><th>Expected response</th><th>Tasks</th></tr></thead><tbody>${sc.triggers.map((t) => `<tr class="avoid"><td>${esc(t.phase)}</td><td><b>${esc(t.name)}</b><br>${esc(t.text)}</td><td>${esc(t.expected || '')}</td><td style="font-family:var(--mono);font-size:8pt">${esc((t.covers || []).join(' '))}</td></tr>`).join('')}</tbody></table>` : ''}
      <h2>Preflight briefing</h2><p>${nl(c.briefings && c.briefings.preflight)}</p>
      <h2 class="pb">Tasks and elements</h2><p class="xs">Tasks from ${esc(x.doc.num)}. ${x.doc.kind === 'ACS' ? 'K = knowledge, R = risk management, S = skill.' : ''} Method: O = oral, F = flight, B = both.</p>
      ${byArea(included(x)).map(({ area, list }) => `<h3>${esc(area.roman)}. ${esc(area.title)}</h3><table><thead><tr><th style="width:12%">Task</th><th>Elements to evaluate</th><th style="width:5%">M</th></tr></thead><tbody>${list.map((t) => { const ct = c.tasks[t.key]; const els = elText(x, t); const qq = qsByTask[t.key] || []; const tsc = (sc.taskScenarios || {})[t.key]; return `<tr class="avoid"><td><b style="font-family:var(--mono)">${esc(t.key)}</b><br>${esc(t.task.title_plain || t.task.title)}${t.task.quick ? `<div style="font-size:8pt;margin-top:.2em">Std: ${esc(t.task.quick)}</div>` : ''}</td><td>${tsc ? `<div style="margin-bottom:.25em"><b>Scenario:</b> ${esc(tsc)}</div>` : ''}${els.map((y) => `<div><span style="font-family:var(--mono);font-size:8pt">${esc(y.code)}</span> ${esc(y.e.text)}</div>`).join('')}${qq.length ? `<div style="margin-top:.3em;border-top:1px dotted #999;padding-top:.2em"><i></i>${qq.map((z) => `<div>• ${esc(z.prompt)}${z.expected ? `<div style="font-size:8pt;margin-left:.8em;color:#333">Expected: ${esc(z.expected)}</div>` : ''}</div>`).join('')}</div>` : ''}</td><td>${esc({ oral: 'O', flight: 'F', both: 'B' }[ct.method] || '')}</td></tr>`; }).join('')}</tbody></table>`).join('')}
      ${(qsByTask._ || []).length ? `<h3>Other questions</h3>${qsByTask._.map((z) => `<div>• ${esc(z.prompt)}</div>`).join('')}` : ''}
      ${flightChecklist(x)}
      <h2>Postflight debriefing</h2><p>${nl(c.briefings && c.briefings.postflight)}</p>
      <div class="sig"><div>Examiner signature / date</div><div>Applicant acknowledgment of briefing / date</div></div>${foot(x)}</div>`);
  }
  // Header block and flight-portion checklist carried over from the JPJ plan of action.
  function testDetails(x) {
    const a = x.app || {}; const cr = x.p.content.checkride || {}; const kt = a.knowledge_test || {};
    const rows = [['Certificate no. (last 4)', a.cert_number_last4], ['FTN', a.ftn], ['Preapproval no.', cr.preapproval_number], ['Flight school', a.school],
      ['Recommending instructor', [a.recommending_instructor, a.instructor_cert_number ? 'cert. ' + a.instructor_cert_number : ''].filter(Boolean).join(', ')],
      ['Checkride date / time', cr.scheduled_at ? fmtDT(cr.scheduled_at) : fmtDate(x.p.test_date)], ['Departure airport', (x.p.content.scenario || {}).dep || x.p.location],
      ['Type of practical test', cr.test_type || E.PURPOSE_LABEL[x.p.purpose]], ['Applied for on basis of', cr.basis], ['ACS / PTS version', x.doc.num + ' (' + x.doc.edition_date + ')'],
      ['Aircraft make and model', x.ac ? x.ac.make_model : cr.aircraft], ['AKTR incorrect answers', (x.p.content.aktr || kt.aktr || []).join(', ') || 'None recorded'], ['Evaluator notes', cr.notes]];
    return `<table class="avoid"><tbody>${rows.map(([k, v]) => `<tr><th style="width:28%">${k}</th><td>${esc(v || '—')}</td></tr>`).join('')}</tbody></table>`;
  }
  function flightChecklist(x) {
    const c = x.p.content; const list = included(x).filter((t) => (c.tasks[t.key].method || 'oral') !== 'oral');
    if (!list.length) return '';
    return `<h2 class="pb">Flight portion checklist</h2><p class="xs">Tick each task as completed. Std = examiner tolerance summary; the ACS skill elements govern.</p>
      <table><tbody>${byArea(list).map(({ area, list: l }) => `<tr><th colspan="2">${esc(area.roman)}. ${esc(area.title)}</th></tr>${l.map((t) => `<tr class="avoid"><td style="width:11%;white-space:nowrap">_____ ${esc(t.task.letter)}</td><td>${esc(t.task.title_plain || t.task.title)}${t.task.quick ? ` <span style="font-size:8pt">— ${esc(t.task.quick)}${t.task.quick_src === 'examiner' ? ' (examiner practice)' : ''}</span>` : ''}</td></tr>`).join('')}`).join('')}</tbody></table>`;
  }

  async function printProof(m) {
    const box = shell('poas'); const x = await load(m[1]); if (!box.isConnected) return; const regs = S.regs; const cfr = regs.cfr;
    const reqT = x.tasks.filter((t) => t.required); const inc = included(x);
    const excluded = reqT.filter((t) => !inc.includes(t));
    const cfrQuote = (sec, re) => { const s = cfr[sec]; if (!s) return ''; const ps = s.paragraphs.filter((pp) => re.test(pp)); return ps.length ? `<div class="quote" style="font-size:8.5pt">“${ps.map(esc).join(' ')}”</div>` : ''; };
    const cfrFor = { cfr_61_43: () => cfrQuote('61.43', /^\(a\)|^\(1\) Performing|^\(2\) Demonstrating mastery/), cfr_61_39: () => cfrQuote('61.39', /^\(a\)/), cfr_61_45: () => cfrQuote('61.45', /^\(a\)/), crew: () => cfrQuote('61.43', /^\(b\)/) };
    frame(box, 'Proof of compliance', '#/poa/' + x.p.id, `<div class="doc">${docHead('Proof of compliance — plan of action', x)}${meta(x)}
      ${x.p.status === 'draft' ? '<p style="color:#a11c2d;font-weight:700">DRAFT PREVIEW — the plan is not finalized; results may change.</p>' : ''}
      <h2>Summary</h2><table><tbody><tr><th style="width:30%">Governing standard</th><td>${esc(x.doc.num)} — ${esc(x.doc.title)}, ${esc(x.doc.edition_date)}. Incorporated by reference in 14 CFR 61.14; required by 14 CFR 61.43(a)(1). <br><span style="font-size:8pt">${esc(x.doc.url)}</span></td></tr>
      <tr><th>Source status</th><td>${esc((((S.docsDb || []).find((d) => d.id === x.doc.id)) || {}).status || 'current')} in the smartPOA source registry${S.lastCheck ? '; last FAA file check ' + esc(S.lastCheck) : ''}.</td></tr>
      <tr><th>Required tasks</th><td>${reqT.length} required for this profile; ${reqT.length - excluded.length} in the plan.${excluded.length ? ' Not in plan: ' + excluded.map((t) => esc(t.key) + (x.p.content.tasks[t.key] && x.p.content.tasks[t.key].excludeReason ? ' (' + esc(x.p.content.tasks[t.key].excludeReason) + ')' : '')).join(', ') : ''}</td></tr>
      <tr><th>Result</th><td><b>${x.comp.counts.met || 0} met · ${x.comp.counts.attested || 0} examiner-attested · ${x.comp.counts.review || 0} review · ${x.comp.counts.gap || 0} gap</b></td></tr></tbody></table>
      <h2>Compliance matrix</h2><table><thead><tr><th style="width:38%">Requirement (quoted)</th><th style="width:10%">Status</th><th>How this plan complies</th></tr></thead><tbody>
      ${x.comp.rows.map((r) => { const qt = r.quoteKey ? regs.quotes[r.quoteKey] : null; const url = r.url || (qt && qt.url); return `<tr class="avoid"><td><b>${esc(qt ? qt.src : r.cite)}</b>${qt ? `<div class="quote" style="font-size:8.5pt">“${esc(qt.text)}”${qt.paraphrase ? ' <i>(unofficial summary)</i>' : ''}</div>` : (cfrFor[r.id] ? cfrFor[r.id]() : '')}${url ? `<div style="font-size:7.5pt;word-break:break-all">${esc(url)}</div>` : ''}</td><td class="st-${r.status}">${STATUS[r.status]}</td><td>${esc(r.evidence)}</td></tr>`; }).join('')}</tbody></table>
      <h2>Task traceability</h2><table><thead><tr><th style="width:12%">Task</th><th>Title</th><th style="width:22%">Basis</th><th style="width:15%;white-space:nowrap">K / R / S</th></tr></thead><tbody>
      ${reqT.map((t) => { const ct = x.p.content.tasks[t.key] || {}; const sel = new Set(ct.elements || []); const codes = E.elementCodes(x.doc, t.area, t.task); const cnt = (ty) => t.task.elements.filter((e, i) => e.type === ty && sel.has(codes[i])).length + '/' + t.task.elements.filter((e) => e.type === ty).length; return `<tr><td style="font-family:var(--mono)">${esc(t.key)}</td><td>${esc(t.task.title_plain || t.task.title)}${ct.included ? '' : ' <b>— not in plan</b>'}</td><td>${esc(t.reason)}</td><td style="font-size:8pt;white-space:nowrap">${x.doc.kind === 'ACS' ? cnt('K') + ' ' + cnt('R') + ' ' + cnt('S') : 'all'}</td></tr>`; }).join('')}</tbody></table>
      <h2>Eligibility confirmed by examiner</h2><p>${Object.entries(x.p.content.eligibility || {}).filter(([, v]) => v).map(([k, v]) => esc(typeof v === 'string' ? k + ': ' + v : k)).join(' · ') || 'None recorded.'}</p>
      <div class="sig"><div>Examiner signature / date</div><div>Reviewed by (managing specialist, optional) / date</div></div>
      ${foot(x, `14 CFR text from eCFR as of ${esc(regs.cfr_as_of)}. FAA document quotes retrieved ${esc(regs.retrieved)}.<br>`)}</div>`);
  }

  async function printPacket(m) {
    const box = shell('poas'); const x = await load(m[1]); if (!box.isConnected) return; const c = x.p.content; const sc = c.scenario || {};
    frame(box, 'Applicant packet', '#/poa/' + x.p.id, `<div class="doc"><div class="doc-head"><div><div class="xs" style="letter-spacing:.08em;text-transform:uppercase;color:#555">Applicant preparation packet</div><h1>${esc(E.CERT_LABEL[x.p.test_profile.cert] || '')} ${esc(x.p.test_profile.cls)} — ${esc(E.PURPOSE_LABEL[x.p.purpose])}</h1></div><div class="xs" style="text-align:right">${esc(x.org ? x.org.name : '')}</div></div>
      <div class="meta"><div><b>Applicant</b>${esc(x.app ? x.app.first_name + ' ' + x.app.last_name : '')}</div><div><b>Date</b>${esc(fmtDate(x.p.test_date) || 'TBD')}</div><div><b>Location</b>${esc(x.p.location || 'TBD')}</div><div><b>Aircraft</b>${esc(x.ac ? x.ac.tail + ' — ' + x.ac.make_model : 'TBD')}</div><div><b>Standard</b>${esc(x.doc.num)}</div><div><b>Examiner</b>${esc(x.ex.full_name || '')}</div></div>
      <h2>Your scenario</h2><p><b>${esc([sc.dep, sc.dest].filter(Boolean).join(' to ') || 'Planned flight')}</b>${sc.alt ? ' · Alternate ' + esc(sc.alt) : ''}</p><p>${nl(sc.mission)}</p>
      <table><tbody>${[['Route / altitude', sc.route], ['Passengers & cargo', sc.pax], ['Weather', sc.weather], ['Constraints', sc.constraints]].filter((r) => r[1]).map((r) => `<tr><th style="width:24%">${r[0]}</th><td>${nl(r[1])}</td></tr>`).join('')}</tbody></table>
      <p>Plan this flight as you would for real: weather, performance, weight and balance, navigation log, fuel, NOTAMs, and your personal minimums. Be ready to explain your decisions.</p>
      <h2>Bring with you</h2><table><tbody>${['Government-issued photo identification', 'Pilot certificate and medical certificate (or BasicMed documents), if applicable', 'Completed IACRA application (FTN and login)', 'Airman Knowledge Test Report, if required', 'Logbook with required endorsements and aeronautical experience', 'Aircraft documents and maintenance records; POH/AFM', 'Current charts / EFB, plotter and E6B as needed', 'Completed flight plan, navigation log, weight and balance and performance calculations', 'Examiner fee'].map((y) => `<tr><td style="width:5%"><span class="box"></span></td><td>${esc(y)}</td></tr>`).join('')}</tbody></table>
      <h2>How the test works</h2><p>${nl(c.briefings && c.briefings.pretest)}</p>
      <p class="xs">The test follows ${esc(x.doc.num)}, available free from the FAA: ${esc(x.doc.url)}</p>
      <div class="foot">Prepared with smartPOA. The examiner may change the scenario on the day of the test for safety, weather or other reasons.</div></div>`);
  }

  async function printSheet(m) {
    const box = shell('poas'); const x = await load(m[1]); if (!box.isConnected) return;
    const link = location.origin + location.pathname + '#/debrief/' + x.p.id + '?paper=1';
    let qr = '';
    try { const g = window.qrcode(0, 'M'); g.addData(link); g.make(); qr = g.createSvgTag({ cellSize: 3, margin: 0 }); } catch (_) {}
    const gradeBoxes = '<span class="box"></span>S <span class="box"></span>U <span class="box"></span>NT';
    frame(box, 'Grade sheet', '#/poa/' + x.p.id, `<div class="doc"><div class="doc-head"><div><div class="xs" style="letter-spacing:.08em;text-transform:uppercase;color:#555">Practical test grade sheet</div><h1>${esc(x.p.title)}</h1></div><div style="text-align:right">${qr}<div class="xs">Scan to enter results</div></div></div>${meta(x)}
      <table><tbody><tr><th style="width:16%">Ground start</th><td style="width:17%"></td><th style="width:16%">Ground end</th><td style="width:17%"></td><th style="width:16%">Oral (min)</th><td></td></tr><tr><th>Engine start</th><td></td><th>Shutdown</th><td></td><th>Flight (hrs)</th><td></td></tr></tbody></table>
      ${byArea(included(x)).map(({ area, list }) => `<h3>${esc(area.roman)}. ${esc(area.title)}</h3><table><thead><tr><th style="width:11%">Task</th><th>Title / elements</th><th style="width:17%">Grade</th><th style="width:26%">Unsat codes / notes</th></tr></thead><tbody>${list.map((t) => `<tr class="avoid"><td style="font-family:var(--mono)"><b>${esc(t.key)}</b></td><td>${esc(t.task.title_plain || t.task.title)}<div style="font-family:var(--mono);font-size:7pt;color:#444">${elText(x, t).map((y) => esc(y.code.split('.').slice(3).join('.'))).join(' ')}</div></td><td style="white-space:nowrap;font-size:8.5pt">${gradeBoxes}</td><td></td></tr>`).join('')}</tbody></table>`).join('')}
      <h2>Outcome</h2><p><span class="box"></span>Pass — temporary certificate issued &nbsp; <span class="box"></span>Disapproved — Notice of Disapproval &nbsp; <span class="box"></span>Discontinued — Letter of Discontinuance</p>
      <h3>Remarks</h3><div class="lines"></div><div class="lines"></div><div class="lines"></div><div class="lines"></div>
      <div class="sig"><div>Examiner signature / date</div><div>Entered into smartPOA by / date</div></div>
      <div class="foot">Enter this sheet into smartPOA (scan the code above) and attach a scan of it to the applicant record. Element codes are abbreviated after the task code. ${esc(x.doc.num)}.</div></div>`);
  }

  async function printResult(m) {
    const box = shell('poas'); const x = await load(m[1]); if (!box.isConnected) return; const d = x.debrief;
    if (!d) { frame(box, 'Result', '#/poa/' + x.p.id, '<div class="banner warn">No debrief recorded.</div>'); return; }
    const inc = included(x);
    frame(box, 'Result', '#/debrief/' + x.p.id, `<div class="doc">${docHead('Practical test result', x)}${meta(x)}
      <table><tbody><tr><th style="width:24%">Outcome</th><td><b>${esc({ pass: 'PASS', fail: 'DISAPPROVED', discontinued: 'DISCONTINUED', incomplete: 'INCOMPLETE' }[d.outcome] || '—')}</b></td></tr><tr><th>Test date</th><td>${esc(fmtDate(d.test_date))}</td></tr>
      <tr><th>Unsatisfactory ACS codes</th><td style="font-family:var(--mono)">${esc((d.unsat_codes || []).join(', ') || 'None')}</td></tr><tr><th>Oral / flight</th><td>${esc(d.oral_minutes ? d.oral_minutes + ' min' : '—')} / ${esc(d.flight_hours ? d.flight_hours + ' h' : '—')}</td></tr><tr><th>Entry</th><td>${esc(d.entry_mode === 'paper' ? 'Transcribed from paper grade sheet' : 'Recorded on tablet')}</td></tr></tbody></table>
      ${d.outcome === 'discontinued' || d.outcome === 'fail' ? `<p class="xs">Under 14 CFR 61.43(f), tasks completed satisfactorily may be credited for the retest if it is taken within 60 days.</p>` : ''}
      <h2>Task results</h2><table><thead><tr><th style="width:12%">Task</th><th>Title</th><th style="width:8%">Grade</th><th>Notes</th></tr></thead><tbody>${inc.map((t) => { const r = (d.results || {})[t.key] || {}; return `<tr><td style="font-family:var(--mono)">${esc(t.key)}</td><td>${esc(t.task.title_plain || t.task.title)}</td><td><b>${esc(r.grade || '—')}</b></td><td>${esc([(r.codes || []).join(', '), r.note].filter(Boolean).join(' — '))}</td></tr>`; }).join('')}</tbody></table>
      <h2>Remarks</h2><p>${nl(d.remarks)}</p>
      <div class="foot">Signed ${esc(fmtDT(d.signed_at))}. Result fingerprint (SHA-256): <span style="font-family:var(--mono)">${esc(d.signed_hash || 'unsigned')}</span><br>The official record of the test is the FAA IACRA/airman record and any notice issued under FAA procedures. ${esc(DISCLAIMER)}</div></div>`);
  }

  A.addRoute(/^\/print\/poa\/([\w-]+)$/, printPoa);
  A.addRoute(/^\/print\/proof\/([\w-]+)$/, printProof);
  A.addRoute(/^\/print\/packet\/([\w-]+)$/, printPacket);
  A.addRoute(/^\/print\/sheet\/([\w-]+)$/, printSheet);
  A.addRoute(/^\/print\/result\/([\w-]+)$/, printResult);
})();

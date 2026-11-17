/* smartPOA Data Review: records flagged for correction (import findings and examiner notes) plus automatic
   checks that run against current records. Automatic items clear themselves once the record is fixed;
   flagged items are closed by marking them resolved or dismissed with a note. */
(function () {
  'use strict';
  const A = window.SPOA;
  const { sb, S, esc, qs, qsa, fmtDate, fmtDT, q, act, toast, org, can, shell, head, modal, noOrg } = A;

  const SEV = { error: ['bad', 'Correction needed'], warning: ['warn', 'Check'], question: ['info', 'Confirm'] };
  const ENT = { applicant: 'Applicant', checkride: 'Checkride', aircraft: 'Aircraft', briefing: 'Pre-test checklist', standards: 'Standards', settings: 'Settings', org: 'Organization' };
  const sevPill = (s) => `<span class="pill ${SEV[s][0]}">${SEV[s][1]}</span>`;
  const FTN_RE = /^[A-Z]\d{7}$/;

  function linkFor(f) {
    if (f.entity === 'applicant' && f.entity_id) return '#/applicant/' + f.entity_id;
    if (f.entity === 'checkride' && f.entity_id) return '#/schedule?all=1&open=' + f.entity_id;
    if (f.entity === 'aircraft') return '#/aircraft';
    if (f.entity === 'briefing') { const [g, t] = (f.field || '').split('|'); return '#/org-settings' + (t ? '?g=' + encodeURIComponent(g) + '&t=' + encodeURIComponent(t) : ''); }
    if (f.entity === 'standards') return '#/standards';
    if (f.entity === 'settings' || f.entity === 'org') return '#/org-settings';
    return null;
  }
  const nm = (a) => a ? a.last_name + ', ' + a.first_name : 'No applicant';

  // Rules that run against the current records.
  function liveChecks(apps, crs) {
    const out = []; const AP = Object.fromEntries(apps.map((a) => [a.id, a]));
    const day = Date.now() - 24 * 3600e3;
    const byFtn = {};
    apps.forEach((a) => {
      if (a.ftn) (byFtn[a.ftn.trim().toUpperCase()] = byFtn[a.ftn.trim().toUpperCase()] || []).push(a);
      if (!a.ftn) out.push({ entity: 'applicant', entity_id: a.id, field: 'ftn', severity: 'warning', title: 'FTN missing', detail: nm(a) + ' has no FAA Tracking Number.' });
      else if (!FTN_RE.test(a.ftn.trim().toUpperCase())) out.push({ entity: 'applicant', entity_id: a.id, field: 'ftn', severity: 'error', title: 'FTN format looks wrong', detail: nm(a) + ': "' + a.ftn + '". An FTN is one letter followed by 7 digits (8 characters).' });
      if (/,/.test(a.first_name + a.last_name)) out.push({ entity: 'applicant', entity_id: a.id, field: 'name', severity: 'warning', title: 'Name contains a comma', detail: '"' + a.first_name + ' ' + a.last_name + '". Enter first and last name in their own fields.' });
    });
    Object.entries(byFtn).forEach(([ftn, list]) => { if (list.length > 1) list.forEach((a) => out.push({ entity: 'applicant', entity_id: a.id, field: 'duplicate', severity: 'error', title: 'Duplicate applicant', detail: list.length + ' applicant records share FTN ' + ftn + ': ' + list.map(nm).join('; ') + '. Keep one and move checkrides to it.' })); });
    crs.forEach((r) => {
      const a = AP[r.applicant_id]; const when = r.scheduled_at ? fmtDT(r.scheduled_at) : 'no date';
      const label = nm(a) + ' — ' + (r.test_type || '') + ', ' + when;
      if (!r.result && r.scheduled_at && new Date(r.scheduled_at).getTime() < day) out.push({ entity: 'checkride', entity_id: r.id, field: 'result', severity: 'error', title: 'Outcome not recorded', detail: label + '. Enter the result (temporary certificate, disapproval, discontinuance or cancelled). Reports leave it out until then.' });
      if (['temporary', 'disapproval', 'discontinuance'].includes(r.result) && r.ground_time == null && r.flight_time == null) out.push({ entity: 'checkride', entity_id: r.id, field: 'times', severity: 'warning', title: 'Ground and flight time missing', detail: label + '. A completed test should have ground and flight time for reports.' });
      if (!r.applicant_id && r.result !== 'cancelled') out.push({ entity: 'checkride', entity_id: r.id, field: 'applicant', severity: 'warning', title: 'No applicant linked', detail: 'Checkride on ' + when + ' has no applicant.' });
      if (r.grade_sought === 'instrument' && /^(Original Certificate|Additional Rating|Retest for Original Certificate)$/.test(r.test_type)) out.push({ entity: 'checkride', entity_id: r.id, field: 'test_type', severity: 'warning', title: 'Test type does not match grade', detail: label + '. Instrument tests use "Instrument Rating" or "Retest for Instrument Rating".' });
    });
    return out;
  }

  async function viewDataReview(m, params) {
    const c = shell('data-review'); if (!org()) return noOrg(c);
    const edit = can('org_admin', 'examiner', 'office');
    const [flags, apps, crs] = await Promise.all([
      q(sb.from('data_flags').select('*').eq('org_id', S.orgId).order('created_at', { ascending: true })),
      q(sb.from('applicants').select('id,first_name,last_name,ftn,archived').eq('org_id', S.orgId).eq('archived', false)),
      q(sb.from('checkrides').select('id,applicant_id,scheduled_at,test_type,grade_sought,result,ground_time,flight_time').eq('org_id', S.orgId)),
    ]);
    const st = { status: params.get('status') || 'open', ent: params.get('ent') || '' };
    const openKey = new Set(flags.filter((f) => f.status === 'open').map((f) => f.entity_id + '|' + f.field));
    const live = liveChecks(apps, crs).filter((x) => !openKey.has(x.entity_id + '|' + x.field));
    const counts = { open: flags.filter((f) => f.status === 'open').length, resolved: flags.filter((f) => f.status === 'resolved').length, dismissed: flags.filter((f) => f.status === 'dismissed').length };

    const row = (f, isLive) => {
      const href = linkFor(f);
      return `<div class="flag-row"><div>${sevPill(f.severity)}</div>
        <div><div class="strong sm">${esc(f.title)} <span class="xs muted">· ${esc(ENT[f.entity] || f.entity)}${f.source === 'airtable_import' ? ' · from Airtable import' : ''}</span></div>
        ${f.detail ? `<div class="sm detail">${esc(f.detail)}</div>` : ''}${f.suggested ? `<div class="xs" style="margin-top:.2rem"><b>Suggested:</b> ${esc(f.suggested)}</div>` : ''}
        ${f.status && f.status !== 'open' ? `<div class="xs muted" style="margin-top:.2rem">${f.status === 'resolved' ? 'Resolved' : 'Dismissed'} ${esc(fmtDate(f.resolved_at))}${f.resolution_note ? ' — ' + esc(f.resolution_note) : ''}</div>` : ''}</div>
        <div class="acts">${href ? `<a class="btn sm ghost" href="${href}">Open record</a>` : ''}${!isLive && edit ? (f.status === 'open' ? `<button class="btn sm" data-res="${f.id}">Mark resolved</button><button class="btn sm ghost" data-dis="${f.id}">Dismiss</button>` : `<button class="btn sm ghost" data-re="${f.id}">Reopen</button>`) : ''}</div></div>`;
    };
    const shown = flags.filter((f) => (st.status === 'all' || f.status === st.status) && (!st.ent || f.entity === st.ent));
    const liveShown = st.status === 'open' || st.status === 'all' ? live.filter((x) => !st.ent || x.entity === st.ent) : [];
    const ord = { error: 0, warning: 1, question: 2 };
    shown.sort((a, b) => ord[a.severity] - ord[b.severity]);
    liveShown.sort((a, b) => ord[a.severity] - ord[b.severity]);

    c.innerHTML = head('Data Review', 'Records flagged for correction. Open the record, fix it, then mark the flag resolved. Automatic checks clear on their own once the record is fixed.', edit ? '<button class="btn ghost" id="addF">Add a flag</button>' : '') +
      `<div class="kpis"><div class="kpi"><div class="kpi-label">Open flags</div><div class="kpi-value">${counts.open}</div></div><div class="kpi"><div class="kpi-label">Automatic check findings</div><div class="kpi-value">${live.length}</div></div><div class="kpi"><div class="kpi-label">Resolved</div><div class="kpi-value">${counts.resolved}</div></div><div class="kpi"><div class="kpi-label">Dismissed</div><div class="kpi-value">${counts.dismissed}</div></div></div>
      <div class="card"><div class="form-grid"><label>Status<select id="fs">${[['open', 'Open'], ['resolved', 'Resolved'], ['dismissed', 'Dismissed'], ['all', 'All']].map(([k, l]) => `<option value="${k}" ${k === st.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Record type<select id="fe"><option value="">All types</option>${Object.entries(ENT).map(([k, l]) => `<option value="${k}" ${k === st.ent ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div></div>
      ${liveShown.length ? `<div class="card"><div class="card-head"><h2>Automatic checks</h2><span class="xs muted">${liveShown.length} finding(s) from the current records</span></div>${liveShown.map((x) => row(x, true)).join('')}</div>` : ''}
      <div class="card"><div class="card-head"><h2>Flagged for correction</h2><span class="xs muted">${shown.length} item(s)</span></div>${shown.length ? shown.map((f) => row(f, false)).join('') : `<div class="empty sm">${st.status === 'open' ? 'No open flags.' : 'Nothing here.'}</div>`}</div>`;

    const reload = () => viewDataReview(m, new URLSearchParams({ status: st.status, ent: st.ent }));
    qs('#fs', c).onchange = (e) => { st.status = e.target.value; reload(); };
    qs('#fe', c).onchange = (e) => { st.ent = e.target.value; reload(); };
    const close = (id, status) => modal(`<h2>${status === 'resolved' ? 'Mark resolved' : 'Dismiss flag'}</h2><form id="rf"><label>${status === 'resolved' ? 'What was corrected?' : 'Why is no change needed?'}<textarea name="n" required style="min-height:90px"></textarea></label>
      <div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">${status === 'resolved' ? 'Mark resolved' : 'Dismiss'}</button></div></form>`, (bg, done) => {
      qs('#rf', bg).onsubmit = async (e) => { e.preventDefault(); try { await act(qs('#rf button:not([data-close])', bg), () => q(sb.from('data_flags').update({ status, resolution_note: e.target.n.value.trim(), resolved_by: S.ctx.user_id, resolved_at: new Date().toISOString() }).eq('id', id).select('id').single()), 'Saved'); done(); reload(); } catch (_) {} };
    });
    qsa('[data-res]', c).forEach((b) => b.onclick = () => close(b.dataset.res, 'resolved'));
    qsa('[data-dis]', c).forEach((b) => b.onclick = () => close(b.dataset.dis, 'dismissed'));
    qsa('[data-re]', c).forEach((b) => b.onclick = async () => { try { await act(b, () => q(sb.from('data_flags').update({ status: 'open', resolution_note: null, resolved_by: null, resolved_at: null }).eq('id', b.dataset.re).select('id').single()), 'Reopened'); reload(); } catch (_) {} });
    const add = qs('#addF', c); if (add) add.onclick = () => modal(`<h2>Add a flag</h2><form id="af"><div class="form-grid"><label>Type<select name="e">${Object.entries(ENT).filter(([k]) => !['applicant', 'checkride'].includes(k)).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label>Severity<select name="s"><option value="error">Correction needed</option><option value="warning" selected>Check</option><option value="question">Confirm</option></select></label>
      <label class="full">Title<input name="t" required maxlength="140"></label><label class="full">Detail<textarea name="d" style="min-height:90px"></textarea></label></div>
      <p class="xs muted">To flag a specific applicant or checkride, use "Flag for correction" on that record.</p>
      <div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Add flag</button></div></form>`, (bg, done) => {
      qs('#af', bg).onsubmit = async (e) => { e.preventDefault(); const f = e.target; try { await act(qs('#af button:not([data-close])', bg), () => q(sb.from('data_flags').insert({ org_id: S.orgId, entity: f.e.value, severity: f.s.value, title: f.t.value.trim(), detail: f.d.value.trim() || null, created_by: S.ctx.user_id }).select('id').single()), 'Flag added'); done(); reload(); } catch (_) {} };
    });
  }

  // "Flag for correction" button used on applicant and checkride records.
  function flagButton(entity, id) { return can('org_admin', 'examiner', 'office') ? `<button type="button" class="btn sm ghost" data-flag="${entity}|${id}">Flag for correction</button>` : ''; }
  function bindFlagButtons(root) {
    qsa('[data-flag]', root).forEach((b) => b.onclick = () => { const [entity, id] = b.dataset.flag.split('|');
      modal(`<h2>Flag for correction</h2><form id="ff"><div class="form-grid"><label class="full">What needs correcting?<input name="t" required maxlength="140"></label><label class="full">Detail<textarea name="d" style="min-height:80px"></textarea></label>
        <label>Severity<select name="s"><option value="error">Correction needed</option><option value="warning" selected>Check</option><option value="question">Confirm</option></select></label></div>
        <div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Add flag</button></div></form>`, (bg, done) => {
        qs('#ff', bg).onsubmit = async (e) => { e.preventDefault(); const f = e.target; try { await act(qs('#ff button:not([data-close])', bg), () => q(sb.from('data_flags').insert({ org_id: S.orgId, entity, entity_id: id, severity: f.s.value, title: f.t.value.trim(), detail: f.d.value.trim() || null, created_by: S.ctx.user_id }).select('id').single()), 'Flag added to Data Review'); done();
          const el = qs('#flg', root); if (el) { const fl = await flagsFor(id); el.innerHTML = fl.length ? `<div class="banner warn sm"><b>Flagged in Data Review:</b> ${fl.map((x) => esc(x.title)).join('; ')}</div>` : ''; } else if (A.route) A.route();
          const b2 = qs('#flagBadge'); if (b2) { b2.textContent = String((+b2.textContent || 0) + 1); b2.hidden = false; } } catch (_) {} };
      }); });
  }
  async function flagsFor(id) { try { return await q(sb.from('data_flags').select('id,title,severity').eq('entity_id', id).eq('status', 'open')); } catch (_) { return []; } }

  Object.assign(A, { flagButton, bindFlagButtons, flagsFor, sevPill });
  A.addRoute(/^\/data-review$/, viewDataReview);
})();

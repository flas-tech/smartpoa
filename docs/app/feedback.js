/* smartPOA Feedback: any signed-in user can send a bug report, idea or question from the top bar and see
   replies to their earlier feedback. The platform owner reviews everything in the Feedback inbox. */
(function () {
  'use strict';
  const A = window.SPOA;
  const { sb, S, esc, qs, qsa, fmtDT, q, act, toast, shell, head, modal, isOwner } = A;
  const C = window.SPOA_CONFIG || {};

  const KIND = { bug: 'Something is wrong', idea: 'Idea or request', question: 'Question', other: 'Other' };
  const KIND_SHORT = { bug: 'Bug', idea: 'Idea', question: 'Question', other: 'Other' };
  const STATUS = { new: ['info', 'New'], reviewing: ['warn', 'Reviewing'], planned: ['info', 'Planned'], done: ['ok', 'Done'], wont_fix: ['', 'Not planned'] };
  const pill = (s) => `<span class="pill ${STATUS[s][0]}">${STATUS[s][1]}</span>`;
  const when = (d) => (fmtDT ? fmtDT(d) : new Date(d).toLocaleString());

  function itemHtml(f, owner) {
    return `<div class="fb-item"><div class="btn-row" style="justify-content:space-between;gap:.5rem"><span class="sm strong">${esc(KIND_SHORT[f.kind] || f.kind)}${owner ? ' · ' + esc(f.email || '') : ''}</span>${pill(f.status)}</div>
      <div class="xs muted">${esc(when(f.created_at))}${f.page ? ' · ' + esc(f.page) : ''}${owner && f.app_version ? ' · v' + esc(f.app_version) : ''}</div>
      <div class="fb-msg">${esc(f.message)}</div>
      ${f.reply ? `<div class="fb-reply"><span class="strong">Response${f.replied_at ? ' · ' + esc(when(f.replied_at)) : ''}</span><br>${esc(f.reply)}</div>` : ''}</div>`;
  }

  async function openFeedback() {
    const page = (location.hash || '#/home').split('?')[0].replace(/\/[0-9a-f-]{36}$/i, '/…');
    modal(`<h2>Send feedback</h2><p class="sm muted">Report a problem, suggest a feature or ask a question. The smartPOA team reads every message.</p>
      <form id="fbf"><label>Type<select name="kind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label>Message<textarea name="message" required minlength="3" maxlength="4000" style="min-height:120px" placeholder="What happened, or what would help? Please do not include applicant personal information."></textarea></label>
      <p class="xs muted">The current page (${esc(page)}) and app version are attached automatically.</p>
      <div class="btn-row" style="justify-content:flex-end"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn" type="submit" id="fbSend">Send feedback</button></div></form>
      <div id="fbMine"></div>`, async (bg, close) => {
      const f = qs('#fbf', bg);
      f.onsubmit = async (e) => {
        e.preventDefault();
        const msg = f.message.value.trim();
        if (msg.length < 3) { toast('Please add a few more words.', true); return; }
        await act(qs('#fbSend', bg), () => q(sb.from('feedback').insert({ kind: f.kind.value, message: msg, page, app_version: C.version || null, user_agent: navigator.userAgent.slice(0, 400), org_id: S.orgId || null })), 'Thanks. Your feedback was sent.');
        close();
      };
      try {
        const { data: ses } = await sb.auth.getSession();
        const mine = await q(sb.from('feedback').select('*').eq('user_id', ses.session.user.id).order('created_at', { ascending: false }).limit(10));
        if (mine.length) qs('#fbMine', bg).innerHTML = `<h3 style="margin-top:1.2rem">Your earlier feedback</h3>${mine.map((x) => itemHtml(x, false)).join('')}`;
      } catch (_) { /* list is optional */ }
    });
  }
  A.openFeedback = openFeedback;

  async function viewFeedback(m, params) {
    const c = shell('feedback');
    if (!isOwner()) { c.innerHTML = '<div class="banner warn">Platform owner only.</div>'; return; }
    const st = params.get('status') || 'open', kd = params.get('kind') || '';
    let rows = [];
    try { rows = await q(sb.from('feedback').select('*').order('created_at', { ascending: false }).limit(500)); } catch (e) { c.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; return; }
    const count = (s) => rows.filter((r) => r.status === s).length;
    const open = rows.filter((r) => ['new', 'reviewing', 'planned'].includes(r.status)).length;
    const shown = rows.filter((r) => (st === 'all' || (st === 'open' ? ['new', 'reviewing', 'planned'].includes(r.status) : r.status === st)) && (!kd || r.kind === kd));
    const link = (s, k) => `#/feedback?status=${s}${k ? '&kind=' + k : ''}`;
    c.innerHTML = head('Feedback inbox', 'Messages sent with the Feedback button by users in every organization.', `<button class="btn ghost" id="fbCsv">Export CSV</button>`) +
      `<div class="kpis"><a class="kpi kpi-btn" href="${link('new', kd)}"><div class="kpi-label">New</div><div class="kpi-value">${count('new')}</div></a>
       <a class="kpi kpi-btn" href="${link('open', kd)}"><div class="kpi-label">Open</div><div class="kpi-value">${open}</div><div class="kpi-note">New, reviewing or planned</div></a>
       <a class="kpi kpi-btn" href="${link('done', kd)}"><div class="kpi-label">Done</div><div class="kpi-value">${count('done')}</div></a>
       <a class="kpi kpi-btn" href="${link('all', kd)}"><div class="kpi-label">All</div><div class="kpi-value">${rows.length}</div></a></div>
      <div class="card"><div class="form-grid"><label>Status<select id="fbSt">${[['open', 'Open'], ['all', 'All'], ...Object.entries(STATUS).map(([k, v]) => [k, v[1]])].map(([k, l]) => `<option value="${k}" ${k === st ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Type<select id="fbKd"><option value="">All types</option>${Object.entries(KIND_SHORT).map(([k, l]) => `<option value="${k}" ${k === kd ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div></div>
      <div class="card" id="fbList">${shown.length ? shown.map((f) => `<div data-fb="${f.id}">${itemHtml(f, true)}<div class="btn-row"><button class="btn ghost sm" data-edit="${f.id}">Update status or reply</button></div></div>`).join('') : '<p class="muted">No feedback matches these filters.</p>'}</div>`;
    qs('#fbSt', c).onchange = (e) => A.go(link(e.target.value, kd));
    qs('#fbKd', c).onchange = (e) => A.go(link(st, e.target.value));
    qsa('[data-edit]', c).forEach((b) => b.onclick = () => {
      const f = rows.find((r) => r.id === b.dataset.edit);
      modal(`<h2>Update feedback</h2>${itemHtml(f, true)}<form id="fbu"><label>Status<select name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === f.status ? 'selected' : ''}>${v[1]}</option>`).join('')}</select></label>
        <label>Response to the user (they see this under their earlier feedback)<textarea name="reply" maxlength="4000" style="min-height:90px">${esc(f.reply || '')}</textarea></label>
        <div class="btn-row" style="justify-content:flex-end"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn" id="fbSave">Save</button></div></form>`, (bg, close) => {
        const u = qs('#fbu', bg);
        u.onsubmit = async (e) => {
          e.preventDefault();
          const reply = u.reply.value.trim() || null;
          const patch = { status: u.status.value, reply };
          if (reply !== (f.reply || null)) patch.replied_at = reply ? new Date().toISOString() : null;
          await act(qs('#fbSave', bg), () => q(sb.from('feedback').update(patch).eq('id', f.id)), 'Saved');
          close(); viewFeedback(m, params);
        };
      });
    });
    qs('#fbCsv', c).onclick = () => {
      const cols = ['created_at', 'email', 'kind', 'status', 'page', 'app_version', 'message', 'reply'];
      const cell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
      const csv = [cols.join(','), ...shown.map((r) => cols.map((k) => cell(r[k])).join(','))].join('\r\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'smartpoa-feedback.csv'; a.click();
    };
  }
  A.addRoute(/^\/feedback$/, viewFeedback);
})();

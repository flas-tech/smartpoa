/* smartPOA app. Vanilla JS + vendored supabase-js. All data access is protected server-side by RLS + MFA. */
(function () {
  'use strict';
  const C = window.SPOA_CONFIG;
  const E = window.SPE;
  const sb = window.supabase.createClient(C.url, C.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  const $app = document.getElementById('app');
  const S = { ctx: null, orgId: localStorage.getItem('spoa_org') || null, std: null, regs: null, docsDb: null, lastCheck: null };
  window.SPOA = { sb, S };

  // ---------- helpers ----------
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const qs = (s, r) => (r || document).querySelector(s);
  const qsa = (s, r) => Array.from((r || document).querySelectorAll(s));
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtDate = (d) => d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const fmtDT = (d) => d ? new Date(d).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const ROLE_LABEL = { org_admin: 'Organization admin', examiner: 'Examiner', office: 'Office staff', auditor: 'Auditor (read-only)' };
  const ROLE_DESC = { org_admin: 'Members, roles, aircraft and settings. Sees everything in the organization.', examiner: 'Builds, finalizes and signs plans of action and debriefs.', office: 'Applicant records, checkride schedule, aircraft and documents. Cannot see plans, questions or element grades.', auditor: 'Read-only access to records, plans, outcomes and the audit trail.' };
  function toast(msg, bad) { qsa('.toast').forEach((x) => x.remove()); const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), bad ? 6000 : 3000); }
  function friendly(e) {
    const m = (e && (e.message || e.error_description || e.error)) || String(e);
    if (/not authorized|permission denied|42501|row-level security/i.test(m)) return 'You do not have permission for that action.';
    if (/MFA required/i.test(m)) return 'Verify your authenticator code first.';
    if (/invitation invalid/i.test(m)) return 'This invitation is not valid for the account you are signed in with.';
    if (/duplicate key/i.test(m)) return 'That already exists.';
    return m.replace(/^.*?ERROR:\s*/, '');
  }
  async function rpc(name, args) { const { data, error } = await sb.rpc(name, args || {}); if (error) throw error; return data; }
  async function q(p) { const { data, error } = await p; if (error) throw error; return data; }
  async function fetchAll(mk) { let out = []; for (let from = 0; ; from += 1000) { const d = await q(mk().range(from, from + 999)); out = out.concat(d || []); if (!d || d.length < 1000) break; } return out; }
  function busy(b, on, label) { if (!b) return; if (on) { b.dataset.l = b.innerHTML; b.disabled = true; b.textContent = label || 'Working…'; } else { b.disabled = false; if (b.dataset.l) b.innerHTML = b.dataset.l; } }
  async function act(b, fn, ok) { busy(b, true); try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(friendly(e), true); throw e; } finally { busy(b, false); } }
  const go = (h) => { if (location.hash === h) route(); else location.hash = h; };
  const org = () => (S.ctx && S.ctx.orgs || []).find((o) => o.id === S.orgId) || null;
  const roles = () => (org() && org().roles) || [];
  const can = (...r) => roles().some((x) => r.includes(x));
  const isOwner = () => S.ctx && (S.ctx.platform_roles || []).includes('owner');
  const LOGO = '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="2" y="2" width="36" height="36" rx="9" fill="#0f6b66"/><path d="M11 27 L20 10 L29 27" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.5 21 H25.5" stroke="#6fd1c5" stroke-width="3" stroke-linecap="round"/><circle cx="20" cy="31" r="2" fill="#6fd1c5"/></svg>';
  const brand = (sub) => `<a class="brand" href="#/home">${LOGO}<div><div class="brand-name">smart<b>POA</b></div><div class="brand-sub">${esc(sub || 'Checkride plan of action')}</div></div></a>`;
  const I = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    poa: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h7"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.6c2.7.2 4.7 1.9 5.2 5"/>',
    plane: '<path d="M2 13l8-2 5-7h2l-2 7 5 1 1-2h1.5l-.5 4 .5 4H21l-1-2-5 1 2 7h-2l-5-7-8-2z"/>',
    q: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    book: '<path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-5a2 2 0 0 0-2 2"/><path d="M20 4v14h-6"/>',
    users: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/>',
    file: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    chat: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
    hist: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  };
  const icon = (k) => `<svg viewBox="0 0 24 24">${I[k] || ''}</svg>`;

  async function loadStd() {
    if (S.std) return S.std;
    const [a, b, ap] = await Promise.all([fetch('data/standards.json?v=' + C.version).then((r) => r.json()), fetch('data/regs.json?v=' + C.version).then((r) => r.json()), fetch('data/appendix.json?v=' + C.version).then((r) => r.json()).catch(() => ({ docs: {} }))]);
    a.documents.forEach((d) => { d.appendix_items = (ap.docs || {})[d.id] || []; });
    S.std = a.documents; S.regs = b; return S.std;
  }
  async function loadDocsDb() {
    try {
      S.docsDb = await q(sb.from('standards_docs').select('*'));
      const last = await q(sb.from('source_checks').select('checked_at').order('checked_at', { ascending: false }).limit(1));
      S.lastCheck = last && last[0] ? fmtDate(last[0].checked_at) : null;
    } catch (_) { S.docsDb = []; }
  }
  const stdDoc = (id) => (S.std || []).find((d) => d.id === id);

  // ---------- auth ----------
  function authCard(inner) { $app.innerHTML = `<div class="auth"><div class="auth-card">${brand('Secure sign-in')}${inner}</div></div>`; }
  function viewLogin(msg) {
    authCard(`<h1>Sign in</h1><p class="muted sm" style="margin-top:0">Accounts are created by invitation. Authenticator-app verification is required.</p>
      ${msg ? `<div class="okmsg">${esc(msg)}</div>` : ''}<div id="err"></div>
      <form id="f"><label>Email<input name="email" type="email" autocomplete="username" required></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn" type="submit" style="width:100%">Continue</button></form>
      <div class="auth-foot">Have an invitation? Open the link you were sent.<br>Forgot your password? Ask your organization administrator for a new invitation.<br><a href="../">About smartPOA</a></div>`);
    qs('#f').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target; const b = qs('button', f); busy(b, true, 'Signing in…');
      const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
      busy(b, false);
      if (error) { qs('#err').innerHTML = `<div class="err">${esc(/invalid/i.test(error.message) ? 'Email or password is incorrect.' : error.message)}</div>`; return; }
      route();
    });
  }
  async function viewInvite(token) {
    sessionStorage.setItem('spoa_invite', token);
    authCard('<div class="loading">Checking invitation…</div>');
    let info;
    try {
      const r = await fetch(C.url + '/functions/v1/redeem-invite', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.key }, body: JSON.stringify({ token, action: 'peek' }) });
      info = await r.json(); if (!r.ok) throw new Error(info.error || 'Invitation is not valid');
    } catch (e) {
      sessionStorage.removeItem('spoa_invite');
      authCard(`<h1>Invitation not valid</h1><div class="err">${esc(e.message)}</div><p class="sm muted">Ask the person who invited you for a new link.</p><a class="btn" href="#/login">Go to sign in</a>`); return;
    }
    const roleTxt = info.kind === 'platform' ? 'Platform owner' : (info.roles || []).map((r) => ROLE_LABEL[r] || r).join(', ');
    const { data: { session } } = await sb.auth.getSession();
    if (session && session.user.email.toLowerCase() === info.email.toLowerCase()) { go('#/home'); return; }
    if (session) await sb.auth.signOut();
    authCard(`<h1>Accept your invitation</h1>
      <p class="sm" style="margin-top:0">${info.kind === 'platform' ? 'smartPOA platform' : esc(info.org)}<br><span class="muted">Role: ${esc(roleTxt)}</span></p><div id="err"></div>
      <form id="f"><label>Email<input value="${esc(info.email)}" readonly autocomplete="username"></label>
      <label>Create a password<input name="p1" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label>
      <label>Confirm password<input name="p2" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label>
      <p class="xs muted" style="margin-top:-.4rem">At least 12 characters with letters and numbers. Next you will set up an authenticator app.</p>
      <button class="btn" type="submit" style="width:100%">Create account</button></form>
      <div class="auth-foot">Already have an account? <a href="#/login">Sign in</a> and the invitation will be applied.</div>`);
    qs('#f').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target; const err = qs('#err'); err.innerHTML = '';
      if (f.p1.value !== f.p2.value) { err.innerHTML = '<div class="err">Passwords do not match.</div>'; return; }
      const b = qs('button', f); busy(b, true, 'Creating account…');
      try {
        const r = await fetch(C.url + '/functions/v1/redeem-invite', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.key }, body: JSON.stringify({ token, password: f.p1.value }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Could not create account');
        if (j.status === 'exists') { busy(b, false); viewLogin('You already have an account. Sign in to accept the invitation.'); return; }
        const { error } = await sb.auth.signInWithPassword({ email: info.email, password: f.p1.value }); if (error) throw error;
        go('#/home');
      } catch (ex) { busy(b, false); err.innerHTML = `<div class="err">${esc(ex.message)}</div>`; }
    });
  }
  async function viewEnroll() {
    authCard('<div class="loading">Preparing two-factor setup…</div>');
    const { data: lf } = await sb.auth.mfa.listFactors();
    for (const f of (lf && lf.all) || []) if (f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'smartPOA ' + new Date().toISOString().slice(0, 16) });
    if (error) { authCard(`<h1>Two-factor setup</h1><div class="err">${esc(error.message)}</div><button class="btn" id="out">Sign out</button>`); qs('#out').onclick = signOut; return; }
    authCard(`<h1>Set up two-factor sign-in</h1><p class="sm" style="margin-top:0">Scan this code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password or Authy).</p>
      <div class="qr"><img alt="QR code for authenticator app" src="${esc(data.totp.qr_code)}"></div>
      <details class="sm"><summary>Can't scan? Enter this key instead</summary><div class="secret">${esc(data.totp.secret)}</div></details>
      <div id="err" style="margin-top:.8rem"></div>
      <form id="f"><label>6-digit code<input name="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
      <button class="btn" type="submit" style="width:100%">Verify and continue</button></form><div class="auth-foot"><a href="#" id="out">Sign out</a></div>`);
    qs('#out').onclick = (e) => { e.preventDefault(); signOut(); };
    qs('#f').addEventListener('submit', async (e) => {
      e.preventDefault(); const b = qs('button', e.target); busy(b, true, 'Verifying…');
      const { error: er } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code: e.target.code.value.trim() });
      busy(b, false);
      if (er) { qs('#err').innerHTML = '<div class="err">That code did not match. Check the time on your phone and try the next code.</div>'; return; }
      route();
    });
  }
  async function viewVerify(factor) {
    authCard(`<h1>Verify it's you</h1><p class="sm muted" style="margin-top:0">Enter the 6-digit code from your authenticator app.</p><div id="err"></div>
      <form id="f"><label>Code<input name="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus></label>
      <button class="btn" type="submit" style="width:100%">Verify</button></form><div class="auth-foot"><a href="#" id="out">Sign out</a></div>`);
    qs('#out').onclick = (e) => { e.preventDefault(); signOut(); };
    qs('#f').addEventListener('submit', async (e) => {
      e.preventDefault(); const b = qs('button', e.target); busy(b, true, 'Verifying…');
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: e.target.code.value.trim() });
      busy(b, false);
      if (error) { qs('#err').innerHTML = '<div class="err">That code did not match. Try the next code.</div>'; return; }
      route();
    });
  }
  async function signOut() { await sb.auth.signOut(); S.ctx = null; location.hash = '#/login'; route(); }

  async function ensureAuth() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { viewLogin(); return false; }
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal.currentLevel !== 'aal2') {
      const { data: lf } = await sb.auth.mfa.listFactors();
      const v = (lf.totp || []).find((f) => f.status === 'verified');
      if (v) viewVerify(v); else viewEnroll();
      return false;
    }
    const tok = sessionStorage.getItem('spoa_invite');
    if (tok) { sessionStorage.removeItem('spoa_invite'); try { await rpc('accept_invitation', { p_token: tok }); toast('Invitation accepted'); } catch (e) { toast(friendly(e), true); } }
    S.ctx = await rpc('my_context');
    const orgs = S.ctx.orgs || [];
    if (!orgs.find((o) => o.id === S.orgId)) S.orgId = orgs[0] ? orgs[0].id : null;
    if (S.orgId) localStorage.setItem('spoa_org', S.orgId);
    return true;
  }

  // ---------- layout ----------
  function shell(active, inner) {
    const o = org();
    const nav = [];
    nav.push(['home', 'Dashboard', 'home']);
    if (o) {
      if (can('org_admin', 'examiner', 'auditor')) nav.push(['poas', 'Plans of action', 'poa']);
      nav.push(['schedule', 'Schedule', 'cal']);
      if (can('org_admin', 'examiner', 'auditor')) nav.push(['past-checkrides', 'Past checkrides', 'hist']);
      nav.push(['applicants', 'Applicants', 'people']);
      nav.push(['aircraft', 'Aircraft', 'plane']);
      if (can('org_admin', 'examiner', 'auditor')) nav.push(['questions', 'Question bank', 'q']);
      if (can('org_admin', 'examiner', 'auditor')) nav.push(['reports', 'Reports', 'chart']);
      nav.push(['data-review', 'Data Review', 'flag']);
    }
    nav.push(['standards', 'Standards library', 'book']);
    const admin = [];
    if (o && can('org_admin')) admin.push(['members', 'Members & roles', 'users']);
    if (o && can('org_admin')) admin.push(['org-settings', 'Organization settings', 'gear']);
    if (o && can('org_admin', 'auditor')) admin.push(['audit', 'Audit trail', 'shield']);
    admin.push(['settings', 'My profile', 'gear']);
    if (isOwner()) admin.push(['platform', 'Platform', 'shield']);
    if (isOwner()) admin.push(['feedback', 'Feedback inbox', 'chat']);
    const link = (n) => `<a class="nav-item ${active === n[0] || (active === 'orgsettings' && n[0] === 'org-settings') ? 'active' : ''}" href="#/${n[0]}">${icon(n[2])}<span>${n[1]}</span>${n[0] === 'data-review' ? '<span class="nav-badge" id="flagBadge" hidden></span>' : n[0] === 'feedback' ? '<span class="nav-badge" id="fbBadge" hidden></span>' : ''}</a>`;
    const orgs = S.ctx.orgs || [];
    $app.innerHTML = `<div class="layout"><aside class="sidebar" id="side">${brand('Flite Line Technologies')}
      ${orgs.length ? `<label class="org-switch">Organization<select id="orgSel">${orgs.map((x) => `<option value="${x.id}" ${x.id === S.orgId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
      <nav class="nav">${nav.map(link).join('')}<div class="nav-sec">Administration</div>${admin.map(link).join('')}</nav>
      <div class="side-foot">${o ? esc(roles().map((r) => ROLE_LABEL[r]).join(' · ')) + '<br>' : ''}<a href="#" id="signout">Sign out</a> · <a href="#" id="wnLink">What's new</a> · v${esc(C.version)}</div></aside>
      <div class="main"><div class="topbar"><button class="menu-btn" id="menuBtn" aria-label="Menu">☰</button><span class="sm strong">${esc(o ? o.name : 'smartPOA')}</span><span class="who">${esc((S.ctx.profile && (S.ctx.profile.full_name || S.ctx.profile.email)) || '')}</span><button class="btn ghost sm fb-btn" id="fbBtn" type="button">${icon('chat')}<span>Feedback</span></button></div>
      <div class="content" id="content">${inner || '<div class="loading">Loading…</div>'}</div></div></div>`;
    const sel = qs('#orgSel'); if (sel) sel.onchange = () => { S.orgId = sel.value; localStorage.setItem('spoa_org', S.orgId); go('#/home'); };
    qs('#signout').onclick = (e) => { e.preventDefault(); signOut(); };
    qs('#menuBtn').onclick = () => qs('#side').classList.toggle('open');
    qs('#fbBtn').onclick = () => window.SPOA.openFeedback && window.SPOA.openFeedback();
    if (isOwner()) sb.from('feedback').select('id', { count: 'exact', head: true }).eq('status', 'new').then(({ count }) => { const b = qs('#fbBadge'); if (b && count) { b.textContent = count; b.hidden = false; } });
    if (o) sb.from('data_flags').select('id', { count: 'exact', head: true }).eq('org_id', S.orgId).eq('status', 'open').then(({ count }) => { const b = qs('#flagBadge'); if (b && count) { b.textContent = count; b.hidden = false; } });
    document.addEventListener('click', (e) => { const sd = qs('#side'); if (sd && sd.classList.contains('open') && !sd.contains(e.target) && e.target.id !== 'menuBtn') sd.classList.remove('open'); }, { once: true });
    return qs('#content');
  }
  const head = (title, sub, actions) => `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${actions ? `<div class="btn-row">${actions}</div>` : ''}</div>`;
  function modal(html, onMount) {
    const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(bg);
    const close = () => bg.remove();
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    qsa('[data-close]', bg).forEach((b) => b.addEventListener('click', close));
    if (onMount) onMount(bg, close);
    return close;
  }
  function confirmBox(title, text, okLabel) {
    return new Promise((res) => modal(`<h2>${esc(title)}</h2><p class="sm">${esc(text)}</p><div class="btn-row" style="justify-content:flex-end"><button class="btn ghost" data-close>Cancel</button><button class="btn" id="ok">${esc(okLabel || 'Confirm')}</button></div>`,
      (bg, close) => { qs('#ok', bg).onclick = () => { close(); res(true); }; qsa('[data-close]', bg).forEach((b) => b.addEventListener('click', () => res(false))); }));
  }
  function noOrg(c) {
    c.innerHTML = head('Welcome to smartPOA', 'Your account is not yet linked to an organization.') + `<div class="card"><p>${isOwner() ? 'As platform owner, create the first examiner organization on the <a href="#/platform">Platform</a> page.' : 'Ask your organization administrator to send you an invitation.'}</p></div>`;
  }

  // ---------- dashboard ----------
  async function viewHome() {
    const c = shell('home');
    if (!org()) return noOrg(c);
    const oid = S.orgId;
    const showPoa = can('org_admin', 'examiner', 'auditor');
    const [apps, poas, dbs] = await Promise.all([
      q(sb.from('applicants').select('id,first_name,last_name,created_at').eq('org_id', oid).eq('archived', false).order('created_at', { ascending: false }).limit(6)),
      showPoa ? q(sb.from('poas').select('id,title,status,purpose,test_date,test_profile,applicant_id,updated_at').eq('org_id', oid).order('updated_at', { ascending: false }).limit(50)) : [],
      showPoa ? q(sb.from('debriefs').select('id,outcome,status,test_date').eq('org_id', oid)) : [],
    ]);
    const signed = dbs.filter((d) => d.status === 'signed');
    const pass = signed.filter((d) => d.outcome === 'pass').length;
    const upcoming = poas.filter((p) => p.status === 'final' && p.test_date && p.test_date >= today()).sort((a, b) => a.test_date.localeCompare(b.test_date));
    const drafts = poas.filter((p) => p.status === 'draft');
    c.innerHTML = head('Dashboard', esc(org().name), showPoa && can('org_admin', 'examiner') ? '<a class="btn" href="#/poa/new">New plan of action</a>' : '<a class="btn" href="#/applicants">Applicants</a>') +
      (showPoa ? `<div class="kpis">
        <div class="kpi"><div class="kpi-label">Upcoming tests</div><div class="kpi-value">${upcoming.length}</div><div class="kpi-note">Finalized plans with a future date</div></div>
        <div class="kpi"><div class="kpi-label">Draft plans</div><div class="kpi-value">${drafts.length}</div><div class="kpi-note">Not yet finalized</div></div>
        <div class="kpi"><div class="kpi-label">Signed results</div><div class="kpi-value">${signed.length}</div><div class="kpi-note">All time</div></div>
        <div class="kpi"><div class="kpi-label">Pass rate</div><div class="kpi-value">${signed.length ? Math.round(100 * pass / signed.length) + '%' : '—'}</div><div class="kpi-note">${pass} pass of ${signed.length}</div></div></div>` : '') +
      `<div class="grid2">${showPoa ? `<div class="card"><div class="card-head"><h2>Upcoming</h2><a class="sm" href="#/poas">All plans</a></div>${upcoming.length ? `<table class="t">${upcoming.slice(0, 6).map((p) => `<tr class="click" data-h="#/poa/${p.id}"><td>${esc(p.title)}</td><td class="sm muted">${fmtDate(p.test_date)}</td></tr>`).join('')}</table>` : '<div class="empty sm">No finalized plans scheduled.</div>'}</div>
        <div class="card"><div class="card-head"><h2>Drafts in progress</h2></div>${drafts.length ? `<table class="t">${drafts.slice(0, 6).map((p) => `<tr class="click" data-h="#/poa/${p.id}"><td>${esc(p.title)}</td><td class="sm muted">${fmtDT(p.updated_at)}</td></tr>`).join('')}</table>` : '<div class="empty sm">No drafts.</div>'}</div>` : ''}
        <div class="card"><div class="card-head"><h2>Recent applicants</h2><a class="sm" href="#/applicants">All applicants</a></div>${apps.length ? `<table class="t">${apps.map((a) => `<tr class="click" data-h="#/applicant/${a.id}"><td>${esc(a.last_name)}, ${esc(a.first_name)}</td><td class="sm muted">${fmtDate(a.created_at)}</td></tr>`).join('')}</table>` : '<div class="empty sm"><span class="strong">No applicants yet</span>Add an applicant to start a plan of action.</div>'}</div></div>`;
    bindRows(c);
  }
  function bindRows(root) { qsa('tr[data-h]', root).forEach((tr) => tr.addEventListener('click', () => go(tr.dataset.h))); }

  // ---------- applicants ----------
  const aktrList = (s) => String(s || '').toUpperCase().split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const AKTR_RE = /^[A-Z]{2,3}\.[IVXL]+\.[A-Z]\.[KRS]\d+[a-z]?$/i;
  async function viewApplicants() {
    const c = shell('applicants'); if (!org()) return noOrg(c);
    const [rows, crl] = await Promise.all([q(sb.from('applicants').select('*').eq('org_id', S.orgId).order('last_name')), q(sb.from('checkrides').select('applicant_id,scheduled_at,grade_sought,class,test_type,result,school,recommending_instructor,knowledge_test').eq('org_id', S.orgId).order('scheduled_at', { ascending: false, nullsFirst: true }))]);
    const CRS = {}; crl.forEach((r) => { (CRS[r.applicant_id] = CRS[r.applicant_id] || []).push(r); });
    const GR = (window.SPOA.CR || {}).GRADES || {};
    const canEdit = can('org_admin', 'examiner', 'office');
    c.innerHTML = head('Applicants', 'Applicant records for testing and record keeping. Protected by organization access controls and MFA.', canEdit ? '<button class="btn" id="add">Add applicant</button>' : '') +
      `<div class="card"><input id="srch" placeholder="Search name, FTN, email, school or instructor" style="margin:0 0 .6rem"><label class="check sm"><input type="checkbox" id="arch"> Show archived</label>
      <div class="table-wrap"><table class="t" id="tb"><thead><tr><th>Name</th><th>FTN / held</th><th>Latest checkride</th><th>Instructor / school</th><th>Checkrides</th></tr></thead><tbody></tbody></table></div></div>`;
    const render = () => {
      const s = qs('#srch', c).value.toLowerCase(); const ar = qs('#arch', c).checked;
      const list = rows.filter((r) => (ar || !r.archived) && (!s || [r.first_name, r.last_name, r.email, r.ftn].concat((CRS[r.id] || []).map((x) => [x.school, x.recommending_instructor].join(' '))).join(' ').toLowerCase().includes(s)));
      qs('#tb tbody').innerHTML = list.length ? list.map((r) => { const cl = CRS[r.id] || []; const l = cl[0];
        return `<tr class="click" data-h="#/applicant/${r.id}"><td><span class="strong">${esc(r.last_name)}, ${esc(r.first_name)}</span>${r.archived ? ' <span class="pill">Archived</span>' : ''}<div class="xs muted">${esc(r.email || '')}</div></td><td class="sm">${esc(r.ftn || '—')}<div class="xs muted">${esc(r.cert_held || '')}</div></td>
          <td class="sm">${l ? esc((GR[l.grade_sought] || l.test_type || 'Checkride') + (l.class ? ' ' + l.class : '')) + `<div class="xs muted">${esc(l.scheduled_at ? fmtDate(l.scheduled_at) : 'Date not set')}${l.knowledge_test && E.ktTests(l.knowledge_test).length ? ' · ' + esc(E.ktTests(l.knowledge_test).map((t) => E.ktCode(t)).join(', ')) : ''}</div>` : '<span class="muted">None yet</span>'}</td>
          <td class="sm">${esc((l && l.recommending_instructor) || '—')}<div class="xs muted">${esc((l && l.school) || '')}</div></td><td class="sm">${cl.length}</td></tr>`; }).join('') : `<tr><td colspan="5"><div class="empty"><span class="strong">No applicants found</span>${canEdit ? 'Add one with the button above.' : ''}</div></td></tr>`;
      bindRows(qs('#tb', c));
    };
    qs('#srch', c).oninput = render; qs('#arch', c).onchange = render; render();
    if (qs('#add', c)) qs('#add', c).onclick = () => applicantForm(null, (id, isNew) => go('#/applicant/' + id + (isNew ? '?addCheckride=1' : '')));
  }
  // Knowledge test rows, used on the checkride form. read() returns { tests, aktr } or { error }.
  function ktEditor(wrap, tests, hint) {
    wrap.innerHTML = `<div class="card-head" style="margin:0"><h3 style="margin:0">Knowledge tests for this checkride</h3><button type="button" class="btn sm ghost" data-kt="add">Add knowledge test</button></div>
      <p class="xs muted" style="margin:.2rem 0 .4rem">${esc(hint || 'Add each test that applies to this checkride, for example IRA for an instrument rating, or FOI and FIA for a flight instructor. Only the AKTR codes from these tests are used in the plan. Valid-until fills in from 61.39 (24 calendar months; ATM 60).')}</p>
      <div data-kt="rows"></div><datalist id="ktCodes">${Object.entries(E.KT_CATALOG).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</datalist>`;
    const box = qs('[data-kt="rows"]', wrap);
    const addRow = (t) => {
      t = t || {}; const d = document.createElement('div'); d.className = 'kt-row';
      d.innerHTML = `<div class="form-grid4"><label>Test code<input data-k="test" list="ktCodes" placeholder="e.g. IRA" value="${esc(t.test)}" autocapitalize="characters"><span class="xs muted" data-k="name">${esc(E.KT_CATALOG[E.ktCode(t)] || '')}</span></label><label>Date taken<input data-k="date" type="date" value="${esc(t.date)}"></label>
        <label>Score (%)<input data-k="score" inputmode="numeric" value="${esc(t.score)}"></label><label>Valid until<input data-k="expires" type="date" value="${esc(t.expires)}"></label></div>
        <label>AKTR deficiency codes for this test<textarea data-k="aktr" placeholder="e.g. IR.I.C.K2, IR.VI.A.K1" style="min-height:48px">${esc((t.aktr || []).join(', '))}</textarea></label>
        <div class="btn-row" style="justify-content:flex-end;margin:.2rem 0 0"><button type="button" class="btn sm ghost" data-k="rm">Remove test</button></div>`;
      const g = (k) => qs(`[data-k="${k}"]`, d);
      const auto = () => { const code = E.ktCode({ test: g('test').value }); g('name').textContent = E.KT_CATALOG[code] || ''; const v = E.ktValidUntil(code, g('date').value); if (v && (!g('expires').value || g('expires').dataset.auto === '1')) { g('expires').value = v; g('expires').dataset.auto = '1'; } };
      g('test').addEventListener('input', auto); g('date').addEventListener('change', auto); g('expires').addEventListener('input', () => { g('expires').dataset.auto = ''; });
      g('rm').onclick = () => d.remove(); box.appendChild(d);
    };
    const set = (list) => { box.innerHTML = ''; (list && list.length ? list : [{}]).forEach(addRow); };
    set(tests);
    qs('[data-kt="add"]', wrap).onclick = () => { addRow({}); qs('[data-k="test"]', box.lastElementChild).focus(); };
    const read = () => {
      const list = qsa('.kt-row', wrap).map((d) => { const g = (k) => qs(`[data-k="${k}"]`, d).value.trim(); return { test: g('test').toUpperCase(), date: g('date'), score: g('score'), expires: g('expires'), aktr: aktrList(g('aktr')) }; }).filter((t) => t.test || t.date || t.score || t.aktr.length);
      const codes = Array.from(new Set([].concat(...list.map((t) => t.aktr))));
      const bad = codes.filter((x) => !AKTR_RE.test(x));
      if (bad.length) return { error: 'These do not look like ACS codes: ' + bad.join(', ') };
      if (list.some((t) => !t.test)) return { error: 'Enter the test code for each knowledge test, for example IRA or FOI.' };
      return { tests: list, aktr: codes };
    };
    const isEmpty = () => !qsa('.kt-row', wrap).some((d) => qsa('input,textarea', d).some((x) => x.value.trim()));
    return { read, set, isEmpty };
  }
  function applicantForm(a, done) {
    a = a || {};
    modal(`<h2>${a.id ? 'Edit applicant' : 'Add applicant'}</h2><p class="xs muted" style="margin-top:-.3rem">Person details only. Test date, test type, knowledge test results, IACRA application, instructor and school go on each checkride.</p><div id="err"></div><form id="f">
      <div class="form-grid"><label>First name<input name="first_name" required value="${esc(a.first_name)}"></label><label>Last name<input name="last_name" required value="${esc(a.last_name)}"></label>
      <label>FAA Tracking Number (FTN)<input name="ftn" value="${esc(a.ftn)}" maxlength="12"></label><label>Email<input name="email" type="email" value="${esc(a.email)}"></label>
      <label>Phone<input name="phone" value="${esc(a.phone)}"></label><label>Certificate / ratings held<input name="cert_held" placeholder="e.g. Private ASEL" value="${esc(a.cert_held)}"></label>
      <label>Certificate number (last 4 only)<input name="cert_number_last4" maxlength="4" value="${esc(a.cert_number_last4)}"></label>
      <label>Medical class<select name="medical_class">${['', 'First', 'Second', 'Third', 'BasicMed', 'Not required'].map((x) => `<option ${a.medical_class === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label>Medical date<input name="medical_date" type="date" value="${esc(a.medical_date)}"></label>
      <label class="full">Notes<textarea name="notes" style="min-height:60px">${esc(a.notes)}</textarea></label></div>
      <p class="xs muted">Store only what you need. Full certificate numbers, dates of birth and ID numbers are intentionally not collected; IACRA remains the system of record.</p>
      <div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">${a.id ? 'Save' : 'Save and add checkride'}</button></div></form>`,
    (bg, close) => {
      qs('#f', bg).addEventListener('submit', async (e) => {
        e.preventDefault(); const f = e.target;
        const row = { first_name: f.first_name.value.trim(), last_name: f.last_name.value.trim(), email: f.email.value.trim() || null, phone: f.phone.value.trim() || null, ftn: f.ftn.value.trim() || null,
          cert_held: f.cert_held.value.trim() || null, cert_number_last4: f.cert_number_last4.value.trim() || null, medical_class: f.medical_class.value || null, medical_date: f.medical_date.value || null, notes: f.notes.value.trim() || null };
        const b = qs('button[type=submit]', f);
        try {
          const r = await act(b, async () => a.id ? q(sb.from('applicants').update(row).eq('id', a.id).select().single()) : q(sb.from('applicants').insert(Object.assign(row, { org_id: S.orgId, created_by: S.ctx.user_id })).select().single()), 'Saved');
          close(); done && done(r.id, !a.id);
        } catch (_) {}
      });
    });
  }
  async function viewApplicant(id, params) {
    const c = shell('applicants');
    const a = await q(sb.from('applicants').select('*').eq('id', id).single());
    const showPoa = can('org_admin', 'examiner', 'auditor');
    const [poas, docs, dbs, crs] = await Promise.all([
      showPoa ? q(sb.from('poas').select('id,title,status,purpose,test_date,version').eq('applicant_id', id).order('created_at', { ascending: false })) : [],
      q(sb.from('documents').select('*').eq('applicant_id', id).order('uploaded_at', { ascending: false })),
      showPoa ? q(sb.from('debriefs').select('id,poa_id,outcome,status,test_date,unsat_codes').eq('applicant_id', id).order('created_at', { ascending: false })) : [],
      q(sb.from('checkrides').select('*').eq('applicant_id', id).order('scheduled_at', { ascending: false, nullsFirst: true })),
    ]);
    const aflags = await A2().flagsFor(id);
    const canEdit = can('org_admin', 'examiner', 'office');
    const CR = window.SPOA.CR; const PO = Object.fromEntries(poas.map((p) => [p.id, p]));
    const ktLine = (t) => { const code = E.ktCode(t); const until = t.expires || E.ktValidUntil(code, t.date); const exp = until && until < today();
      return `<div class="sm"><span class="strong">${esc(code || 'Test')}</span> <span class="muted">${esc(E.KT_CATALOG[code] || '')}</span>${exp ? ' <span class="pill bad">Expired</span>' : ''} <span class="xs muted">${esc([t.date ? fmtDate(t.date) : '', t.score ? t.score + '%' : '', until ? 'valid until ' + fmtDate(until) : ''].filter(Boolean).join(' · '))}</span>
        ${(t.aktr || []).length ? `<div class="chips" style="margin:.2rem 0 .3rem">${t.aktr.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : '<div class="xs muted">No AKTR codes recorded.</div>'}</div>`; };
    const crBlock = (r) => { const kl = E.ktTests(r.knowledge_test); const pl = r.poa_id && PO[r.poa_id];
      return `<div class="cr-block"><div class="cr-top"><div><div class="strong">${esc(r.test_type || 'Checkride')} — ${esc(CR.GRADES[r.grade_sought] || 'grade not set')} ${esc(r.class || '')}</div>
        <div class="xs muted">${esc([r.scheduled_at ? fmtDT(r.scheduled_at) : 'Date not set', r.departure_airport, r.aircraft_make_model, r.tail_number].filter(Boolean).join(' · '))}</div></div><div>${CR.resultPill(r.result)}${pl ? ' ' + statusPill(pl.status) : ''}</div></div>
        <div class="cr-grid"><div><div class="xs muted">IACRA application</div><div class="sm">${esc(r.iacra_app_id || '—')}</div></div><div><div class="xs muted">Recommending instructor</div><div class="sm">${esc(r.recommending_instructor || '—')}${r.instructor_cert_number ? ' <span class="xs muted">' + esc(r.instructor_cert_number) + '</span>' : ''}</div></div><div><div class="xs muted">School</div><div class="sm">${esc(r.school || '—')}</div></div></div>
        <div style="margin-top:.4rem"><div class="xs muted">Knowledge tests</div>${kl.length ? kl.map(ktLine).join('') : '<div class="sm muted">None recorded for this checkride.</div>'}</div>
        <div class="btn-row" style="margin:.5rem 0 0;flex-wrap:wrap">${canEdit ? `<button class="btn ghost sm" data-cr="${r.id}">Edit checkride</button>` : ''}${can('org_admin', 'examiner') ? (r.poa_id ? `<a class="btn sm" href="#/poa/${r.poa_id}">Open plan of action</a>` : `<a class="btn sm" href="#/poa/new?checkride=${r.id}">Build plan of action</a>`) : ''}${can('org_admin') ? `<button class="btn danger sm" data-crdel="${r.id}">Delete</button>` : ''}</div></div>`; };
    const legacy = E.ktTests(a.knowledge_test);
    c.innerHTML = head(esc(a.first_name + ' ' + a.last_name), esc([a.ftn ? 'FTN ' + a.ftn : '', a.cert_held].filter(Boolean).join(' · ')) || 'Applicant record',
      A2().flagButton('applicant', a.id) + (canEdit ? '<button class="btn ghost" id="edit">Edit applicant</button>' : '') + (can('org_admin') ? '<button class="btn danger" id="delA">Delete applicant</button>' : '') + (canEdit ? '<button class="btn" id="addCr">Add checkride</button>' : '')) +
      `${aflags.length ? `<div class="banner warn"><b>Flagged in Data Review:</b> ${aflags.map((x) => esc(x.title)).join('; ')}. <a href="#/data-review">Review</a></div>` : ''}
      <div class="steps-hint xs muted">1 Applicant &rarr; 2 Checkride (date, test, knowledge test, IACRA, instructor, school) &rarr; 3 Plan of action</div>
      <div class="grid2"><div class="card"><h2>Applicant</h2><table class="t">
        ${[['FTN', a.ftn], ['Email', a.email], ['Phone', a.phone], ['Held', a.cert_held], ['Certificate no. (last 4)', a.cert_number_last4], ['Medical', [a.medical_class, fmtDate(a.medical_date)].filter(Boolean).join(' · ')]].map(([k, v]) => `<tr><td class="sm muted" style="width:40%">${k}</td><td class="sm">${esc(v || '—')}</td></tr>`).join('')}
        </table>${a.notes ? `<p class="sm">${esc(a.notes)}</p>` : ''}
        ${legacy.length && !crs.length ? `<p class="xs muted">Knowledge tests from the earlier applicant record (${esc(legacy.map((t) => E.ktCode(t)).join(', '))}) are offered when you add a checkride.</p>` : ''}</div>
      <div class="card"><div class="card-head"><h2>Checkrides</h2></div>${crs.length ? crs.map(crBlock).join('') : `<div class="empty sm"><span class="strong">No checkrides yet</span>Add a checkride, then build the plan of action from it.</div>`}</div></div>
      ${showPoa ? `<div class="card"><div class="card-head"><h2>Plans of action</h2></div>${poas.length ? `<table class="t"><thead><tr><th>Plan</th><th>Status</th><th>Test date</th></tr></thead>${poas.map((p) => `<tr class="click" data-h="#/poa/${p.id}"><td>${esc(p.title)} <span class="xs muted">v${p.version}</span></td><td>${statusPill(p.status)}</td><td class="sm">${fmtDate(p.test_date)}</td></tr>`).join('')}</table>` : '<div class="empty sm">No plans yet.</div>'}</div>
      <div class="card"><h2>Results</h2>${dbs.length ? `<table class="t"><thead><tr><th>Date</th><th>Outcome</th><th>Unsatisfactory ACS codes</th></tr></thead>${dbs.map((d) => `<tr class="click" data-h="#/debrief/${d.poa_id}"><td class="sm">${fmtDate(d.test_date)}</td><td>${outcomePill(d.outcome, d.status)}</td><td class="sm mono">${esc((d.unsat_codes || []).join(', ') || '—')}</td></tr>`).join('')}</table>` : '<div class="empty sm">No results recorded.</div>'}</div>` : ''}
      <div class="card"><div class="card-head"><h2>Documents</h2>${canEdit ? '<button class="btn sm" id="up">Upload</button>' : ''}</div><div id="docs"></div></div>`;
    bindRows(c); A2().bindFlagButtons(c);
    renderDocs(qs('#docs', c), docs);
    const openCr = (r) => CR.checkrideForm(r || { applicant_id: a.id }, [a], () => route());
    if (qs('#edit', c)) qs('#edit', c).onclick = () => applicantForm(a, () => route());
    if (qs('#addCr', c)) qs('#addCr', c).onclick = () => openCr(null);
    qsa('[data-cr]', c).forEach((b) => b.onclick = () => openCr(crs.find((r) => r.id === b.dataset.cr)));
    qsa('[data-crdel]', c).forEach((b) => b.onclick = () => CR.deleteCheckride(crs.find((r) => r.id === b.dataset.crdel), PO, () => route()));
    if (qs('#up', c)) qs('#up', c).onclick = () => uploadDoc({ applicant_id: a.id }, () => route());
    if (qs('#delA', c)) qs('#delA', c).onclick = () => deleteApplicant(a, { crs: crs.length, poas: poas.length, docs: docs.length, dbs: dbs.length });
    if (params && params.get('addCheckride') && canEdit) { history.replaceState(null, '', '#/applicant/' + a.id); openCr(null); }
  }
  // Remove an applicant and everything recorded for them. Org admins only; typed-name confirmation.
  function deleteApplicant(a, n) {
    const nm = (a.first_name + ' ' + a.last_name).trim();
    modal(`<h2>Delete ${esc(nm)}?</h2><p class="sm">This permanently removes the applicant and ${n.crs} checkride(s), ${n.poas} plan(s) of action including finalized ones, ${n.dbs} result(s) and ${n.docs} document(s). Use it for records created by mistake or for test data. The audit log keeps a record that the rows were deleted.</p>
      <label class="sm">Type the applicant's name to confirm<input id="cf" autocomplete="off" placeholder="${esc(nm)}"></label>
      <div class="btn-row" style="justify-content:flex-end"><button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="ok" disabled>Delete permanently</button></div>`, (bg, close) => {
      const cf = qs('#cf', bg); const ok = qs('#ok', bg);
      cf.oninput = () => { ok.disabled = cf.value.trim().toLowerCase() !== nm.toLowerCase(); };
      ok.onclick = async () => {
        try {
          await act(ok, async () => {
            const docs = await q(sb.from('documents').select('storage_path').eq('applicant_id', a.id));
            const paths = docs.map((d) => d.storage_path).filter(Boolean);
            if (paths.length) { const { error } = await sb.storage.from('records').remove(paths); if (error) throw error; }
            await rpc('delete_applicant', { p_id: a.id });
          }, 'Applicant deleted');
          close(); go('#/applicants');
        } catch (_) {}
      };
    });
  }
  const statusPill = (s) => `<span class="pill ${s === 'final' ? 'accent' : s === 'completed' ? 'ok' : s === 'void' ? 'bad' : 'warn'}">${s === 'final' ? 'Finalized' : s === 'completed' ? 'Completed' : s === 'void' ? 'Void' : 'Draft'}</span>`;
  const outcomePill = (o, st) => o ? `<span class="pill ${o === 'pass' ? 'ok' : o === 'fail' ? 'bad' : 'warn'}">${{ pass: 'Pass', fail: 'Disapproved', discontinued: 'Discontinued', incomplete: 'Incomplete' }[o]}</span>${st === 'signed' ? '' : ' <span class="pill">Unsigned</span>'}` : '<span class="pill">In progress</span>';

  // ---------- documents ----------
  const DOC_KINDS = { application: 'IACRA application / 8710', endorsement: 'Endorsements', aktr: 'Knowledge test report', logbook: 'Logbook pages', id: 'Identification (redact numbers)', aircraft: 'Aircraft documents', wb: 'Weight & balance', poa: 'Signed plan of action', debrief: 'Paper debrief / grade sheet', nod: 'Notice of disapproval / discontinuance', other: 'Other' };
  function renderDocs(el, docs) {
    el.innerHTML = docs.length ? `<table class="t"><thead><tr><th>File</th><th>Type</th><th>Uploaded</th><th></th></tr></thead>${docs.map((d) => `<tr><td class="sm">${esc(d.filename)}<div class="xs muted mono">SHA-256 ${esc((d.sha256 || '').slice(0, 16))}…</div></td><td class="sm">${esc(DOC_KINDS[d.kind] || d.kind)}</td><td class="sm muted">${fmtDT(d.uploaded_at)}</td><td><button class="btn ghost sm" data-dl="${esc(d.storage_path)}">Open</button></td></tr>`).join('')}</table>` : '<div class="empty sm">No documents attached.</div>';
    qsa('[data-dl]', el).forEach((b) => b.onclick = async () => { try { const { data, error } = await sb.storage.from('records').createSignedUrl(b.dataset.dl, 60); if (error) throw error; window.open(data.signedUrl, '_blank', 'noopener'); } catch (e) { toast(friendly(e), true); } });
  }
  function uploadDoc(link, done) {
    modal(`<h2>Upload document</h2><form id="f"><label>Type<select name="kind">${Object.entries(DOC_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label>File (PDF or image, up to 50 MB)<input type="file" name="file" required accept=".pdf,image/*,.heic"></label>
      <p class="xs muted">Files are stored privately for this organization. A SHA-256 fingerprint is recorded so the file can be verified later.</p>
      <div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">Upload</button></div></form>`, (bg, close) => {
      qs('#f', bg).addEventListener('submit', async (e) => {
        e.preventDefault(); const f = e.target; const file = f.file.files[0]; if (!file) return;
        if (file.size > 52428800) { toast('File is larger than 50 MB.', true); return; }
        const b = qs('button[type=submit]', f);
        try {
          await act(b, async () => {
            const buf = await file.arrayBuffer();
            const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))).map((x) => x.toString(16).padStart(2, '0')).join('');
            const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
            const path = S.orgId + '/' + (link.applicant_id || 'general') + '/' + uid() + '-' + safe;
            const { error } = await sb.storage.from('records').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false }); if (error) throw error;
            await q(sb.from('documents').insert({ org_id: S.orgId, applicant_id: link.applicant_id || null, poa_id: link.poa_id || null, kind: f.kind.value, filename: file.name, storage_path: path, size_bytes: file.size, sha256: sha, uploaded_by: S.ctx.user_id }));
          }, 'Uploaded');
          close(); done && done();
        } catch (_) {}
      });
    });
  }

  // ---------- aircraft ----------
  async function viewAircraft() {
    const c = shell('aircraft'); if (!org()) return noOrg(c);
    const rows = await q(sb.from('aircraft').select('*').eq('org_id', S.orgId).order('tail'));
    const canEdit = can('org_admin', 'examiner', 'office');
    c.innerHTML = head('Aircraft', 'Aircraft used for practical tests. Class and type are used to select the right tasks.', canEdit ? '<button class="btn" id="add">Add aircraft</button>' : '') +
      `<div class="card flush"><div class="table-wrap"><table class="t"><thead><tr><th>Registration</th><th>Make / model</th><th>Class</th><th>Type designator</th><th>Notes</th></tr></thead><tbody>${rows.length ? rows.map((r) => `<tr class="click" data-id="${r.id}"><td class="strong mono">${esc(r.tail)}</td><td>${esc(r.make_model)}</td><td>${esc(r.class || '')}</td><td class="mono sm">${esc(r.type_designator || '—')}</td><td class="sm muted">${esc(r.notes || '')}</td></tr>`).join('') : '<tr><td colspan="5"><div class="empty"><span class="strong">No aircraft yet</span>Add the aircraft you test in.</div></td></tr>'}</tbody></table></div></div>`;
    const form = (a) => {
      a = a || {};
      modal(`<h2>${a.id ? 'Edit aircraft' : 'Add aircraft'}</h2><form id="f"><div class="form-grid"><label>Registration<input name="tail" required value="${esc(a.tail)}" placeholder="N12345"></label><label>Make / model<input name="make_model" required value="${esc(a.make_model)}" placeholder="Cessna 172S"></label>
        <label>Class<select name="class">${['ASEL', 'AMEL', 'ASES', 'AMES', 'RH', 'RG'].map((x) => `<option value="${x}" ${a.class === x ? 'selected' : ''}>${x} — ${E.CLASS_LABEL[x]}</option>`).join('')}</select></label><label>Type designator (if type rating)<input name="type_designator" value="${esc(a.type_designator)}" placeholder="CE-525"></label>
        <label class="full">Type certificate holder<input name="tc_holder" value="${esc(a.tc_holder)}"></label><label class="full">Equipment / notes<textarea name="notes">${esc(a.notes)}</textarea></label></div>
        <div class="btn-row" style="justify-content:flex-end">${a.id && can('org_admin') ? '<button type="button" class="btn danger" id="arch">Archive</button>' : ''}<button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">Save</button></div></form>`, (bg, close) => {
        qs('#f', bg).addEventListener('submit', async (e) => {
          e.preventDefault(); const f = e.target;
          const row = { tail: f.tail.value.trim().toUpperCase(), make_model: f.make_model.value.trim(), class: f.class.value, category: E.categoryOfClass(f.class.value), type_designator: f.type_designator.value.trim() || null, tc_holder: f.tc_holder.value.trim() || null, notes: f.notes.value.trim() || null };
          try { await act(qs('button[type=submit]', f), () => a.id ? q(sb.from('aircraft').update(row).eq('id', a.id)) : q(sb.from('aircraft').insert(Object.assign(row, { org_id: S.orgId }))), 'Saved'); close(); route(); } catch (_) {}
        });
        const ar = qs('#arch', bg); if (ar) ar.onclick = async () => { try { await act(ar, () => q(sb.from('aircraft').update({ archived: true }).eq('id', a.id)), 'Archived'); close(); route(); } catch (_) {} };
      });
    };
    if (qs('#add', c)) qs('#add', c).onclick = () => form();
    qsa('tr[data-id]', c).forEach((tr) => tr.onclick = () => canEdit && form(rows.find((r) => r.id === tr.dataset.id)));
  }

  // ---------- POA list ----------
  async function viewPoas() {
    const c = shell('poas'); if (!org()) return noOrg(c);
    const [rows, apps] = await Promise.all([q(sb.from('poas').select('id,title,status,purpose,test_date,version,applicant_id,updated_at,test_profile,standard_id').eq('org_id', S.orgId).order('updated_at', { ascending: false })), q(sb.from('applicants').select('id,first_name,last_name').eq('org_id', S.orgId))]);
    const an = Object.fromEntries(apps.map((a) => [a.id, a.last_name + ', ' + a.first_name]));
    c.innerHTML = head('Plans of action', 'Each plan is tied to one applicant, one standard edition and one purpose. Finalized plans are locked and fingerprinted; changes create a new version.', can('org_admin', 'examiner') ? '<a class="btn" href="#/poa/new">New plan of action</a>' : '') +
      `<div class="card"><div class="btn-row" style="margin-bottom:.6rem"><select id="fs" style="max-width:200px;margin:0"><option value="">All statuses</option><option value="draft">Draft</option><option value="final">Finalized</option><option value="completed">Completed</option></select><input id="srch" placeholder="Search" style="max-width:280px;margin:0"></div>
      <div class="table-wrap"><table class="t" id="tb"><thead><tr><th>Plan</th><th>Applicant</th><th>Purpose</th><th>Status</th><th>Test date</th></tr></thead><tbody></tbody></table></div></div>`;
    const render = () => {
      const fs = qs('#fs', c).value; const s = qs('#srch', c).value.toLowerCase();
      const list = rows.filter((r) => (!fs || r.status === fs) && (!s || (r.title + ' ' + (an[r.applicant_id] || '')).toLowerCase().includes(s)));
      qs('#tb tbody').innerHTML = list.length ? list.map((r) => `<tr class="click" data-h="#/poa/${r.id}"><td><span class="strong">${esc(r.title)}</span> <span class="xs muted">v${r.version}</span><div class="xs muted">${esc((stdDoc(r.standard_id) || {}).num || '')}</div></td><td class="sm">${esc(an[r.applicant_id] || '—')}</td><td class="sm">${esc(E.PURPOSE_LABEL[r.purpose] || r.purpose)}</td><td>${statusPill(r.status)}</td><td class="sm">${fmtDate(r.test_date)}</td></tr>`).join('') : '<tr><td colspan="5"><div class="empty"><span class="strong">No plans of action</span>Create one from an applicant or with the button above.</div></td></tr>';
      bindRows(qs('#tb', c));
    };
    qs('#fs', c).onchange = render; qs('#srch', c).oninput = render; render();
  }

  const A2 = () => window.SPOA;
  const AUTO_SCEN = new Set();
  function testTypeOf(p) {
    if (p.content && p.content.checkride && p.content.checkride.test_type) return p.content.checkride.test_type;
    const ins = p.test_profile.cert === 'instrument';
    return { practical_test: ins ? 'Instrument Rating' : 'Original Certificate', added_rating: 'Additional Rating', retest: ins ? 'Retest for Instrument Rating' : 'Retest for Original Certificate', continuation: 'Continued from Previously Discontinued Test', reinstatement: 'Reinstatement of CFI' }[p.purpose] || 'Original Certificate';
  }
  // ---------- POA builder ----------
  function profileTitle(p, applicant) {
    const cls = p.cls ? ' ' + p.cls : '';
    const base = p.purpose === 'type_rating' ? (p.atpCert ? 'ATP + type rating ' : 'Type rating ') + (p.typeDesignator || '') + cls
      : p.purpose === 'added_rating' ? 'Added ' + p.cls + ' — ' + (E.CERT_LABEL[p.cert] || '') : (E.CERT_LABEL[p.cert] || '') + cls + (p.purpose === 'retest' ? ' retest' : p.purpose === 'mock_checkride' ? ' mock checkride' : '');
    return (applicant ? applicant.last_name + ' — ' : '') + base.trim();
  }
  async function viewPoaNew(params) {
    const c = shell('poas');
    if (!can('org_admin', 'examiner')) { c.innerHTML = '<div class="banner warn">Only examiners and administrators can create plans of action.</div>'; return; }
    await loadStd();
    const [apps, acs, prior, openCrs] = await Promise.all([q(sb.from('applicants').select('id,first_name,last_name,cert_held,ftn,knowledge_test,school,recommending_instructor,instructor_cert_number,iacra_app_id').eq('org_id', S.orgId).eq('archived', false).order('last_name')), q(sb.from('aircraft').select('*').eq('org_id', S.orgId).eq('archived', false).order('tail')),
      q(sb.from('debriefs').select('id,poa_id,applicant_id,results,outcome,test_date').eq('org_id', S.orgId).in('outcome', ['fail', 'discontinued']).eq('status', 'signed')),
      q(sb.from('checkrides').select('*').eq('org_id', S.orgId).is('poa_id', null).order('scheduled_at', { ascending: false, nullsFirst: true }))]);
    const crId = params.get('checkride');
    const cr = crId ? (openCrs.find((x) => x.id === crId) || await q(sb.from('checkrides').select('*').eq('id', crId).single())) : null;
    if (cr && cr.poa_id) { c.innerHTML = `<div class="banner warn">This checkride already has a plan of action. <a href="#/poa/${cr.poa_id}">Open it</a></div>`; return; }
    const GR = window.SPOA.CR.GRADES;
    const orgSt = await A2().orgSettings();
    const pre = params.get('applicant') || (cr && cr.applicant_id);
    c.innerHTML = head('New plan of action', 'Choose the purpose and the certificate or rating. smartPOA selects the governing ACS or PTS and the required tasks.') +
      `<div class="card" style="max-width:820px"><form id="f"><div class="form-grid">
      <label>Purpose<select name="purpose">${Object.entries(E.PURPOSE_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><span class="xs muted" id="purHint"></span></label>
      <label>Applicant<select name="applicant" required ${cr ? 'disabled' : ''}><option value="">Select…</option>${apps.map((a) => `<option value="${a.id}" ${a.id === pre ? 'selected' : ''}>${esc(a.last_name)}, ${esc(a.first_name)}${a.cert_held ? ' — ' + esc(a.cert_held) : ''}</option>`).join('')}</select>${apps.length ? '' : '<span class="xs"><a href="#/applicants">Add an applicant first</a></span>'}</label>
      <label>Checkride<select name="checkride" id="crSel"></select><span class="xs muted" id="crHint"></span></label>
      <label>Certificate level<select name="cert"><option value="private">Private Pilot</option><option value="commercial">Commercial Pilot</option><option value="instrument">Instrument Rating</option><option value="atp">Airline Transport Pilot / type rating</option><option value="cfi">Flight Instructor (Airplane)</option><option value="cfii">Flight Instructor Instrument (CFII)</option></select></label>
      <label>Category / class for this test<select name="cls">${['ASEL', 'AMEL', 'ASES', 'AMES', 'RH', 'RG'].map((x) => `<option value="${x}">${x} — ${E.CLASS_LABEL[x]}</option>`).join('')}</select></label>
      <label id="heldL" style="display:none"><span id="heldT">Rating already held (for the Additional Rating Task Table)</span><select name="held"></select></label>
      <label id="typeL" style="display:none">Type designator<input name="typeDesignator" placeholder="e.g. CE-525S"></label>
      <label id="atpL" class="check" style="display:none;margin-top:1.6rem"><input type="checkbox" name="atpCert"> ATP certificate is also being issued on this test</label>
      <label id="retL" class="full" style="display:none">Previous attempt (tasks failed or not completed are carried forward)<select name="retest"><option value="">Select a disapproval or discontinuance…</option>${prior.map((d) => `<option value="${d.id}" data-app="${d.applicant_id}">${fmtDate(d.test_date)} — ${d.outcome}</option>`).join('')}</select></label>
      <label>Aircraft<select name="aircraft"><option value="">Select…</option>${acs.map((a) => `<option value="${a.id}" data-cls="${esc(a.class)}" data-type="${esc(a.type_designator || '')}">${esc(a.tail)} — ${esc(a.make_model)} (${esc(a.class)})</option>`).join('')}</select></label>
      <label>Planned test date<input type="date" name="test_date"></label>
      <label class="full">Location<input name="location" placeholder="e.g. KPBI, Atlantic Aviation"></label></div>
      <div id="res" class="banner info" style="margin-top:.4rem"></div><div id="ktRes" class="banner" style="margin-top:.4rem;display:none"></div>
      <div class="btn-row" style="justify-content:flex-end"><a class="btn ghost" href="#/poas">Cancel</a><button class="btn" type="submit">Create plan</button></div></form></div>`;
    const f = qs('#f', c);
    if (cr) {
      const pu = window.SPOA.CR.PURPOSE_OF[cr.test_type]; if (pu) f.purpose.value = pu;
      if (cr.grade_sought) f.cert.value = cr.grade_sought; else if (/instrument/i.test(cr.test_type || '')) f.cert.value = 'instrument';
      if (cr.class) f.cls.value = cr.class;
      if (cr.scheduled_at) f.test_date.value = cr.scheduled_at.slice(0, 10);
      if (cr.departure_airport) f.location.value = cr.departure_airport;
      const tailOpt = Array.from(f.aircraft.options).find((o) => cr.tail_number && o.textContent.toUpperCase().startsWith(cr.tail_number.toUpperCase())); if (tailOpt) f.aircraft.value = tailOpt.value;
      c.querySelector('.page-head .sub').textContent = 'Prefilled from the checkride record: ' + [cr.test_type, cr.departure_airport, cr.scheduled_at ? fmtDT(cr.scheduled_at) : ''].filter(Boolean).join(' · ') + '. Review each field.';
    }
    const PUR_HINT = { practical_test: 'First time earning this certificate or rating.', added_rating: 'Already holds this certificate level and is adding a category or class (for example commercial ASEL adding AMEL). Uses the Additional Rating Task Table.', type_rating: 'Adding an aircraft type rating.', retest: 'Retaking the tasks failed on a disapproved test (61.49).', continuation: 'Finishing a test stopped with a Letter of Discontinuance.', reinstatement: 'Renewing or reinstating flight instructor privileges (61.197, 61.199).', mock_checkride: 'Practice run; not an FAA practical test.', training: 'Stage check or training event.' };
    let heldFor = null;
    const setHeld = () => {
      const cfii = f.cert.value === 'cfii'; const key = cfii ? 'cfii' : 'std'; if (heldFor === key) return; heldFor = key;
      const lbl = cfii ? (S.std.find((d) => d.id === 'pts9') || { select_rules: { held_labels: {} } }).select_rules.held_labels : null;
      f.held.innerHTML = (cfii ? Object.entries(lbl) : E.HELD_OPTIONS.map((x) => [x, x])).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
      qs('#heldT', c).textContent = cfii ? 'Instructor rating already held (FAA-S-8081-9E add-on table)' : 'Rating already held (for the Additional Rating Task Table)';
    };
    const crOf = () => cr || openCrs.find((x) => x.id === f.checkride.value) || null;
    const fillCr = () => {
      const app = f.applicant.value; const list = openCrs.filter((x) => x.applicant_id === app);
      f.checkride.innerHTML = cr ? `<option value="${cr.id}">${esc([cr.test_type, GR[cr.grade_sought], cr.class, cr.scheduled_at ? fmtDate(cr.scheduled_at) : ''].filter(Boolean).join(' · '))}</option>`
        : list.map((x) => `<option value="${x.id}">${esc([x.test_type, GR[x.grade_sought], x.class, x.scheduled_at ? fmtDate(x.scheduled_at) : 'date not set'].filter(Boolean).join(' · '))}</option>`).join('') + '<option value="">New checkride from the details below</option>';
      f.checkride.disabled = !!cr;
      qs('#crHint', c).innerHTML = app ? (f.checkride.value ? 'Knowledge tests, IACRA application, instructor and school come from this checkride.' : `A checkride record is created with this plan. Add knowledge tests on it afterwards, or <a href="#/applicant/${app}?addCheckride=1">add the checkride first</a>.`) : '';
    };
    // Knowledge tests for this plan: only the checkride's tests for this certificate level, and only codes written against this standard.
    const ktFor = (prof, doc) => {
      const app = apps.find((a) => a.id === f.applicant.value); const k = crOf();
      const src = k ? E.ktTests(k.knowledge_test) : (app ? E.ktTests(app.knowledge_test) : []);
      return Object.assign(E.ktForPlan(prof, doc, src), { from: k ? 'checkride' : 'applicant' });
    };
    const ktShow = (prof, doc) => {
      const box = qs('#ktRes', c); const app = apps.find((a) => a.id === f.applicant.value);
      if (!app || !doc) { box.style.display = 'none'; return; }
      const kp = ktFor(prof, doc); const k = E.ktCheck(E.ktExpected(prof, doc), kp.tests, f.test_date.value);
      box.style.display = ''; box.className = 'banner ' + (k.status === 'met' ? 'info' : 'warn');
      box.innerHTML = `<b>Knowledge test used:</b> ${kp.tests.length ? esc(kp.tests.map((t) => E.ktCode(t) + (t.date ? ' (' + fmtDate(t.date) + (t.score ? ', ' + t.score + '%' : '') + ')' : '')).join(', ')) : 'none'}${kp.from === 'applicant' && kp.tests.length ? ' <span class="xs">(from the earlier applicant record)</span>' : ''}. ${esc(k.text)}
        <div style="margin-top:.35rem"><b>AKTR codes to be tested (${kp.aktr.length}):</b> ${kp.aktr.length ? `<span class="chips">${kp.aktr.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</span>` : 'none recorded'}</div>
        ${kp.skipped.length ? `<div class="xs" style="margin-top:.3rem">Not used for this plan (other certificate level): ${esc(kp.skipped.join(', '))}.</div>` : ''}${kp.dropped.length ? `<div class="xs">Codes from another standard left out: ${esc(kp.dropped.join(', '))}.</div>` : ''}`;
    };
    const sync = () => {
      const p = f.purpose.value; setHeld(); qs('#purHint', c).textContent = PUR_HINT[p] || '';
      qs('#heldL', c).style.display = p === 'added_rating' ? '' : 'none';
      qs('#typeL', c).style.display = p === 'type_rating' || f.cert.value === 'atp' ? '' : 'none';
      qs('#atpL', c).style.display = p === 'type_rating' ? '' : 'none';
      qs('#retL', c).style.display = p === 'retest' || p === 'continuation' ? '' : 'none';
      if (p === 'type_rating') f.cert.value = 'atp';
      if (p === 'reinstatement' && f.cert.value !== 'cfii') f.cert.value = 'cfi';
      const prof = { cert: f.cert.value, cls: f.cls.value, purpose: p, held: f.held.value };
      const r = E.resolveStandard(S.std, prof);
      if (r.error) { qs('#res', c).className = 'banner bad'; qs('#res', c).textContent = r.error; ktShow(prof, null); return; }
      ktShow(prof, r.doc);
      const t = E.requiredTasks(r.doc, Object.assign(prof, { atpCert: f.atpCert.checked }));
      qs('#res', c).className = 'banner info';
      qs('#res', c).innerHTML = `Governing standard: <b>${esc(r.doc.num)}</b> — ${esc(r.doc.title)} (${esc(r.doc.edition_date)}). ${t.filter((x) => x.required).length} of ${t.length} tasks required for this profile.` + (p === 'added_rating' && !r.doc.select_rules && !(r.doc.additional_rating && r.doc.additional_rating[prof.cls]) ? ' <br>This standard has no Additional Rating Task Table for ' + esc(prof.cls) + '; all applicable tasks are listed and you can mark exclusions with a reason.' : '');
    };
    ['purpose', 'cert', 'cls', 'held', 'atpCert', 'test_date'].forEach((n) => f[n].addEventListener('change', sync));
    const applyCr = (k) => {
      if (!k) return; const pu = window.SPOA.CR.PURPOSE_OF[k.test_type]; if (pu) f.purpose.value = pu;
      if (k.grade_sought) f.cert.value = k.grade_sought; else if (/instrument/i.test(k.test_type || '')) f.cert.value = 'instrument'; if (k.class) f.cls.value = k.class;
      if (k.scheduled_at) f.test_date.value = k.scheduled_at.slice(0, 10); if (k.departure_airport) f.location.value = k.departure_airport;
      const tailOpt = Array.from(f.aircraft.options).find((o) => k.tail_number && o.textContent.toUpperCase().startsWith(k.tail_number.toUpperCase())); if (tailOpt) f.aircraft.value = tailOpt.value;
    };
    f.applicant.addEventListener('change', () => { fillCr(); applyCr(crOf()); sync(); });
    f.checkride.addEventListener('change', () => { fillCr(); applyCr(crOf()); sync(); });
    fillCr(); if (!cr) applyCr(crOf());
    f.aircraft.addEventListener('change', () => { const o = f.aircraft.selectedOptions[0]; if (o && o.dataset.cls) { f.cls.value = o.dataset.cls; if (o.dataset.type) f.typeDesignator.value = o.dataset.type; sync(); } });
    sync();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const prof = { cert: f.cert.value, cls: f.cls.value, purpose: f.purpose.value, held: f.purpose.value === 'added_rating' ? f.held.value : null, atpCert: f.purpose.value === 'type_rating' ? f.atpCert.checked : f.cert.value === 'atp', typeDesignator: f.typeDesignator.value.trim() || null };
      const r = E.resolveStandard(S.std, prof); if (r.error) { toast(r.error, true); return; }
      if (prof.purpose === 'retest' || prof.purpose === 'continuation') {
        const d = prior.find((x) => x.id === f.retest.value);
        if (!d) { toast('Select the previous attempt.', true); return; }
        prof.retestTasks = Object.entries(d.results || {}).filter(([, v]) => v.grade !== 'S').map(([k]) => k);
        prof.retestOf = d.id;
      }
      const app = apps.find((a) => a.id === f.applicant.value); if (!app) { toast('Select an applicant.', true); return; }
      const kp = ktFor(prof, r.doc); const ktl = kp.tests; const aktr = kp.aktr;
      let crow = crOf();
      const usage = await elementUsage();
      const tasks = E.requiredTasks(r.doc, prof, { usage });
      if ((r.doc.cfi_matrix && prof.cert === 'cfi') || r.doc.select_rules) prof.cfiPicks = tasks.filter((t) => t.required).map((t) => t.key);
      const content = { tasks: {}, scenario: { triggers: [] }, briefings: {}, questions: [], eligibility: {}, attest: {}, aktr, ktests: ktl.map((t) => ({ test: t.test, date: t.date, score: t.score, expires: t.expires || E.ktValidUntil(E.ktCode(t), t.date), aktr: t.aktr || [] })) };
      tasks.forEach((t) => { const s = E.selectElements(r.doc, t.area, t.task, { aktr, usage, cls: prof.cls }); content.tasks[t.key] = { included: t.required, elements: t.required ? s.selected : [], why: s.why, method: defaultMethod(t), excludeReason: '' }; });
      Object.keys(E.DEFAULT_BRIEFINGS).forEach((k) => content.briefings[k] = (((orgSt.briefings || {})[k]) || E.DEFAULT_BRIEFINGS[k]).replace(/\{std\}/g, r.doc.num));
      const sp = E.scenarioProfile(orgSt, prof.cert);
      if (!crow) {
        // No checkride yet: create one from this form so applicant, checkride and plan stay linked.
        const TT = { practical_test: prof.cert === 'instrument' ? 'Instrument Rating' : 'Original Certificate', added_rating: 'Additional Rating', retest: prof.cert === 'instrument' ? 'Retest for Instrument Rating' : 'Retest for Original Certificate', continuation: 'Continued from Previously Discontinued Test', reinstatement: 'Reinstatement of CFI', type_rating: 'Type Rating', mock_checkride: 'Mock Checkride', training: 'Mock Checkride' };
        const acx = acs.find((a) => a.id === f.aircraft.value);
        try {
          crow = await q(sb.from('checkrides').insert({ org_id: S.orgId, applicant_id: app.id, examiner_id: S.ctx.user_id, created_by: S.ctx.user_id, source: 'manual', test_type: TT[prof.purpose] || 'Original Certificate', grade_sought: prof.cert, class: prof.cls,
            scheduled_at: f.test_date.value ? new Date(f.test_date.value + 'T12:00:00').toISOString() : null, departure_airport: (f.location.value.trim().match(/^[A-Z0-9]{3,5}\b/i) || [''])[0].toUpperCase() || null,
            aircraft_make_model: acx ? acx.make_model : null, tail_number: acx ? acx.tail : null, school: app.school || null, recommending_instructor: app.recommending_instructor || null, instructor_cert_number: app.instructor_cert_number || null, iacra_app_id: app.iacra_app_id || null,
            knowledge_test: { tests: ktl, aktr: Array.from(new Set([].concat(...ktl.map((t) => t.aktr || [])))) } }).select('*').single());
        } catch (er) { toast('Could not create the checkride record: ' + friendly(er), true); return; }
      }
      content.scenario.dep = content.scenario.dep || crow.departure_airport || '';
      content.checkride = { id: crow.id, test_type: crow.test_type, basis: crow.basis, preapproval_number: crow.preapproval_number, scheduled_at: crow.scheduled_at, aircraft: crow.aircraft_make_model, tail: crow.tail_number, notes: crow.notes,
        iacra_app_id: crow.iacra_app_id, school: crow.school, recommending_instructor: crow.recommending_instructor, instructor_cert_number: crow.instructor_cert_number };
      if (sp) { content.scenario.profile = sp; if (sp.arrival && !content.scenario.dest) content.scenario.dest = sp.arrival; if (sp.weather) content.scenario.weather = sp.weather; }
      const ac = acs.find((a) => a.id === f.aircraft.value);
      const row = { org_id: S.orgId, applicant_id: app.id, aircraft_id: ac ? ac.id : null, examiner_id: S.ctx.user_id, purpose: prof.purpose, test_profile: prof, standard_id: r.doc.id,
        standard_sha256: ((S.docsDb || []).find((d) => d.id === r.doc.id) || {}).sha256 || r.doc.sha256, test_date: f.test_date.value || null, location: f.location.value.trim() || null, title: profileTitle(prof, app), content };
      try {
        const p = await act(qs('button[type=submit]', f), () => q(sb.from('poas').insert(row).select('id').single()));
        try { await q(sb.from('checkrides').update({ poa_id: p.id }).eq('id', crow.id)); } catch (_) { toast('Plan created, but the checkride record could not be linked.', true); }
        go('#/poa/' + p.id + '?step=tasks');
      } catch (_) {}
    });
  }
  function defaultMethod(t) {
    const a = t.area.title.toLowerCase();
    if (/preflight preparation/.test(a)) return 'oral';
    if (t.task.elements.some((e) => e.type === 'S') && !/preflight preparation/.test(a)) return 'flight';
    return 'oral';
  }
  async function elementUsage() {
    const rows = await q(sb.from('poas').select('content').eq('org_id', S.orgId).eq('examiner_id', S.ctx.user_id).neq('status', 'void').order('created_at', { ascending: false }).limit(40));
    const u = {};
    rows.forEach((r) => Object.values((r.content && r.content.tasks) || {}).forEach((t) => (t.included ? t.elements || [] : []).forEach((c) => u[c] = (u[c] || 0) + 1)));
    return u;
  }

  const STEPS = [['setup', 'Setup'], ['tasks', 'Tasks & elements'], ['scenario', 'Scenario'], ['briefings', 'Briefings'], ['questions', 'Questions'], ['review', 'Eligibility & compliance']];
  async function viewPoa(id, params) {
    const c = shell('poas');
    await Promise.all([loadStd(), S.docsDb ? null : loadDocsDb(), A2().loadBriefReq().catch(() => null)]);
    let p = await q(sb.from('poas').select('*').eq('id', id).single());
    const doc = stdDoc(p.standard_id);
    const [app, ac, prior, versions, dbs, docs] = await Promise.all([
      p.applicant_id ? q(sb.from('applicants').select('*').eq('id', p.applicant_id).single()) : null,
      p.aircraft_id ? q(sb.from('aircraft').select('*').eq('id', p.aircraft_id).single()) : null,
      q(sb.from('poas').select('id,title,content').eq('org_id', p.org_id).eq('examiner_id', p.examiner_id).neq('id', p.id).neq('status', 'void').order('created_at', { ascending: false }).limit(25)),
      q(sb.from('poa_versions').select('version,content_hash,created_at').eq('poa_id', p.id).order('version', { ascending: false })),
      q(sb.from('debriefs').select('id,status,outcome').eq('poa_id', p.id)),
      q(sb.from('documents').select('*').eq('poa_id', p.id).order('uploaded_at', { ascending: false })),
    ]);
    const editable = p.status === 'draft' && (can('org_admin') || (can('examiner') && p.examiner_id === S.ctx.user_id));
    const tasks = E.requiredTasks(doc, p.test_profile);
    const content = p.content;
    let step = params.get('step') || (editable ? 'tasks' : 'review');
    let saveT = null; let saving = Promise.resolve();
    const docStatus = ((S.docsDb || []).find((d) => d.id === doc.id) || {}).status || 'current';
    const comp = () => E.complianceChecks({ doc, profile: p.test_profile, tasks, content, priorPoas: prior, aktr: content.aktr || (app && app.knowledge_test && app.knowledge_test.aktr) || [], ktests: content.ktests || (app ? E.ktTests(app.knowledge_test) : null), testDate: p.test_date, docStatus, lastCheck: S.lastCheck });
    const viewTok = {}; S.poaView = viewTok; const live = () => S.poaView === viewTok;
    const save = () => {
      if (!editable || !live()) return; // a background AI run from a plan view the user has left must not overwrite newer edits
      clearTimeout(saveT);
      qs('#saveState', c) && (qs('#saveState', c).textContent = 'Saving…');
      saveT = setTimeout(() => {
        const cc = comp();
        saving = q(sb.from('poas').update({ content, compliance: { counts: cc.counts, ready: cc.ready, coverage: cc.coverage } }).eq('id', p.id)).then(() => { qs('#saveState', c) && (qs('#saveState', c).textContent = 'Saved ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })); })
          .catch((e) => { toast(friendly(e), true); qs('#saveState', c) && (qs('#saveState', c).textContent = 'Not saved'); });
      }, 600);
    };
    const debrief = dbs[0];
    const headerActions = () => {
      const a = [];
      if (p.status !== 'draft') a.push(`<a class="btn ghost" href="#/print/poa/${p.id}">Print plan</a>`, `<a class="btn ghost" href="#/print/proof/${p.id}">Proof of compliance</a>`, `<a class="btn ghost" href="#/print/packet/${p.id}">Applicant packet</a>`, `<a class="btn ghost" href="#/print/sheet/${p.id}">Paper grade sheet</a>`);
      else a.push(`<a class="btn ghost" href="#/print/proof/${p.id}">Preview proof</a>`);
      if (p.status === 'final' && can('org_admin', 'examiner')) a.push(`<a class="btn" href="#/debrief/${p.id}">Start Test</a>`);
      if (p.status === 'completed' && debrief) a.push(`<a class="btn" href="#/debrief/${p.id}">View result</a>`);
      return a.join('');
    };
    const render = () => {
      const cc = comp();
      c.innerHTML = head(esc(p.title) + ` <span class="pill">v${p.version}</span> ${statusPill(p.status)}`,
        `${esc(doc.num)} · ${esc(E.PURPOSE_LABEL[p.purpose])}${p.test_date ? ' · ' + fmtDate(p.test_date) : ''}${p.location ? ' · ' + esc(p.location) : ''}${app ? ` · <a href="#/applicant/${app.id}">${esc(app.first_name + ' ' + app.last_name)}</a>` : ''}${ac ? ' · ' + esc(ac.tail) : ''}`, headerActions()) +
        (p.status !== 'draft' ? `<div class="banner ${p.status === 'completed' ? 'ok' : 'info'}">This plan is ${p.status === 'completed' ? 'completed' : 'finalized'} and locked. Fingerprint <span class="mono">${esc((p.content_hash || '').slice(0, 20))}…</span> recorded ${fmtDT(p.finalized_at)}.${p.status === 'final' && can('org_admin', 'examiner') ? ' <a href="#" id="revise">Create a revision</a> to change it; this version stays on record.' : ''}</div>` : '') +
        (docStatus !== 'current' ? `<div class="banner warn">The FAA source file for ${esc(doc.num)} has changed since this edition was loaded. Review before relying on this plan.</div>` : '') +
        `<div class="steps">${STEPS.map(([k, l], i) => `<button class="step ${step === k ? 'active' : ''}" data-step="${k}"><span class="n">${i + 1}</span>${l}</button>`).join('')}<span style="margin-left:auto" class="xs muted" id="saveState">${editable ? 'Changes save automatically' : ''}</span></div><div id="pane"></div>
        ${editable ? `<div class="sticky-actions"><div class="btn-row"><span class="sm">${cc.ready ? '<span class="pill ok">No compliance gaps</span>' : `<span class="pill bad">${cc.counts.gap || 0} gap(s)</span>`} <span class="pill warn">${cc.counts.review || 0} to review</span></span><span style="flex:1"></span>
          ${p.status === 'draft' ? '<button class="btn danger sm" id="del">Delete draft</button>' : ''}<button class="btn ghost" id="next">Next step</button><button class="btn" id="fin">Finalize plan</button></div></div>` : ''}`;
      qsa('[data-step]', c).forEach((b) => b.onclick = () => { step = b.dataset.step; render(); });
      const pane = qs('#pane', c);
      ({ setup: paneSetup, tasks: paneTasks, scenario: paneScenario, briefings: paneBriefings, questions: paneQuestions, review: paneReview })[step](pane);
      const rv = qs('#revise', c); if (rv) rv.onclick = async (e) => { e.preventDefault(); if (!(await confirmBox('Create a revision?', 'Version ' + p.version + ' stays on record with its fingerprint. A new draft version ' + (p.version + 1) + ' opens for editing.', 'Create revision'))) return; try { await rpc('revise_poa', { p_id: p.id }); toast('Revision created'); route(); } catch (er) { toast(friendly(er), true); } };
      const nx = qs('#next', c); if (nx) nx.onclick = () => { const i = STEPS.findIndex((s) => s[0] === step); step = STEPS[Math.min(i + 1, STEPS.length - 1)][0]; render(); window.scrollTo(0, 0); };
      const dl = qs('#del', c); if (dl) dl.onclick = async () => { if (!(await confirmBox('Delete this draft?', 'The draft plan will be removed. Finalized plans cannot be deleted.', 'Delete'))) return; try { await q(sb.from('poas').delete().eq('id', p.id)); toast('Draft deleted'); go('#/poas'); } catch (er) { toast(friendly(er), true); } };
      const fn = qs('#fin', c); if (fn) fn.onclick = async () => {
        const cc2 = comp();
        if (!cc2.ready) { step = 'review'; render(); toast('Resolve the compliance gaps first.', true); return; }
        if (!(await confirmBox('Finalize this plan?', 'The plan will be locked and fingerprinted. You can still create a revision later; every version stays on record.', 'Finalize'))) return;
        try { await saving; clearTimeout(saveT); await q(sb.from('poas').update({ content, compliance: { counts: cc2.counts, ready: cc2.ready, coverage: cc2.coverage } }).eq('id', p.id)); await rpc('finalize_poa', { p_id: p.id }); toast('Plan finalized'); go('#/poa/' + p.id); } catch (er) { toast(friendly(er), true); }
      };
    };
    const dis = editable ? '' : 'disabled';

    function paneSetup(el) {
      const pr = p.test_profile;
      el.innerHTML = `<div class="grid2"><div class="card"><h2>Test profile</h2><table class="t">
        ${[['Purpose', E.PURPOSE_LABEL[p.purpose]], ['Certificate', E.CERT_LABEL[pr.cert]], ['Category / class', pr.cls + ' — ' + E.CLASS_LABEL[pr.cls]], pr.held ? ['Rating held', pr.held] : null, pr.typeDesignator ? ['Type designator', pr.typeDesignator] : null, p.purpose === 'type_rating' ? ['ATP certificate on this test', pr.atpCert ? 'Yes' : 'No'] : null, pr.retestTasks ? ['Carried-forward tasks', pr.retestTasks.join(', ') || 'None'] : null].filter(Boolean).map(([k, v]) => `<tr><td class="sm muted" style="width:42%">${k}</td><td class="sm">${esc(v)}</td></tr>`).join('')}
        </table><p class="xs muted">The profile decides the governing standard and the required tasks. To change it, create a new plan.</p></div>
        <div class="card"><h2>Governing standard</h2><p class="sm"><b>${esc(doc.num)}</b> — ${esc(doc.title)}<br>Edition ${esc(doc.edition_date)} · Incorporated by reference in 14 CFR 61.14, effective May 31, 2024</p>
        <p class="xs muted mono">FAA file SHA-256 ${esc((p.standard_sha256 || '').slice(0, 32))}…</p><p class="sm"><a href="${esc(doc.url)}" target="_blank" rel="noopener">Open the FAA PDF</a></p></div></div>
        ${setupKtCard()}
        <div class="card"><h2>Logistics</h2><div class="form-grid"><label>Title<input id="ti" ${dis} value="${esc(p.title)}"></label><label>Test date<input id="td" type="date" ${dis} value="${esc(p.test_date)}"></label><label class="full">Location<input id="lo" ${dis} value="${esc(p.location)}"></label>
        <label class="full">Examiner notes (internal)<textarea id="nt" ${dis}>${esc(content.notes)}</textarea></label></div>${editable ? '<button class="btn sm" id="sv">Save logistics</button>' : ''}</div>
        <div class="card"><h2>Versions</h2>${versions.length ? `<table class="t">${versions.map((v) => `<tr><td class="sm">Version ${v.version}</td><td class="mono xs">${esc(v.content_hash)}</td><td class="sm muted">${fmtDT(v.created_at)}</td></tr>`).join('')}</table>` : '<p class="sm muted">No finalized versions yet.</p>'}</div>
        <div class="card"><div class="card-head"><h2>Attached documents</h2>${can('org_admin', 'examiner') ? '<button class="btn sm" id="up">Upload</button>' : ''}</div><div id="docs"></div></div>`;
      renderDocs(qs('#docs', el), docs);
      bindSetupKt(el);
      const up = qs('#up', el); if (up) up.onclick = () => uploadDoc({ applicant_id: p.applicant_id, poa_id: p.id }, () => route());
      const sv = qs('#sv', el); if (sv) sv.onclick = async () => { content.notes = qs('#nt', c).value; try { await act(sv, () => q(sb.from('poas').update({ title: qs('#ti', c).value.trim() || p.title, test_date: qs('#td', c).value || null, location: qs('#lo', c).value.trim() || null, content }).eq('id', p.id)), 'Saved'); p.title = qs('#ti', c).value.trim() || p.title; p.test_date = qs('#td', c).value || null; p.location = qs('#lo', c).value.trim() || null; } catch (_) {} };
    }

    // Appendix requirements tied to a task (for example two approaches on VI.A), shown under that task with the examiner's note.
    function apxTaskHtml(key) {
      const items = E.appendixFor(doc, { profile: p.test_profile, content, tasks }).items.filter((it) => (it.tasks || []).includes(key)); if (!items.length) return '';
      const note = (content.appendix || {}).note || {};
      return items.map((it) => `<div class="apx-task"><div class="xs"><span class="pill warn">Appendix requirement</span> <b>${esc(it.head)}</b></div>${it.text && it.text !== it.head ? `<div class="xs muted" style="margin:.2rem 0">${esc(it.text)}</div>` : ''}
        <label class="xs" style="margin:.25rem 0 0">How this will be met<textarea data-apn="${esc(it.id)}" ${dis} style="min-height:40px" placeholder="How the applicant will meet this requirement on this test">${esc(note[it.id] || '')}</textarea></label></div>`).join('');
    }
    // Oral (ground) tasks get a task scenario; flight tasks list their skills. "both" counts as oral too.
    const isOral = (k) => { const m = (content.tasks[k] || {}).method || 'oral'; return m === 'oral' || m === 'both'; };
    // Applicant / checkride details and the knowledge test and AKTR codes this plan uses.
    function setupKtCard() {
      const ck = content.checkride || {}; const kl = content.ktests || []; const ak = content.aktr || [];
      const rows = [['Applicant', app ? app.first_name + ' ' + app.last_name + (app.ftn ? ' · FTN ' + app.ftn : '') : '—'], ['Checkride', [ck.test_type, ck.scheduled_at ? fmtDT(ck.scheduled_at) : ''].filter(Boolean).join(' · ')], ['IACRA application', ck.iacra_app_id], ['Recommending instructor', [ck.recommending_instructor, ck.instructor_cert_number].filter(Boolean).join(' · ')], ['School', ck.school]];
      return `<div class="card"><div class="card-head"><h2>Applicant, checkride and knowledge test</h2>${ck.id ? `<a class="btn ghost sm" href="#/applicant/${p.applicant_id}">Checkride record</a>` : ''}</div>
        <table class="t">${rows.map(([k, v]) => `<tr><td class="sm muted" style="width:32%">${k}</td><td class="sm">${esc(v || '—')}</td></tr>`).join('')}
        <tr><td class="sm muted">Knowledge test used</td><td class="sm">${kl.length ? kl.map((t) => `<b>${esc(E.ktCode(t))}</b> ${esc(E.KT_CATALOG[E.ktCode(t)] || '')}${t.date ? ' · ' + esc(fmtDate(t.date)) : ''}${t.score ? ' · ' + esc(t.score) + '%' : ''}`).join('<br>') : 'None recorded'}</td></tr></table>
        <div class="sm strong" style="margin:.6rem 0 .25rem">AKTR codes to be tested (${ak.length})</div>
        ${ak.length ? `<div class="chips">${ak.map((x) => `<span class="chip mono">${esc(x)}</span>`).join('')}</div>` : '<p class="sm muted">None. Elements are sampled normally.</p>'}
        ${editable ? `<details style="margin-top:.5rem"><summary class="sm" style="cursor:pointer">Change AKTR codes</summary><textarea id="akEd" style="min-height:56px">${esc(ak.join(', '))}</textarea>
          <div class="btn-row"><button class="btn sm" id="akApply">Apply codes</button>${ck.id ? '<button class="btn ghost sm" id="akReload">Reload from the checkride record</button>' : ''}</div>
          <p class="xs muted">New codes are added to their tasks as elements to test. Removed codes are taken off their tasks along with their questions.</p></details>` : ''}</div>`;
    }
    function applyAktr(next, kts) {
      next = Array.from(new Set(next.map((x) => String(x).trim().toUpperCase()).filter(Boolean)));
      const prev = (content.aktr || []).map((x) => String(x).toUpperCase());
      const added = next.filter((x) => !prev.includes(x)); const removed = prev.filter((x) => !next.includes(x)); const unknown = [];
      added.forEach((code) => {
        const t = tasks.find((tt) => E.elementCodes(doc, tt.area, tt.task).some((c2) => c2.toUpperCase() === code)); if (!t) { unknown.push(code); return; }
        const real = E.elementCodes(doc, t.area, t.task).find((c2) => c2.toUpperCase() === code);
        const ct = content.tasks[t.key] = content.tasks[t.key] || { included: true, elements: [], method: defaultMethod(t) }; ct.included = true; ct.elements = Array.from(new Set((ct.elements || []).concat(real)));
      });
      removed.forEach((code) => {
        Object.values(content.tasks).forEach((ct) => { ct.elements = (ct.elements || []).filter((c2) => c2.toUpperCase() !== code); });
        content.questions = (content.questions || []).filter((x) => String(x.ref || '').toUpperCase() !== code);
      });
      content.aktr = next.filter((x) => !unknown.includes(x)); if (kts) content.ktests = kts;
      save(); render();
      toast(`AKTR codes updated: ${added.length - unknown.length} added, ${removed.length} removed.` + (unknown.length ? ' Not in ' + doc.num + ': ' + unknown.join(', ') + '.' : ''), !!unknown.length);
    }
    function bindSetupKt(el) {
      const ap = qs('#akApply', el); if (ap) ap.onclick = () => { const v = aktrList(qs('#akEd', el).value); const bad = v.filter((x) => !AKTR_RE.test(x)); if (bad.length) { toast('These do not look like ACS codes: ' + bad.join(', '), true); return; } applyAktr(v); };
      const rl = qs('#akReload', el); if (rl) rl.onclick = async () => {
        try {
          const k = await q(sb.from('checkrides').select('knowledge_test').eq('id', content.checkride.id).single());
          const kp = E.ktForPlan(p.test_profile, doc, E.ktTests(k.knowledge_test));
          if (!(await confirmBox('Use the checkride knowledge test?', 'Tests used: ' + (kp.tests.map((t) => E.ktCode(t)).join(', ') || 'none') + '. AKTR codes: ' + (kp.aktr.join(', ') || 'none') + '.' + (kp.skipped.length ? ' Left out (other certificate level): ' + kp.skipped.join(', ') + '.' : ''), 'Use these'))) return;
          applyAktr(kp.aktr, kp.tests.map((t) => ({ test: t.test, date: t.date, score: t.score, expires: t.expires || E.ktValidUntil(E.ktCode(t), t.date), aktr: t.aktr || [] })));
        } catch (e) { toast(friendly(e), true); }
      };
    }

    function paneTasks(el) {
      const aktr = new Set((content.aktr || []).map((x) => x.toUpperCase()));
      const byArea = [];
      tasks.forEach((t) => { let a = byArea.find((x) => x.area === t.area); if (!a) byArea.push(a = { area: t.area, list: [] }); a.list.push(t); });
      const inc = tasks.filter((t) => content.tasks[t.key] && content.tasks[t.key].included).length;
      const otherCls = [];
      tasks.forEach((t) => { const ct = content.tasks[t.key]; if (!ct || !ct.included) return; const cs = E.elementCodes(doc, t.area, t.task); const sel = new Set(ct.elements || []);
        t.task.elements.forEach((e, i) => { if (sel.has(cs[i]) && !aktr.has(cs[i].toUpperCase()) && !E.elementApplies(doc, t.task, e, p.test_profile.cls)) otherCls.push({ k: t.key, ref: cs[i] }); }); });
      el.innerHTML = (otherCls.length ? `<div class="banner warn">${otherCls.length} selected element(s) apply only to another class of airplane, not ${esc(p.test_profile.cls)}: <span class="mono">${esc(otherCls.map((x) => x.ref).join(', '))}</span>. ${editable ? '<button class="btn sm" id="rmOther" style="margin-left:.4rem">Remove them and their questions</button>' : 'Create a revision to remove them.'}</div>` : '') + `<div class="banner info">Required tasks are pre-selected from <b>${esc(doc.num)}</b>. ${doc.kind === 'ACS' ? 'For each task smartPOA selects every skill element, any knowledge-test (AKTR) deficiencies, and at least one knowledge and one risk management element, rotating toward elements you have used least.' : 'PTS objective items are all selected.'} ${inc} task(s) included.</div>
        <div class="btn-row" style="margin-bottom:.7rem"><button class="btn ghost sm" id="exAll">Expand all</button><button class="btn ghost sm" id="coAll">Collapse all</button>${editable && doc.kind === 'ACS' ? '<button class="btn ghost sm" id="resample">Re-sample K and R elements</button>' : ''}<label class="check sm" style="margin:0 0 0 .5rem"><input type="checkbox" id="showEx"> Show tasks not required</label></div>
        ${byArea.map(({ area, list }) => {
          const reqN = list.filter((t) => t.required).length;
          const anyOn = list.some((t) => t.required || (content.tasks[t.key] && content.tasks[t.key].included));
          return `<div class="area" data-area="${area.roman}" ${anyOn ? '' : 'data-optional="1" style="display:none"'}><div class="area-head"><span class="roman">${area.roman}</span><span class="title">${esc(area.title)}</span><span class="xs muted">${list.filter((t) => content.tasks[t.key] && content.tasks[t.key].included).length}/${reqN} required included</span></div>
          <div class="area-body" style="display:none">${area.notes.length ? `<div class="task xs muted">${area.notes.map(esc).join('<br>')}</div>` : ''}
          ${list.map((t) => {
            const ct = content.tasks[t.key] || { included: false, elements: [] };
            const sel = new Set(ct.elements || []);
            const codes = E.elementCodes(doc, t.area, t.task);
            return `<div class="task ${ct.included ? '' : 'excluded'}" data-key="${t.key}" ${!t.required && !ct.included ? 'data-optional="1" style="display:none"' : ''}>
              <div class="task-row"><input type="checkbox" class="inc" ${ct.included ? 'checked' : ''} ${dis} aria-label="Include task"><span class="tl">${t.key}</span>
              <div class="tt"><div class="strong sm">${esc(t.task.title)}</div><div class="xs muted">${t.required ? '<span class="pill accent">Required</span> ' : '<span class="pill">Optional</span> '}${esc(t.reason)}</div>
              ${t.task.notes.length ? `<div class="xs muted" style="margin-top:.25rem">Note: ${t.task.notes.map(esc).join(' ')}</div>` : ''}
              ${t.task.quick ? `<div class="xs" style="margin-top:.25rem"><span class="pill info">Examiner tolerance summary</span> ${esc(t.task.quick)}${t.task.quick_src === 'examiner' ? ' <span class="muted">(examiner practice; this task has no ACS numeric tolerance)</span>' : ''}</div>` : ''}${t.task.exnote ? `<div class="xs muted" style="margin-top:.25rem">Examiner note: ${esc(t.task.exnote)}</div>` : ''}
              ${ct.included ? apxTaskHtml(t.key) : ''}
              ${t.required && !ct.included ? `<label class="xs" style="margin:.35rem 0 0">Reason for leaving out (shown on the proof form)<input class="exr" ${dis} value="${esc(ct.excludeReason)}"></label>` : ''}</div>
              <div class="seg" role="group" aria-label="Method">${['oral', 'flight', 'both'].map((m) => `<button type="button" data-m="${m}" class="${ct.method === m ? 'on' : ''}" ${dis}>${m === 'both' ? 'Both' : m === 'oral' ? 'Oral' : 'Flight'}</button>`).join('')}</div></div>
              <details class="els-d" ${ct.included ? '' : ''}><summary class="xs muted" style="margin:.35rem 0 0 3.8rem;cursor:pointer">${sel.size} of ${t.task.elements.length} elements selected</summary><div class="els">
              ${t.task.elements.map((e, i) => { const ref = codes[i]; const isA = aktr.has(ref.toUpperCase()); const na = !E.elementApplies(doc, t.task, e, p.test_profile.cls); return `<label class="el t-${e.type}${na ? ' el-na' : ''}"><input type="checkbox" class="elc" data-ref="${esc(ref)}" ${sel.has(ref) ? 'checked' : ''} ${dis || (!ct.included || (na && !sel.has(ref)) ? 'disabled' : '')}><span class="code">${esc(ref)}</span><span style="flex:1${e.sub ? ';padding-left:.8rem' : ''}">${esc(e.text)}</span>${na ? `<span class="pill ${sel.has(ref) ? 'bad' : ''}">${sel.has(ref) ? 'Other class — remove' : esc(E.elementClasses(t.task, e).join(', ')) + ' only'}</span>` : isA ? '<span class="pill bad">AKTR</span>' : ct.why && ct.why[ref] && sel.has(ref) ? `<span class="why">${esc(ct.why[ref])}</span>` : ''}</label>`; }).join('')}
              </div></details></div>`;
          }).join('')}</div></div>`;
        }).join('')}`;
      qsa('[data-apn]', el).forEach((ta) => ta.oninput = () => { const ap = content.appendix = content.appendix || {}; ap.note = ap.note || {}; const v = ta.value; if (v.trim()) ap.note[ta.dataset.apn] = v; else delete ap.note[ta.dataset.apn]; save(); });
      qsa('.area-head', el).forEach((h) => h.onclick = () => { const b = h.nextElementSibling; b.style.display = b.style.display === 'none' ? '' : 'none'; });
      const rmo = qs('#rmOther', el); if (rmo) rmo.onclick = () => { const bad = new Set(otherCls.map((x) => x.ref)); otherCls.forEach((x) => { const ct = content.tasks[x.k]; ct.elements = (ct.elements || []).filter((r) => !bad.has(r)); if (ct.why) delete ct.why[x.ref]; });
        content.questions = (content.questions || []).filter((x) => !bad.has(x.ref)); save(); toast(bad.size + ' element(s) removed'); paneTasks(el); };
      qs('#exAll', el).onclick = () => qsa('.area-body', el).forEach((b) => b.style.display = '');
      qs('#coAll', el).onclick = () => qsa('.area-body', el).forEach((b) => b.style.display = 'none');
      qs('#showEx', el).onchange = (e) => qsa('[data-optional]', el).forEach((t) => t.style.display = e.target.checked ? '' : 'none');
      if (!editable) return;
      qsa('.task', el).forEach((tv) => {
        const key = tv.dataset.key; if (!key) return;
        const t = tasks.find((x) => x.key === key);
        const ct = content.tasks[key] = content.tasks[key] || { included: false, elements: [], method: defaultMethod(t) };
        const inc = qs('.inc', tv); if (inc) inc.onchange = () => {
          ct.included = inc.checked;
          if (ct.included && !(ct.elements || []).length) { const s = E.selectElements(doc, t.area, t.task, { aktr: content.aktr || [], cls: p.test_profile.cls }); ct.elements = s.selected; ct.why = s.why; }
          save(); const open = qs('.area-body', tv.closest('.area')).style.display; paneTasks(el); const ar = qs(`[data-area="${t.area.roman}"] .area-body`, el); if (ar) ar.style.display = open;
          const showEx = qs('#showEx', el); if (showEx) { showEx.checked = !t.required || showEx.checked; showEx.dispatchEvent(new Event('change')); }
        };
        qsa('.elc', tv).forEach((cb) => cb.onchange = () => { const s = new Set(ct.elements || []); cb.checked ? s.add(cb.dataset.ref) : s.delete(cb.dataset.ref); ct.elements = Array.from(s); qs('summary', tv).textContent = s.size + ' of ' + t.task.elements.length + ' elements selected'; save(); });
        qsa('[data-m]', tv).forEach((b) => b.onclick = () => { ct.method = b.dataset.m; qsa('[data-m]', tv).forEach((x) => x.classList.toggle('on', x === b)); save(); });
        const ex = qs('.exr', tv); if (ex) ex.oninput = () => { ct.excludeReason = ex.value; save(); };
      });
      const rs = qs('#resample', el); if (rs) rs.onclick = async () => {
        const usage = await elementUsage();
        tasks.forEach((t) => { const ct = content.tasks[t.key]; if (!ct || !ct.included) return; const s = E.selectElements(doc, t.area, t.task, { aktr: content.aktr || [], usage, rand: Math.random, cls: p.test_profile.cls }); ct.elements = s.selected; ct.why = s.why; });
        save(); paneTasks(el); toast('Knowledge and risk elements re-sampled');
      };
    }

    const codeTag = (c) => (c && c.length ? ` <span class="mono xs muted">· ${esc(c.join(', '))}</span>` : '');
    function paneScenario(el) {
      // Older plans may hold sub-scenarios; they are no longer used.
      if (content.scenario && content.scenario.taskSubs && editable) { delete content.scenario.taskSubs; delete content.scenario.taskSubCodes; save(); }
      const sc = content.scenario = content.scenario || { triggers: [] };
      const missions = E.missionsFor(p.test_profile);
      const avail = E.triggersFor(tasks);
      const cov = E.scenarioCoverage(tasks, sc);
      const pct = cov.total ? Math.round(100 * cov.covered.length / cov.total) : 0;
      const fill = (s) => String(s).replace(/\{dest\}/g, sc.dest || 'the destination').replace(/\{dep\}/g, sc.dep || 'the departure airport').replace(/\{aircraft\}/g, ac ? ac.make_model : 'aircraft');
      const on = new Set((sc.triggers || []).map((t) => t.id));
      const uncovered = tasks.filter((t) => t.required && !cov.covered.includes(t.key));
      el.innerHTML = `<div class="grid2"><div class="card"><h2>Mission</h2>
        ${editable && can('org_admin', 'examiner') ? `<div class="btn-row" style="margin-bottom:.4rem"><button type="button" class="btn ghost sm" id="aiM">Draft scenario with AI</button><span class="xs muted">AI drafts need examiner review. No applicant information is sent.</span></div>` : ''}
        ${sc.aiDraft ? '<div class="banner warn xs" style="margin-bottom:.4rem">AI draft — examiner review required before use.</div>' : ''}
        <label>Start from a template<select id="tpl" ${dis}><option value="">Choose a mission template…</option>${missions.map((m, i) => `<option value="${i}">${esc(m.name)}</option>`).join('')}</select></label>
        <div class="form-grid3"><label>Departure<input id="dep" ${dis} value="${esc(sc.dep)}" placeholder="KPBI"></label><label>Destination<input id="dest" ${dis} value="${esc(sc.dest)}" placeholder="KVRB"></label><label>Alternate<input id="alt" ${dis} value="${esc(sc.alt)}" placeholder="KFPR"></label></div>
        <label>Scenario given to the applicant<textarea id="mission" ${dis} style="min-height:140px" placeholder="Describe the flight the applicant will plan.">${esc(sc.mission)}</textarea></label>
        <div class="form-grid"><label>Route / altitude<input id="route" ${dis} value="${esc(sc.route)}"></label><label>Passengers & cargo<input id="pax" ${dis} value="${esc(sc.pax)}" placeholder="2 adults, 40 lb baggage"></label></div>
        <label>Weather package / source<textarea id="wx" ${dis} style="min-height:60px" placeholder="e.g. Use actual weather on test day; backup: archived package dated…">${esc(sc.weather)}</textarea></label>
        <label>Constraints given to the applicant<textarea id="cons" ${dis} style="min-height:60px" placeholder="e.g. Must arrive before 1700; one passenger is nervous">${esc(sc.constraints)}</textarea></label></div>
        <div class="card"><h2>Scenario coverage</h2><div class="meter" aria-label="coverage"><i style="width:${pct}%"></i></div><p class="sm"><b>${cov.covered.length} of ${cov.total}</b> required tasks are evaluated through the planning phase and selected events (${pct}%). The managing specialist looks for a scenario that evaluates most tasks with minimum disruptions.</p>
        ${uncovered.length ? `<h3>Not yet covered by the scenario</h3><div class="xs">${uncovered.map((t) => `<label class="check" style="margin-bottom:.25rem"><input type="checkbox" class="xc" data-k="${t.key}" ${(sc.extraCovered || []).includes(t.key) ? 'checked' : ''} ${dis}><span><span class="mono">${t.key}</span> ${esc(t.task.title_plain)}</span></label>`).join('')}</div><p class="xs muted">Tick a task if your mission covers it in a way not listed in events (for example, a maneuver flown as part of the arrival).</p>` : '<div class="banner ok">Every required task is tied to the scenario.</div>'}</div></div>
        ${(() => { const incAll = tasks.filter((t) => content.tasks[t.key] && content.tasks[t.key].included); const inc = incAll.filter((t) => isOral(t.key)); const nFl = incAll.length - inc.length; const ts = sc.taskScenarios || {}; const done = inc.filter((t) => (ts[t.key] || '').trim()).length;
          if (!incAll.length) return '';
          const areas = []; inc.forEach((t) => { let g = areas.find((x) => x.r === t.area.roman); if (!g) areas.push(g = { r: t.area.roman, title: t.area.title, list: [] }); g.list.push(t); });
          return `<div class="card" id="tsCard"><div class="card-head"><h2>Task scenarios</h2><span class="xs muted">${done} of ${inc.length} oral tasks have a scenario · printed with each task</span></div>
          <p class="xs muted" style="margin-top:0">Tasks evaluated on the ground (Oral) get one task scenario that the applicant works through with real materials. ${nFl ? nFl + ' flight task(s) need no task scenario; the plan lists their skills and the knowledge and risk questions. ' : ''}Change a task between Oral and Flight on Tasks &amp; elements. ${sc.aiDraft ? 'AI drafts need examiner review.' : ''}</p>
          ${editable && can('org_admin', 'examiner') ? `<div class="btn-row" style="margin-bottom:.5rem"><button type="button" class="btn ghost sm" id="aiTm">${done ? 'Draft missing tasks with AI' : 'Draft all task scenarios with AI'}</button>${done ? '<button type="button" class="btn ghost sm" id="aiTa">Redraft all with AI</button>' : ''}</div>` : ''}
          ${areas.map((g) => `<details class="ts-area" ${g.list.some((t) => !(ts[t.key] || '').trim()) || areas.length < 3 ? 'open' : ''}><summary class="sm strong">${esc(g.r)}. ${esc(g.title)} <span class="xs muted" style="font-weight:400">${g.list.filter((t) => (ts[t.key] || '').trim()).length}/${g.list.length}</span></summary>
            ${g.list.map((t) => `<div class="ts-task"><div class="sm"><span class="mono">${esc(t.key)}</span> ${esc(t.task.title_plain || t.task.title)} <span class="xs muted">${esc({ oral: 'Oral', flight: 'Flight', both: 'Oral and flight' }[content.tasks[t.key].method] || '')}</span></div>
              <label class="xs">Task scenario${codeTag((sc.taskCodes || {})[t.key])}<textarea class="tsc" data-k="${esc(t.key)}" ${dis} style="min-height:52px" placeholder="Scenario for this task">${esc(ts[t.key] || '')}</textarea></label>
</div>`).join('')}</details>`).join('')}
          ${editable && done ? '<button type="button" class="btn ghost sm" id="clrT" style="margin-top:.5rem">Remove all task scenarios</button>' : ''}</div>`; })()}
        <div class="card"><div class="card-head"><h2>Planned events (trigger events)</h2><span class="xs muted">${on.size} selected · events are hidden from the applicant packet</span></div>
        ${avail.map((tr) => { const sel = (sc.triggers || []).find((x) => x.id === tr.id); const covers = E.triggerCovers(tr, tasks); return `<div class="trig ${sel ? 'on' : ''}"><div class="trig-head"><input type="checkbox" class="tg" data-id="${tr.id}" ${sel ? 'checked' : ''} ${dis}><span class="phase">${esc(tr.phase)}</span><span class="strong sm" style="flex:1">${esc(tr.name)}</span><span class="xs mono muted">${covers.join(' ')}</span></div><div class="xs" style="margin:.3rem 0 0 1.6rem">${esc(sel && sel.text || tr.text)}</div>${sel ? `<label class="xs" style="margin:.4rem 0 0 1.6rem">Expected applicant response<input class="exp" data-id="${tr.id}" ${dis} value="${esc(sel.expected)}"></label>` : ''}</div>`; }).join('')}
        ${(sc.triggers || []).filter((t) => t.custom).map((t) => `<div class="trig on"><div class="trig-head"><span class="phase">${esc(t.phase)}</span><span class="strong sm" style="flex:1">${esc(t.name)}</span><span class="xs mono muted">${(t.covers || []).join(' ')}</span>${editable ? `<button class="btn ghost sm" data-rm="${t.id}">Remove</button>` : ''}</div><div class="xs" style="margin:.3rem 0 0 0">${esc(t.text)}</div></div>`).join('')}
        ${editable ? '<button class="btn ghost sm" id="addTr">Add a custom event</button>' : ''}</div>`;
      if (!editable) return;
      const bind = (id, k) => { const i = qs('#' + id, el); i.oninput = () => { sc[k] = i.value; save(); }; };
      bind('dep', 'dep'); bind('dest', 'dest'); bind('alt', 'alt'); bind('mission', 'mission'); bind('route', 'route'); bind('pax', 'pax'); bind('wx', 'weather'); bind('cons', 'constraints');
      qs('#mission', el).onchange = () => paneScenario(el);
      const aiPayload = async () => { const st = await A2().orgSettings(); const sp = sc.profile || E.scenarioProfile(st, p.test_profile.cert) || {};
        return { cert: E.CERT_LABEL[p.test_profile.cert], cls: p.test_profile.cls, standard: doc.num, difficulty: sp.difficulty, preference: sp.preference, weather: sp.weather, pilot: sp.pilot, aircraftFactors: sp.aircraftFactors, environment: sp.environment, pressures: sp.pressures, dep: sc.dep, dest: sc.dest, aircraft: ac ? ac.make_model : (content.checkride && content.checkride.aircraft) || '' }; };
      const aiM = qs('#aiM', el); if (aiM) aiM.onclick = async () => {
        if (sc.mission && sc.mission.trim().length > 30 && !(await confirmBox('Replace the scenario?', 'The AI draft replaces the current scenario text.', 'Replace'))) return;
        try { const r = await act(aiM, async () => A2().ai('master_scenario', await aiPayload())); sc.mission = r.text; sc.missionName = sc.missionName || 'Scenario'; sc.aiDraft = true; save(); paneScenario(el); toast('AI draft added. Review before use.'); } catch (_) {}
      };
      const TYPE_L = { K: 'K', R: 'R', S: 'S' };
      const taskList = (onlyMissing) => tasks.filter((t) => content.tasks[t.key] && content.tasks[t.key].included && isOral(t.key) && (!onlyMissing || !((sc.taskScenarios || {})[t.key] || '').trim())).map((t) => {
        const ct = content.tasks[t.key]; const codes = E.elementCodes(doc, t.area, t.task); const sel = new Set(ct.elements || []);
        // Every skill element (the scenario must make the applicant perform them) plus the selected knowledge and risk elements.
        const all = t.task.elements.map((e, i) => ({ e, c: codes[i] })).filter((x) => E.elementApplies(doc, t.task, x.e, p.test_profile.cls));
        let els = all.filter((x) => x.e.type === 'S' || sel.has(x.c)); if (!els.length) els = all;
        els = els.filter((x) => !(x.e.sub == null && all.some((y) => y.e.sub && y.e.type === x.e.type && y.e.num === x.e.num && els.includes(y))));
        els.sort((a, b) => (a.e.type === 'S' ? 0 : 1) - (b.e.type === 'S' ? 0 : 1));
        return { key: t.key, title: t.task.title_plain || t.task.title, method: ct.method || '', elements: els.slice(0, 20).map((x) => (x.e.type || 'O') + ' ' + x.c + ': ' + x.e.text) }; });
      // Draft scenarios for tasks in batches so every included task gets one (oral tasks included).
      const draftTasks = async (list, progress) => {
        sc.taskScenarios = Object.assign({}, sc.taskScenarios || {}); sc.taskSubs = Object.assign({}, sc.taskSubs || {}); let n = 0;
        let fails = 0, lastErr = null;
        for (let i = 0; i < list.length; i += 6) {
          if (!live()) break; const part = list.slice(i, i + 6); if (progress) progress(i, list.length);
          let r = null; for (let a = 0; a < 2 && !r; a++) { try { r = await A2().ai('task_scenarios', { master: sc.mission, tasks: part }); } catch (er) { lastErr = er; } }
          if (!r) { fails++; continue; }
          sc.taskCodes = Object.assign({}, sc.taskCodes || {}); sc.taskSubCodes = Object.assign({}, sc.taskSubCodes || {});
          (r.items || []).forEach((x) => { if (part.some((t) => t.key === x.key)) { sc.taskScenarios[x.key] = x.text; sc.taskCodes[x.key] = x.codes || []; delete sc.taskSubs[x.key]; if (sc.taskSubCodes) delete sc.taskSubCodes[x.key]; n++; } });
          sc.aiDraft = true; save();
        }
        if (!n && lastErr) throw lastErr;
        if (fails) toast(fails + ' batch(es) could not be drafted. Use Draft missing tasks with AI to finish.', true);
        return n;
      };
      const runDraft = async (b, onlyMissing) => {
        if (!sc.mission || sc.mission.trim().length < 30) { toast('Write or draft the main scenario first.', true); return; }
        if (!onlyMissing && !(await confirmBox('Redraft every task scenario?', 'All oral task scenarios are replaced with new AI drafts.', 'Redraft'))) return;
        const list = taskList(onlyMissing); if (!list.length) { toast('Every included task already has a scenario.'); return; }
        const lbl = b.textContent;
        try { const n = await act(b, () => draftTasks(list, (i, tot) => { b.textContent = 'Drafting ' + Math.min(i + 6, tot) + ' of ' + tot + '…'; })); b.textContent = lbl; paneScenario(el); toast(n + ' task scenario(s) drafted. Review before use.'); } catch (_) { b.textContent = lbl; }
      };
      const aiTm = qs('#aiTm', el); if (aiTm) aiTm.onclick = () => runDraft(aiTm, true);
      const aiTa = qs('#aiTa', el); if (aiTa) aiTa.onclick = () => runDraft(aiTa, false);
      qsa('.tsc', el).forEach((t) => t.oninput = () => { sc.taskScenarios = sc.taskScenarios || {}; sc.taskScenarios[t.dataset.k] = t.value; save(); });
      // Every plan gets an AI scenario: the first time the Scenario step opens with no scenario, draft the mission and
      // the task sub-scenarios with Grok. The examiner still reviews and edits before finalizing.
      if (aiM && !AUTO_SCEN.has(p.id) && (!sc.mission || sc.mission.trim().length < 30)) {
        AUTO_SCEN.add(p.id);
        const box = document.createElement('div'); box.className = 'banner info'; box.id = 'aiAuto'; box.textContent = 'Writing a scenario for this plan with AI…'; el.prepend(box);
        (async () => {
          try {
            const r = await A2().ai('master_scenario', await aiPayload()); sc.mission = r.text; sc.missionName = sc.missionName || 'Scenario'; sc.aiDraft = true; save();
            const list = taskList(true);
            if (list.length) await draftTasks(list, (i, tot) => { if (document.body.contains(box)) box.textContent = 'Scenario drafted. Writing task scenarios ' + Math.min(i + 6, tot) + ' of ' + tot + '…'; });
            if (document.body.contains(el) && step === 'scenario') paneScenario(el); toast('AI scenario drafted. Review before use.');
          } catch (er) { if (document.body.contains(box)) { box.className = 'banner warn'; box.textContent = 'AI scenario could not be drafted (' + (er && er.message ? er.message : 'error') + '). Use Draft scenario with AI to try again.'; } }
        })();
      }
      const clrT = qs('#clrT', el); if (clrT) clrT.onclick = async () => { if (!(await confirmBox('Remove all task scenarios?', 'Every task scenario is cleared. The main scenario stays.', 'Remove'))) return; delete sc.taskScenarios; delete sc.taskSubs; delete sc.taskCodes; delete sc.taskSubCodes; save(); paneScenario(el); };
      qs('#tpl', el).onchange = (e) => { const m = missions[+e.target.value]; if (!m) return; sc.missionName = m.name; sc.mission = fill(m.text); save(); paneScenario(el); };
      qsa('.tg', el).forEach((cb) => cb.onchange = () => {
        const tr = E.TRIGGERS.find((x) => x.id === cb.dataset.id);
        if (cb.checked) sc.triggers.push({ id: tr.id, name: tr.name, phase: tr.phase, text: tr.text, covers: E.triggerCovers(tr, tasks), expected: '' });
        else sc.triggers = sc.triggers.filter((x) => x.id !== tr.id);
        save(); paneScenario(el);
      });
      qsa('.exp', el).forEach((i) => i.oninput = () => { const t = sc.triggers.find((x) => x.id === i.dataset.id); if (t) { t.expected = i.value; save(); } });
      qsa('.xc', el).forEach((cb) => cb.onchange = () => { const s = new Set(sc.extraCovered || []); cb.checked ? s.add(cb.dataset.k) : s.delete(cb.dataset.k); sc.extraCovered = Array.from(s); save(); paneScenario(el); });
      qsa('[data-rm]', el).forEach((b) => b.onclick = () => { sc.triggers = sc.triggers.filter((x) => x.id !== b.dataset.rm); save(); paneScenario(el); });
      const at = qs('#addTr', el); if (at) at.onclick = () => modal(`<h2>Custom event</h2><form id="f"><label>Phase<select name="phase">${['Planning', 'Preflight', 'Departure', 'Enroute', 'Maneuvers', 'Instrument', 'Arrival', 'Emergency', 'Postflight'].map((x) => `<option>${x}</option>`).join('')}</select></label><label>Name<input name="name" required></label><label>What happens<textarea name="text" required></textarea></label>
        <label>Tasks evaluated<select name="covers" multiple size="8">${tasks.filter((t) => t.required).map((t) => `<option value="${t.key}">${t.key} ${esc(t.task.title_plain)}</option>`).join('')}</select></label><div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Add</button></div></form>`, (bg, close) => {
        qs('#f', bg).onsubmit = (e) => { e.preventDefault(); const f = e.target; sc.triggers.push({ id: 'c-' + uid().slice(0, 8), custom: true, phase: f.phase.value, name: f.name.value.trim(), text: f.text.value.trim(), covers: Array.from(f.covers.selectedOptions).map((o) => o.value), expected: '' }); save(); close(); paneScenario(el); };
      });
    }

    function paneBriefings(el) {
      const b = content.briefings = content.briefings || {};
      el.innerHTML = `<div class="banner info">Order 8000.95E asks the managing specialist to confirm the plan contains the pretest, preflight and postflight briefings. Start from these defaults and edit them to match how you conduct tests.</div>
        ${[['pretest', 'Pretest briefing'], ['preflight', 'Preflight briefing'], ['postflight', 'Postflight debriefing']].map(([k, l]) => `<div class="card"><div class="card-head"><h2>${l}</h2>${editable ? `<button class="btn ghost sm" data-reset="${k}">Reset to default</button>` : ''}</div><textarea data-k="${k}" ${dis} style="min-height:150px">${esc(b[k])}</textarea></div>`).join('')}`;
      if (!editable) return;
      qsa('textarea[data-k]', el).forEach((t) => t.oninput = () => { b[t.dataset.k] = t.value; save(); });
      qsa('[data-reset]', el).forEach((x) => x.onclick = () => { b[x.dataset.reset] = E.DEFAULT_BRIEFINGS[x.dataset.reset].replace('{std}', doc.num); save(); paneBriefings(el); });
    }

    async function paneQuestions(el) {
      const qsList = content.questions = content.questions || [];
      const isACS = doc.kind === 'ACS';
      const aktr = new Set((content.aktr || []).map((x) => String(x).toUpperCase()));
      // Elements that get questions: the selected knowledge and risk elements (AKTR codes included). Skill elements get no question;
      // they are listed for demonstration. A parent with sub-elements is covered by its subs.
      const rows = []; const skillRefs = new Set();
      tasks.forEach((t) => {
        const ct = content.tasks[t.key]; if (!ct || !ct.included) return;
        const codes = E.elementCodes(doc, t.area, t.task); const pick = new Set(ct.elements || []);
        const list = t.task.elements.map((e, i) => ({ t, e, ref: codes[i] })).filter((x) => E.elementApplies(doc, t.task, x.e, p.test_profile.cls) && (!isACS ? pick.has(x.ref) && x.e.type !== 'S' : (x.e.type === 'K' || x.e.type === 'R') && pick.has(x.ref)));
        t.task.elements.forEach((e, i) => { if (e.type === 'S') skillRefs.add(codes[i]); });
        list.filter((x) => !(x.e.sub == null && list.some((y) => y.e.sub && y.e.type === x.e.type && y.e.num === x.e.num))).forEach((x) => rows.push(Object.assign(x, { aktr: aktr.has(String(x.ref).toUpperCase()) })));
      });
      const scn = content.scenario || {};
      // The scenario text where a skill element is demonstrated: the sub-scenario that lists it, else the task scenario.
      // Skill elements are demonstrated, not questioned: drop any skill-element questions left from older plans.
      const isSkillQ = (x) => x.ref && skillRefs.has(x.ref) && !rows.some((r) => r.ref === x.ref);
      if (editable && qsList.some(isSkillQ)) { const keep = qsList.filter((x) => !isSkillQ(x)); qsList.length = 0; keep.forEach((x) => qsList.push(x)); save(); }
      // Oral tasks: questions are set inside the task scenario.
      const scenOf = (r) => isOral(r.t.key) && (scn.taskScenarios || {})[r.t.key] ? { label: 'Task scenario', text: scn.taskScenarios[r.t.key] } : null;
      const rowOf = new Map(rows.map((r) => [r.ref, r]));
      // Older plans stored questions without a slot number; give the first two on each element slots 1 and 2.
      const seen = {}; qsList.forEach((x) => { if (!x.seq && x.ref && rowOf.has(x.ref)) { seen[x.ref] = (seen[x.ref] || 0) + 1; x.seq = seen[x.ref]; } });
      let bank = [];
      try { const codes = rows.map((r) => r.ref); for (let i = 0; i < codes.length; i += 150) bank = bank.concat(await q(sb.from('questions').select('*').eq('org_id', S.orgId).eq('status', 'approved').eq('standard_id', doc.id).in('element_code', codes.slice(i, i + 150)))); } catch (_) {}
      const bankBy = {}; bank.forEach((b) => (bankBy[b.element_code] = bankBy[b.element_code] || []).push(b));
      content.qCount = content.qCount || {}; const mode = content.qMode || '1';
      const cnt = (ref) => (content.qCount[ref] != null ? content.qCount[ref] : mode === '2' ? 2 : 1);
      const slot = (ref, seq) => qsList.find((x) => x.ref === ref && x.seq === seq);
      const drop = (fn) => { for (let i = qsList.length - 1; i >= 0; i--) if (fn(qsList[i])) qsList.splice(i, 1); };
      const rnd = (a) => a[Math.floor(Math.random() * a.length)];
      // Put a bank question in slot 1. shuffle = choose a different one at random; a follow-up written for the old question is removed.
      const pickBank = (r, shuffle) => {
        if (cnt(r.ref) < 1) return false; const cur = slot(r.ref, 1);
        if (cur && (!shuffle || cur.source === 'manual')) return false;
        const pool = (bankBy[r.ref] || []).filter((b) => !cur || b.id !== cur.bankId); if (!pool.length) return false;
        const b = rnd(pool);
        if (cur) { drop((x) => x === cur || (x.ref === r.ref && x.seq === 2 && x.parent === cur.id && x.source !== 'manual')); }
        qsList.push({ id: uid().slice(0, 8), bankId: b.id, ref: r.ref, task: r.t.key, seq: 1, portion: 'oral', prompt: b.prompt, expected: b.expected, source: 'bank' });
        return true;
      };
      const setCount = (r, n) => { content.qCount[r.ref] = n; drop((x) => x.ref === r.ref && x.seq > n); };
      const applyAll = (m) => { content.qMode = m; rows.forEach((r) => setCount(r, m === 'random' ? (Math.random() < 0.5 ? 1 : 2) : +m)); rows.forEach((r) => pickBank(r, false)); };
      const gapsOf = () => { const g = []; rows.forEach((r) => { const n = cnt(r.ref); const a = slot(r.ref, 1), b = slot(r.ref, 2); if (n >= 1 && !a) g.push({ r, m: n === 2 ? 'pair' : 'single' }); else if (n === 2 && a && !b) g.push({ r, m: 'follow', first: a }); }); return g; };
      const st0 = await A2().orgSettings().catch(() => ({})); const sp = E.scenarioProfile(st0, p.test_profile.cert) || {};
      // Fill every empty slot with Grok, in batches. Returns the number of questions added.
      const aiFill = async (progress) => {
        const want = gapsOf(); let n = 0; const banked = [];
        for (let i = 0; i < want.length; i += 20) {
          if (!live()) break; const part = want.slice(i, i + 20); if (progress) progress(Math.min(i + 20, want.length), want.length);
          let r = null; for (let a = 0; a < 2 && !r; a++) { try { r = await A2().ai('questions', { difficulty: sp.difficulty || '', elements: part.map((g) => ({ code: g.r.ref, task: g.r.t.key, type: g.r.aktr ? 'A' : g.r.e.type, text: g.r.e.text, references: g.r.t.task.references || '', mode: g.m, scenario: scenOf(g.r) ? scenOf(g.r).text : undefined, firstQuestion: g.first ? g.first.prompt : undefined, firstExpected: g.first ? g.first.expected : undefined })) }); } catch (er) { if (a) throw er; } }
          const out = (r && r.items) || [];
          part.forEach((g, k) => {
            const same = (o) => o && !o._u && String(o.code || '').trim().toUpperCase() === String(g.r.ref).toUpperCase();
            const x = (same(out[k]) ? out[k] : null) || out.find((o) => same(o) && (!o.mode || o.mode === g.m)) || (out.length === part.length && out[k] && !out[k]._u ? out[k] : null);
            if (!x || !x.question) return; x._u = true;
            if (g.m === 'follow') { if (!slot(g.r.ref, 2)) { qsList.push({ id: uid().slice(0, 8), ref: g.r.ref, task: g.r.t.key, seq: 2, parent: g.first.id, portion: 'oral', prompt: x.question, expected: x.expected, source: 'ai' }); n++; } return; }
            if (slot(g.r.ref, 1)) return;
            const q1 = { id: uid().slice(0, 8), ref: g.r.ref, task: g.r.t.key, seq: 1, portion: 'oral', prompt: x.question, expected: x.expected, source: 'ai' }; qsList.push(q1); n++; banked.push(q1);
            if (g.m === 'pair' && x.followUp && !slot(g.r.ref, 2)) { qsList.push({ id: uid().slice(0, 8), ref: g.r.ref, task: g.r.t.key, seq: 2, parent: q1.id, portion: 'oral', prompt: x.followUp, expected: x.followUpExpected, source: 'ai' }); n++; }
          });
          save();
        }
        // First questions are kept in the bank as drafts so a reviewer can approve them for reuse.
        if (banked.length) { try { await q(sb.from('questions').insert(banked.map((x) => ({ org_id: S.orgId, standard_id: doc.id, element_code: x.ref, task_ref: x.task, portion: 'oral', prompt: x.prompt, expected: x.expected || null, refs: (tasks.find((t) => t.key === x.task) || { task: {} }).task.references || null, difficulty: 2, status: 'draft', source: 'ai_draft', created_by: S.ctx.user_id })))); } catch (_) {} }
        return n;
      };
      const canAI = editable && can('org_admin', 'examiner');
      if (editable && !content.qPicked && rows.length) { content.qPicked = true; applyAll(content.qMode || '1'); save(); }
      // Older template questions had no expected answer: remove them; selected elements then get a bank question or an AI question and answer.
      const isLegacyQ = (x) => x.source === 'generated' && !(x.expected || '').trim();
      if (editable && qsList.some(isLegacyQ)) { const old = new Set(qsList.filter(isLegacyQ).map((x) => x.id)); drop((x) => old.has(x.id) || (x.parent && old.has(x.parent) && x.source !== 'manual')); rows.forEach((r) => pickBank(r, false)); content.qAiAuto = false; save(); }
      const gaps = gapsOf();
      const autoRun = canAI && gaps.length && !content.qAiAuto;
      const inRows = new Set(); qsList.forEach((x, i) => { if (x.ref && rowOf.has(x.ref) && (x.seq === 1 || x.seq === 2)) inRows.add(i); });
      const others = qsList.map((x, i) => ({ x, i })).filter(({ i }) => !inRows.has(i));
      const total = qsList.length - others.length;
      const TL = { K: 'Knowledge', R: 'Risk', S: 'Skill', O: 'Item' };
      const slotHtml = (r, seq) => {
        const x = slot(r.ref, seq); const lab = seq === 1 ? 'Question' : 'Follow-up';
        const pill = x ? (x.source === 'bank' ? '<span class="pill info">Bank</span>' : x.source === 'ai' ? '<span class="pill warn">AI draft — examiner review</span>' : '') : '';
        if (!editable) return x ? `<div class="q-slot ${seq === 2 ? 'q-fu' : ''}"><div class="xs strong">${lab}</div><div class="sm">${esc(x.prompt)}</div>${x.expected ? `<div class="xs muted"><b>Expected:</b> ${esc(x.expected)}</div>` : ''}</div>` : '';
        return `<div class="q-slot ${seq === 2 ? 'q-fu' : ''}"><div class="xs strong">${lab} ${pill}</div><textarea class="qp" data-ref="${esc(r.ref)}" data-seq="${seq}" style="min-height:44px;margin:.15rem 0 0" placeholder="${x ? '' : 'Missing. Type a question, or use Write missing with AI.'}">${esc(x ? x.prompt : '')}</textarea>
          <label class="xs muted" style="margin:.2rem 0 0">Expected answer<textarea class="qe" data-ref="${esc(r.ref)}" data-seq="${seq}" style="min-height:40px;margin:.15rem 0 0">${esc(x ? x.expected || '' : '')}</textarea></label></div>`;
      };
      let lastTask = '';
      const body = rows.map((r) => {
        const n = cnt(r.ref); const head = r.t.key !== lastTask ? `<tr class="q-task"><td colspan="3" class="sm strong"><span class="mono">${esc(r.t.key)}</span> ${esc(r.t.task.title_plain || r.t.task.title)}</td></tr>` : ''; lastTask = r.t.key;
        return `${head}<tr><td class="mono xs" style="width:8.5rem">${esc(r.ref)}<div><span class="pill ${r.e.type === 'R' ? 'warn' : 'info'}">${esc(TL[r.e.type] || r.e.type || '')}</span>${r.aktr ? ' <span class="pill bad" title="Missed on the knowledge test">AKTR</span>' : ''}</div></td>
          <td><div class="sm" style="margin-bottom:.3rem">${esc(r.e.text)}</div>${n ? [1, 2].filter((s2) => s2 <= n).map((s2) => slotHtml(r, s2)).join('') : '<div class="xs muted">Not questioned on this plan.</div>'}</td>
          <td style="width:7.5rem">${editable ? `<select class="qn" data-ref="${esc(r.ref)}" aria-label="Questions for ${esc(r.ref)}" style="margin:0">${[0, 1, 2].map((v) => `<option value="${v}" ${n === v ? 'selected' : ''}>${v}</option>`).join('')}</select>${(bankBy[r.ref] || []).length > (slot(r.ref, 1) && slot(r.ref, 1).bankId ? 1 : 0) && n ? `<button type="button" class="btn ghost sm qr" data-ref="${esc(r.ref)}" style="margin-top:.3rem">Random</button>` : ''}` : n}</td></tr>`;
      }).join('');
      el.innerHTML = `<div class="banner info">Every knowledge and risk element marked for testing gets its own question and expected answer, including AKTR codes. Skill elements are not questioned; they are listed on the plan for the applicant to demonstrate. Choose 1 or 2 per element (the second goes one step deeper on the first), or set any element to 0. Approved bank questions are picked at random first; AI writes what the bank is missing.</div>
        ${autoRun ? '<div class="banner warn" id="qAuto">Writing missing questions with AI…</div>' : gaps.length ? `<div class="banner warn">${gaps.length} element(s) still need a question or follow-up.</div>` : rows.length ? '<div class="banner ok">Every selected element has its questions.</div>' : '<div class="banner warn">No elements are selected. Select them on Tasks and elements.</div>'}
        ${editable ? `<div class="btn-row" style="margin-bottom:.8rem;align-items:flex-end;flex-wrap:wrap"><label class="xs" style="margin:0">Questions per element<select id="qMode" style="margin:.15rem 0 0;min-width:13rem"><option value="1" ${mode === '1' ? 'selected' : ''}>1</option><option value="2" ${mode === '2' ? 'selected' : ''}>2 (question and follow-up)</option><option value="random" ${mode === 'random' ? 'selected' : ''}>Random (1 or 2)</option></select></label>
          <button class="btn" id="qApply">Apply to all</button><button class="btn ghost" id="qShuffle">Random pick from bank</button>${canAI && gaps.length && !autoRun ? `<button class="btn ghost" id="aiQ">Write ${gaps.length} missing with AI</button>` : ''}${qsList.length ? '<button class="btn danger sm" id="clr">Clear all</button>' : ''}</div>` : ''}
        <p class="sm muted">${rows.length} element(s) · ${total} question(s)${others.length ? ' · ' + others.length + ' other' : ''}</p>
        <div class="card flush"><div class="table-wrap"><table class="t q-table"><thead><tr><th>Element</th><th>Question and expected answer</th><th>Count</th></tr></thead><tbody>${body || '<tr><td colspan="3"><div class="empty">No elements selected.</div></td></tr>'}</tbody></table></div></div>
        <div class="card"><div class="card-head"><h2>Other questions</h2>${editable ? '<button class="btn ghost sm" id="addQ">Add a question</button>' : ''}</div>
          ${others.length ? others.map(({ x, i }) => `<div class="q-slot"><div class="xs muted mono">${esc([x.task, x.ref].filter(Boolean).join(' · ') || 'General')}</div>${editable ? `<textarea class="qop" data-i="${i}" style="min-height:44px;margin:.15rem 0 0">${esc(x.prompt)}</textarea><label class="xs muted" style="margin:.2rem 0 0">Expected answer<textarea class="qoe" data-i="${i}" style="min-height:40px;margin:.15rem 0 0">${esc(x.expected || '')}</textarea></label><button class="btn ghost sm" data-del="${i}">Remove</button>` : `<div class="sm">${esc(x.prompt)}</div>${x.expected ? `<div class="xs muted">Expected: ${esc(x.expected)}</div>` : ''}`}</div>`).join('') : '<p class="xs muted">Questions not tied to a selected element, such as general or carried-over questions, appear here.</p>'}</div>`;
      if (!editable) return;
      const rerender = () => { if (el.isConnected) paneQuestions(el); };
      const runAI = async (b) => {
        const box = qs('#qAuto', el); const lbl = b ? b.textContent : '';
        try {
          const go = () => aiFill((i, tot) => { const t = 'Writing questions with AI ' + i + ' of ' + tot + '…'; if (b) b.textContent = t; const bx = qs('#qAuto', el); if (bx) bx.textContent = t; });
          const n = b ? await act(b, go) : await go(); toast(n + ' AI question(s) added. Review before use.');
        } catch (_) { if (!b) toast('AI questions could not be written. Use Write missing with AI to try again.', true); }
        if (b) b.textContent = lbl; if (box || b) rerender();
      };
      if (autoRun) { content.qAiAuto = true; save(); runAI(null); }
      const mSel = qs('#qMode', el); if (mSel) mSel.onchange = () => { content.qMode = mSel.value; save(); };
      qs('#qApply', el).onclick = async () => {
        const m = mSel.value; const label = m === 'random' ? 'a random 1 or 2' : m;
        if (!(await confirmBox('Apply to every element?', 'Each selected element is set to ' + label + ' question(s). Existing questions in kept slots stay; extra ones are removed.', 'Apply'))) return;
        applyAll(m); save(); rerender();
      };
      qs('#qShuffle', el).onclick = async () => {
        if (qsList.some((x) => x.source !== 'manual' && x.seq) && !(await confirmBox('Pick new bank questions?', 'Each element gets a different approved bank question at random where the bank has one. Follow-ups written for replaced questions are removed so new ones can be written. Questions you typed stay.', 'Pick'))) return;
        let n = 0; rows.forEach((r) => { if (pickBank(r, true)) n++; }); save(); rerender(); toast(n + ' question(s) picked at random');
      };
      const aiQ = qs('#aiQ', el); if (aiQ) aiQ.onclick = () => runAI(aiQ);
      qsa('.qn', el).forEach((s2) => s2.onchange = () => { const r = rowOf.get(s2.dataset.ref); setCount(r, +s2.value); pickBank(r, false); save(); rerender(); });
      qsa('.qr', el).forEach((b) => b.onclick = () => { const r = rowOf.get(b.dataset.ref); if (pickBank(r, true)) { save(); rerender(); } else toast('No other bank question for this element.'); });
      const edit = (t, field) => t.oninput = () => {
        const ref = t.dataset.ref, seq = +t.dataset.seq; let x = slot(ref, seq);
        if (!x) { const r = rowOf.get(ref); x = { id: uid().slice(0, 8), ref, task: r.t.key, seq, portion: 'oral', prompt: '', expected: '', source: 'manual' }; if (seq === 2 && slot(ref, 1)) x.parent = slot(ref, 1).id; qsList.push(x); }
        x[field] = t.value; if (field === 'prompt' && !t.value.trim() && !(x.expected || '').trim()) qsList.splice(qsList.indexOf(x), 1); save();
      };
      qsa('.qp', el).forEach((t) => edit(t, 'prompt')); qsa('.qe', el).forEach((t) => edit(t, 'expected'));
      qsa('.qop', el).forEach((t) => t.oninput = () => { qsList[+t.dataset.i].prompt = t.value; save(); });
      qsa('.qoe', el).forEach((t) => t.oninput = () => { qsList[+t.dataset.i].expected = t.value; save(); });
      qsa('[data-del]', el).forEach((b) => b.onclick = () => { qsList.splice(+b.dataset.del, 1); save(); rerender(); });
      const aq = qs('#addQ', el); if (aq) aq.onclick = () => { qsList.push({ id: uid().slice(0, 8), ref: '', portion: 'oral', prompt: 'New question', source: 'manual' }); save(); rerender(); };
      const cl = qs('#clr', el); if (cl) cl.onclick = async () => { if (await confirmBox('Clear all questions?', 'All questions in this plan will be removed.', 'Clear')) { content.questions = []; save(); rerender(); } };
    }

    function paneReview(el) {
      const eg = content.eligibility = content.eligibility || {};
      const at = content.attest = content.attest || {};
      const cc = comp();
      const isType = p.purpose === 'type_rating' || p.test_profile.typeDesignator;
      const items = [['identity', 'Applicant identity verified (government photo ID)'], ['iacra', 'IACRA application complete and signed by the recommending instructor'], ['knowledge', 'Knowledge test report valid and presented (or not required)'], ['endorsements', 'Required endorsements present (61.39 / 61.103-type eligibility)'], ['experience', 'Aeronautical experience meets the requirements for the certificate or rating'], ['medical', 'Medical certificate or medical eligibility appropriate'], ['aircraft', 'Aircraft and equipment suitable for the tasks (61.45); airworthiness documents reviewed']];
      if (isType) items.push(['fig588', 'Type certificate holder listed in N 8900.610 Figure 5-88']);
      const regs = S.regs.quotes;
      el.innerHTML = `<div class="grid2"><div class="card"><h2>Eligibility (examiner confirms)</h2>${items.map(([k, l]) => `<label class="check sm"><input type="checkbox" data-e="${k}" ${eg[k] ? 'checked' : ''} ${dis}><span>${esc(l)}</span></label>`).join('')}
        ${isType ? `<label class="sm">Crew complement for the test<select data-crew ${dis}><option value="">Select…</option>${['Single pilot', 'Pilot and copilot (SIC Required limitation applies)'].map((x) => `<option ${eg.crew === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>` : ''}
        ${(() => { const br = A2().briefReqFor(p.test_profile.cert, testTypeOf(p)); return br ? `<details style="margin-top:.6rem"><summary class="sm strong" style="cursor:pointer">Endorsements and experience to check (${esc(br.grade_label)} — ${esc(br.test_type)})</summary>${br.endorsements.length ? `<h3>Endorsements</h3><ul class="sm">${br.endorsements.map((x) => `<li>${esc(x.replace(/^- /, ''))}</li>`).join('')}</ul>` : ''}${br.experience.length ? `<h3>Aeronautical experience</h3><ul class="sm">${br.experience.map((x) => `<li${/^- /.test(x) ? ' style="margin-left:1rem;list-style:circle"' : ''}>${esc(x.replace(/^- /, ''))}</li>`).join('')}</ul>` : ''}<p class="xs muted">Examiner checklist from the JPJ plan of action. 14 CFR part 61 governs.</p></details>` : ''; })()}
        ${doc.kind === 'PTS' ? `<label class="check sm"><input type="checkbox" data-a="special_emphasis" ${at.special_emphasis ? 'checked' : ''} ${dis}><span>Special emphasis items in ${esc(doc.num)} will be evaluated throughout the test</span></label>` : ''}</div>
        <div class="card"><h2>Summary</h2><div class="kpis small" style="grid-template-columns:repeat(2,1fr)"><div class="kpi"><div class="kpi-label">Met</div><div class="kpi-value" style="color:var(--ok)">${cc.counts.met || 0}</div></div><div class="kpi"><div class="kpi-label">Examiner attested</div><div class="kpi-value" style="color:var(--info)">${cc.counts.attested || 0}</div></div><div class="kpi"><div class="kpi-label">To review</div><div class="kpi-value" style="color:var(--warn)">${cc.counts.review || 0}</div></div><div class="kpi"><div class="kpi-label">Gaps</div><div class="kpi-value" style="color:var(--bad)">${cc.counts.gap || 0}</div></div></div>
        <p class="xs muted">Gaps must be resolved before finalizing. Review items are allowed but appear on the proof form.</p><a class="btn ghost sm" href="#/print/proof/${p.id}">Open proof of compliance</a></div></div>
        ${apxCard()}
        <div class="card"><h2>Compliance checks</h2>${cc.rows.map((r) => { const qt = r.quoteKey ? regs[r.quoteKey] : null; return `<div class="comp-row"><div>${{ met: '<span class="pill ok">Met</span>', gap: '<span class="pill bad">Gap</span>', review: '<span class="pill warn">Review</span>', attested: '<span class="pill info">Attested</span>' }[r.status]}</div><div><div class="sm strong">${esc(qt ? qt.src : r.cite)}</div>${qt ? `<div class="quote">“${esc(qt.text)}”${qt.paraphrase ? ' <span class="xs muted">(summary)</span>' : ''}</div>` : ''}<div class="sm">${esc(r.evidence)}</div></div></div>`; }).join('')}</div>`;
      if (!editable) return;
      qsa('[data-e]', el).forEach((cb) => cb.onchange = () => { eg[cb.dataset.e] = cb.checked; save(); paneReview(el); render2(); });
      qsa('[data-a]', el).forEach((cb) => cb.onchange = () => { at[cb.dataset.a] = cb.checked; save(); paneReview(el); render2(); });
      const cr = qs('[data-crew]', el); if (cr) cr.onchange = () => { eg.crew = cr.value; save(); paneReview(el); render2(); };
      const ap = content.appendix = content.appendix || {}; ap.flags = ap.flags || {}; ap.ack = ap.ack || {};
      qsa('[data-apf]', el).forEach((cb) => cb.onchange = () => { ap.flags[cb.dataset.apf] = cb.checked; save(); paneReview(el); render2(); });
      ap.note = ap.note || {};
      qsa('[data-apn]', el).forEach((ta) => ta.oninput = () => { const v = ta.value; if (v.trim()) ap.note[ta.dataset.apn] = v; else delete ap.note[ta.dataset.apn]; save(); });
      qsa('[data-apk]', el).forEach((cb) => cb.onchange = () => { if (cb.checked) ap.ack[cb.dataset.apk] = true; else delete ap.ack[cb.dataset.apk]; save(); paneReview(el); render2(); });
      const aa = qs('#apAll', el); if (aa) aa.onclick = () => { E.appendixFor(doc, { profile: p.test_profile, content, tasks }).items.forEach((it) => { ap.ack[it.id] = true; }); save(); paneReview(el); render2(); };
    }
    function apxCard() {
      if (!(doc.appendix_items || []).length) return '';
      const ax = E.appendixFor(doc, { profile: p.test_profile, content, tasks });
      const groups = {}; ax.items.forEach((it) => { (groups[it.group] = groups[it.group] || []).push(it); });
      const done = ax.items.filter((it) => ax.ack[it.id]).length;
      const tog = ax.flags.map((f) => `<label class="check sm"><input type="checkbox" data-apf="${f}" ${ax.values[f] ? 'checked' : ''} ${dis}><span>${esc(E.AP_FLAGS[f])}${ax.auto[f] ? ' <span class="pill">auto</span>' : ''}</span></label>`).join('');
      const list = Object.keys(groups).map((g) => `<h3 class="sm strong" style="margin:.7rem 0 .3rem">${esc(g)}</h3>` + groups[g].map((it) => {
        const t = it.text || ''; const lbl = it.kind === 'list' || (it.when || {}).kind === 'list' ? 'Applicant checklist: ' : '';
        return `<div class="apx-item"><label class="check sm"><input type="checkbox" data-apk="${esc(it.id)}" ${ax.ack[it.id] ? 'checked' : ''} ${dis}><span><strong>${esc(lbl + it.head)}</strong>${it.tasks ? ' <span class="pill">' + esc(it.tasks.join(', ')) + '</span>' : ''}</span></label>
          ${it.tasks ? `<label class="xs apx-note">How this will be met (printed with task ${esc(it.tasks.join(', '))})<textarea data-apn="${esc(it.id)}" ${dis} style="min-height:44px" placeholder="For example: applicant flies the RNAV (GPS) 10 at KVRB and the VOR 22 at KFPR">${esc(((content.appendix || {}).note || {})[it.id] || '')}</textarea></label>` : ''}
          ${t && t !== it.head ? `<details class="apx-text"><summary class="xs muted">${esc(t.length > 140 ? t.slice(0, 140).replace(/\s+\S*$/, '') + '…' : t)}</summary><p class="xs">${esc(t)}</p><p class="xs muted">${esc(doc.num)}, ${esc(g)}</p></details>` : ''}</div>`;
      }).join('')).join('');
      return `<div class="card apx-card"><h2>Appendix requirements (${esc(doc.num)})</h2>
        <p class="xs muted">Requirements from the standard's appendices that apply to this applicant, class and the tasks in the plan. Check each one once you have addressed it. Text is quoted from ${esc(doc.num)}; confirm against the current FAA publication.</p>
        ${tog ? `<details ${Object.keys(ax.values).some((k) => ax.values[k] && !ax.auto[k]) ? 'open' : ''}><summary class="sm strong" style="cursor:pointer">Test conditions (${ax.flags.filter((f) => ax.values[f]).length} of ${ax.flags.length} apply)</summary>${tog}</details>` : ''}
        <div class="sm" style="margin:.5rem 0">${done} of ${ax.items.length} confirmed ${editable && done < ax.items.length ? '<button class="btn ghost sm" id="apAll" type="button">Confirm all</button>' : ''}</div>
        ${list || '<p class="sm muted">No appendix requirements apply with the current conditions.</p>'}</div>`;
    }
    function render2() { const cc = comp(); const s = qs('.sticky-actions .sm'); if (s) s.innerHTML = (cc.ready ? '<span class="pill ok">No compliance gaps</span>' : `<span class="pill bad">${cc.counts.gap || 0} gap(s)</span>`) + ` <span class="pill warn">${cc.counts.review || 0} to review</span>`; }
    render();
  }

  // expose for other modules
  Object.assign(window.SPOA, { ktEditor, fetchAll, esc, qs, qsa, fmtDate, fmtDT, today, uid, rpc, q, act, busy, toast, friendly, go, org, roles, can, isOwner, shell, head, modal, confirmBox, loadStd, loadDocsDb, stdDoc, bindRows, statusPill, outcomePill, renderDocs, uploadDoc, ROLE_LABEL, ROLE_DESC, noOrg, AKTR_RE, aktrList, route });

  // ---------- router ----------
  const ROUTES = [];
  window.SPOA.addRoute = (re, fn, opts) => ROUTES.push({ re, fn, opts: opts || {} });
  async function route() {
    const h = location.hash || '#/home';
    const [path, qstr] = h.slice(1).split('?');
    const params = new URLSearchParams(qstr || '');
    let m;
    if ((m = path.match(/^\/invite\/([a-f0-9]{48})$/))) return viewInvite(m[1]);
    if (path === '/login') { const { data: { session } } = await sb.auth.getSession(); if (!session) return viewLogin(); }
    try {
      if (!(await ensureAuth())) return;
      if (!S.std) loadStd();
      if (!S.docsDb) loadDocsDb();
      const table = [
        [/^\/(home|login)?$/, () => viewHome()], [/^\/applicants$/, () => viewApplicants()], [/^\/applicant\/([\w-]+)$/, (x) => viewApplicant(x[1], params)], [/^\/aircraft$/, () => viewAircraft()],
        [/^\/poas$/, () => viewPoas()], [/^\/poa\/new$/, () => viewPoaNew(params)], [/^\/poa\/([\w-]+)$/, (x) => viewPoa(x[1], params)],
      ];
      for (const [re, fn] of table) { if ((m = path.match(re))) return await fn(m); }
      for (const r of ROUTES) { if ((m = path.match(r.re))) return await r.fn(m, params); }
      go('#/home');
    } catch (e) {
      console.error(e);
      const c = qs('#content') || $app;
      c.innerHTML = `<div class="banner bad">${esc(friendly(e))}</div><a class="btn ghost" href="#/home">Back to dashboard</a>`;
    }
  }
  window.SPOA.route = route;
  window.addEventListener('hashchange', route);
  window.addEventListener('DOMContentLoaded', () => setTimeout(route, 0));
})();

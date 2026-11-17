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
    hist: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  };
  const icon = (k) => `<svg viewBox="0 0 24 24">${I[k] || ''}</svg>`;

  async function loadStd() {
    if (S.std) return S.std;
    const [a, b] = await Promise.all([fetch('data/standards.json?v=' + C.version).then((r) => r.json()), fetch('data/regs.json?v=' + C.version).then((r) => r.json())]);
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
    const link = (n) => `<a class="nav-item ${active === n[0] || (active === 'orgsettings' && n[0] === 'org-settings') ? 'active' : ''}" href="#/${n[0]}">${icon(n[2])}<span>${n[1]}</span>${n[0] === 'data-review' ? '<span class="nav-badge" id="flagBadge" hidden></span>' : ''}</a>`;
    const orgs = S.ctx.orgs || [];
    $app.innerHTML = `<div class="layout"><aside class="sidebar" id="side">${brand('Flite Line Technologies')}
      ${orgs.length ? `<label class="org-switch">Organization<select id="orgSel">${orgs.map((x) => `<option value="${x.id}" ${x.id === S.orgId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
      <nav class="nav">${nav.map(link).join('')}<div class="nav-sec">Administration</div>${admin.map(link).join('')}</nav>
      <div class="side-foot">${o ? esc(roles().map((r) => ROLE_LABEL[r]).join(' · ')) + '<br>' : ''}<a href="#" id="signout">Sign out</a> · v${esc(C.version)}</div></aside>
      <div class="main"><div class="topbar"><button class="menu-btn" id="menuBtn" aria-label="Menu">☰</button><span class="sm strong">${esc(o ? o.name : 'smartPOA')}</span><span class="who">${esc((S.ctx.profile && (S.ctx.profile.full_name || S.ctx.profile.email)) || '')}</span></div>
      <div class="content" id="content">${inner || '<div class="loading">Loading…</div>'}</div></div></div>`;
    const sel = qs('#orgSel'); if (sel) sel.onchange = () => { S.orgId = sel.value; localStorage.setItem('spoa_org', S.orgId); go('#/home'); };
    qs('#signout').onclick = (e) => { e.preventDefault(); signOut(); };
    qs('#menuBtn').onclick = () => qs('#side').classList.toggle('open');
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
    const rows = await q(sb.from('applicants').select('*').eq('org_id', S.orgId).order('last_name'));
    const canEdit = can('org_admin', 'examiner', 'office');
    c.innerHTML = head('Applicants', 'Applicant records for testing and record keeping. Protected by organization access controls and MFA.', canEdit ? '<button class="btn" id="add">Add applicant</button>' : '') +
      `<div class="card"><input id="srch" placeholder="Search name, email, school or instructor" style="margin:0 0 .6rem"><label class="check sm"><input type="checkbox" id="arch"> Show archived</label>
      <div class="table-wrap"><table class="t" id="tb"><thead><tr><th>Name</th><th>Seeking / held</th><th>Instructor</th><th>Knowledge test</th><th>Added</th></tr></thead><tbody></tbody></table></div></div>`;
    const render = () => {
      const s = qs('#srch', c).value.toLowerCase(); const ar = qs('#arch', c).checked;
      const list = rows.filter((r) => (ar || !r.archived) && (!s || [r.first_name, r.last_name, r.email, r.school, r.recommending_instructor].join(' ').toLowerCase().includes(s)));
      qs('#tb tbody').innerHTML = list.length ? list.map((r) => `<tr class="click" data-h="#/applicant/${r.id}"><td><span class="strong">${esc(r.last_name)}, ${esc(r.first_name)}</span>${r.archived ? ' <span class="pill">Archived</span>' : ''}<div class="xs muted">${esc(r.email || '')}</div></td><td class="sm">${esc(r.cert_held || '—')}</td><td class="sm">${esc(r.recommending_instructor || '—')}<div class="xs muted">${esc(r.school || '')}</div></td><td class="sm">${r.knowledge_test && r.knowledge_test.date ? fmtDate(r.knowledge_test.date) + (r.knowledge_test.score ? ' · ' + esc(r.knowledge_test.score) + '%' : '') : '—'}${(r.knowledge_test && r.knowledge_test.aktr || []).length ? `<div class="xs muted">${r.knowledge_test.aktr.length} AKTR code(s)</div>` : ''}</td><td class="sm muted">${fmtDate(r.created_at)}</td></tr>`).join('') : `<tr><td colspan="5"><div class="empty"><span class="strong">No applicants found</span>${canEdit ? 'Add one with the button above.' : ''}</div></td></tr>`;
      bindRows(qs('#tb', c));
    };
    qs('#srch', c).oninput = render; qs('#arch', c).onchange = render; render();
    if (qs('#add', c)) qs('#add', c).onclick = () => applicantForm(null, (id) => go('#/applicant/' + id));
  }
  function applicantForm(a, done) {
    a = a || { knowledge_test: {} }; const kt = a.knowledge_test || {};
    modal(`<h2>${a.id ? 'Edit applicant' : 'Add applicant'}</h2><div id="err"></div><form id="f">
      <div class="form-grid"><label>First name<input name="first_name" required value="${esc(a.first_name)}"></label><label>Last name<input name="last_name" required value="${esc(a.last_name)}"></label>
      <label>Email<input name="email" type="email" value="${esc(a.email)}"></label><label>Phone<input name="phone" value="${esc(a.phone)}"></label>
      <label>FAA Tracking Number (FTN)<input name="ftn" value="${esc(a.ftn)}" maxlength="12"></label><label>IACRA application ID<input name="iacra_app_id" value="${esc(a.iacra_app_id)}"></label>
      <label>Certificate / ratings held<input name="cert_held" placeholder="e.g. Private ASEL" value="${esc(a.cert_held)}"></label><label>Certificate number (last 4 only)<input name="cert_number_last4" maxlength="4" value="${esc(a.cert_number_last4)}"></label>
      <label>Medical class<select name="medical_class">${['', 'First', 'Second', 'Third', 'BasicMed', 'Not required'].map((x) => `<option ${a.medical_class === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label>Medical date<input name="medical_date" type="date" value="${esc(a.medical_date)}"></label>
      <label>Recommending instructor<input name="recommending_instructor" value="${esc(a.recommending_instructor)}"></label><label>Instructor certificate number<input name="instructor_cert_number" maxlength="20" value="${esc(a.instructor_cert_number)}"></label>
      <label class="full">School / flight department<input name="school" value="${esc(a.school)}"></label>
      <div class="full"><h3>Knowledge test</h3></div>
      <label>Test<input name="kt_test" placeholder="e.g. PAR" value="${esc(kt.test)}"></label><label>Date taken<input name="kt_date" type="date" value="${esc(kt.date)}"></label>
      <label>Score (%)<input name="kt_score" inputmode="numeric" value="${esc(kt.score)}"></label><label>Report valid until<input name="kt_expires" type="date" value="${esc(kt.expires)}"></label>
      <label class="full">AKTR deficiency codes<textarea name="kt_aktr" placeholder="e.g. PA.I.C.K2, PA.IX.A.K1" style="min-height:60px">${esc((kt.aktr || []).join(', '))}</textarea><span class="xs muted">Copy the ACS codes listed on the Airman Knowledge Test Report. These are added to the plan of action automatically.</span></label>
      <label class="full">Notes<textarea name="notes" style="min-height:60px">${esc(a.notes)}</textarea></label></div>
      <p class="xs muted">Store only what you need. Full certificate numbers, dates of birth and ID numbers are intentionally not collected; IACRA remains the system of record.</p>
      <div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">Save</button></div></form>`,
    (bg, close) => {
      qs('#f', bg).addEventListener('submit', async (e) => {
        e.preventDefault(); const f = e.target; const codes = aktrList(f.kt_aktr.value);
        const bad = codes.filter((x) => !AKTR_RE.test(x));
        if (bad.length) { qs('#err', bg).innerHTML = `<div class="err">These do not look like ACS codes: ${esc(bad.join(', '))}</div>`; return; }
        const row = { first_name: f.first_name.value.trim(), last_name: f.last_name.value.trim(), email: f.email.value.trim() || null, phone: f.phone.value.trim() || null, ftn: f.ftn.value.trim() || null,
          iacra_app_id: f.iacra_app_id.value.trim() || null, cert_held: f.cert_held.value.trim() || null, cert_number_last4: f.cert_number_last4.value.trim() || null, medical_class: f.medical_class.value || null,
          medical_date: f.medical_date.value || null, recommending_instructor: f.recommending_instructor.value.trim() || null, instructor_cert_number: f.instructor_cert_number.value.trim() || null, school: f.school.value.trim() || null, notes: f.notes.value.trim() || null,
          knowledge_test: { test: f.kt_test.value.trim(), date: f.kt_date.value, score: f.kt_score.value.trim(), expires: f.kt_expires.value, aktr: codes } };
        const b = qs('button[type=submit]', f);
        try {
          const r = await act(b, async () => a.id ? q(sb.from('applicants').update(row).eq('id', a.id).select().single()) : q(sb.from('applicants').insert(Object.assign(row, { org_id: S.orgId, created_by: S.ctx.user_id })).select().single()), 'Saved');
          close(); done && done(r.id);
        } catch (_) {}
      });
    });
  }
  async function viewApplicant(id) {
    const c = shell('applicants');
    const a = await q(sb.from('applicants').select('*').eq('id', id).single());
    const showPoa = can('org_admin', 'examiner', 'auditor');
    const [poas, docs, dbs, crs] = await Promise.all([
      showPoa ? q(sb.from('poas').select('id,title,status,purpose,test_date,version').eq('applicant_id', id).order('created_at', { ascending: false })) : [],
      q(sb.from('documents').select('*').eq('applicant_id', id).order('uploaded_at', { ascending: false })),
      showPoa ? q(sb.from('debriefs').select('id,poa_id,outcome,status,test_date,unsat_codes').eq('applicant_id', id).order('created_at', { ascending: false })) : [],
      q(sb.from('checkrides').select('*').eq('applicant_id', id).order('scheduled_at', { ascending: false })),
    ]);
    const aflags = await A2().flagsFor(id);
    const kt = a.knowledge_test || {};
    const canEdit = can('org_admin', 'examiner', 'office');
    c.innerHTML = head(esc(a.first_name + ' ' + a.last_name), esc([a.cert_held, a.school].filter(Boolean).join(' · ')) || 'Applicant record',
      A2().flagButton('applicant', a.id) + (canEdit ? '<button class="btn ghost" id="edit">Edit</button>' : '') + (can('org_admin', 'examiner') ? `<a class="btn" href="#/poa/new?applicant=${a.id}">New plan of action</a>` : '')) +
      `${aflags.length ? `<div class="banner warn"><b>Flagged in Data Review:</b> ${aflags.map((x) => esc(x.title)).join('; ')}. <a href="#/data-review">Review</a></div>` : ''}<div class="grid2"><div class="card"><h2>Record</h2><table class="t">
        ${[['Email', a.email], ['Phone', a.phone], ['FTN', a.ftn], ['IACRA application', a.iacra_app_id], ['Held', a.cert_held], ['Certificate no. (last 4)', a.cert_number_last4], ['Medical', [a.medical_class, fmtDate(a.medical_date)].filter(Boolean).join(' · ')], ['Recommending instructor', a.recommending_instructor], ['Instructor certificate no.', a.instructor_cert_number], ['School', a.school]].map(([k, v]) => `<tr><td class="sm muted" style="width:40%">${k}</td><td class="sm">${esc(v || '—')}</td></tr>`).join('')}
        </table>${a.notes ? `<p class="sm">${esc(a.notes)}</p>` : ''}</div>
        <div class="card"><h2>Knowledge test</h2><table class="t">${[['Test', kt.test], ['Date', fmtDate(kt.date)], ['Score', kt.score ? kt.score + '%' : ''], ['Valid until', fmtDate(kt.expires)]].map(([k, v]) => `<tr><td class="sm muted" style="width:40%">${k}</td><td class="sm">${esc(v || '—')}</td></tr>`).join('')}</table>
        <h3>AKTR deficiency codes</h3>${(kt.aktr || []).length ? `<div class="chips">${kt.aktr.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : '<p class="sm muted">None recorded.</p>'}
        ${kt.expires && kt.expires < today() ? '<div class="banner bad" style="margin-top:.8rem">The knowledge test report has expired.</div>' : ''}</div></div>
      ${showPoa ? `<div class="card"><div class="card-head"><h2>Plans of action</h2></div>${poas.length ? `<table class="t"><thead><tr><th>Plan</th><th>Status</th><th>Test date</th></tr></thead>${poas.map((p) => `<tr class="click" data-h="#/poa/${p.id}"><td>${esc(p.title)} <span class="xs muted">v${p.version}</span></td><td>${statusPill(p.status)}</td><td class="sm">${fmtDate(p.test_date)}</td></tr>`).join('')}</table>` : '<div class="empty sm">No plans yet.</div>'}</div>
      <div class="card"><h2>Results</h2>${dbs.length ? `<table class="t"><thead><tr><th>Date</th><th>Outcome</th><th>Unsatisfactory ACS codes</th></tr></thead>${dbs.map((d) => `<tr class="click" data-h="#/debrief/${d.poa_id}"><td class="sm">${fmtDate(d.test_date)}</td><td>${outcomePill(d.outcome, d.status)}</td><td class="sm mono">${esc((d.unsat_codes || []).join(', ') || '—')}</td></tr>`).join('')}</table>` : '<div class="empty sm">No results recorded.</div>'}</div>` : ''}
      <div class="card"><div class="card-head"><h2>Checkrides</h2>${canEdit ? `<a class="btn sm ghost" href="#/schedule?all=1&new=1&applicant=${a.id}">Schedule checkride</a>` : ''}</div>${crs.length ? `<table class="t"><thead><tr><th>Date</th><th>Test</th><th>Result</th><th>Ground / flight</th></tr></thead>${crs.map((r) => `<tr class="click" data-h="#/schedule?all=1&open=${r.id}"><td class="sm">${esc(fmtDT(r.scheduled_at) || '—')}</td><td class="sm">${esc(r.test_type)}<div class="xs muted">${esc([(window.SPOA.CR.GRADES[r.grade_sought] || ''), r.class, r.departure_airport].filter(Boolean).join(' · '))}</div></td><td>${window.SPOA.CR.resultPill(r.result)}</td><td class="sm">${r.ground_time != null ? (+r.ground_time).toFixed(1) : '—'} / ${r.flight_time != null ? (+r.flight_time).toFixed(1) : '—'}</td></tr>`).join('')}</table>` : '<div class="empty sm">No checkride records.</div>'}</div>
      <div class="card"><div class="card-head"><h2>Documents</h2>${canEdit ? '<button class="btn sm" id="up">Upload</button>' : ''}</div><div id="docs"></div></div>`;
    bindRows(c); A2().bindFlagButtons(c);
    renderDocs(qs('#docs', c), docs);
    if (qs('#edit', c)) qs('#edit', c).onclick = () => applicantForm(a, () => route());
    if (qs('#up', c)) qs('#up', c).onclick = () => uploadDoc({ applicant_id: a.id }, () => route());
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
    const [apps, acs, prior] = await Promise.all([q(sb.from('applicants').select('id,first_name,last_name,cert_held').eq('org_id', S.orgId).eq('archived', false).order('last_name')), q(sb.from('aircraft').select('*').eq('org_id', S.orgId).eq('archived', false).order('tail')),
      q(sb.from('debriefs').select('id,poa_id,applicant_id,results,outcome,test_date').eq('org_id', S.orgId).in('outcome', ['fail', 'discontinued']).eq('status', 'signed'))]);
    const crId = params.get('checkride');
    const cr = crId ? await q(sb.from('checkrides').select('*').eq('id', crId).single()) : null;
    const orgSt = await A2().orgSettings();
    const pre = params.get('applicant') || (cr && cr.applicant_id);
    c.innerHTML = head('New plan of action', 'Choose the purpose and the certificate or rating. smartPOA selects the governing ACS or PTS and the required tasks.') +
      `<div class="card" style="max-width:820px"><form id="f"><div class="form-grid">
      <label>Purpose<select name="purpose">${Object.entries(E.PURPOSE_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label>Applicant<select name="applicant" required><option value="">Select…</option>${apps.map((a) => `<option value="${a.id}" ${a.id === pre ? 'selected' : ''}>${esc(a.last_name)}, ${esc(a.first_name)}${a.cert_held ? ' — ' + esc(a.cert_held) : ''}</option>`).join('')}</select>${apps.length ? '' : '<span class="xs"><a href="#/applicants">Add an applicant first</a></span>'}</label>
      <label>Certificate level<select name="cert"><option value="private">Private Pilot</option><option value="commercial">Commercial Pilot</option><option value="instrument">Instrument Rating</option><option value="atp">Airline Transport Pilot / type rating</option><option value="cfi">Flight Instructor (Airplane)</option></select></label>
      <label>Category / class for this test<select name="cls">${['ASEL', 'AMEL', 'ASES', 'AMES', 'RH', 'RG'].map((x) => `<option value="${x}">${x} — ${E.CLASS_LABEL[x]}</option>`).join('')}</select></label>
      <label id="heldL" style="display:none">Rating already held (for the Additional Rating Task Table)<select name="held">${E.HELD_OPTIONS.map((x) => `<option value="${x}">${x}</option>`).join('')}</select></label>
      <label id="typeL" style="display:none">Type designator<input name="typeDesignator" placeholder="e.g. CE-525S"></label>
      <label id="atpL" class="check" style="display:none;margin-top:1.6rem"><input type="checkbox" name="atpCert"> ATP certificate is also being issued on this test</label>
      <label id="retL" class="full" style="display:none">Previous attempt (tasks failed or not completed are carried forward)<select name="retest"><option value="">Select a disapproval or discontinuance…</option>${prior.map((d) => `<option value="${d.id}" data-app="${d.applicant_id}">${fmtDate(d.test_date)} — ${d.outcome}</option>`).join('')}</select></label>
      <label>Aircraft<select name="aircraft"><option value="">Select…</option>${acs.map((a) => `<option value="${a.id}" data-cls="${esc(a.class)}" data-type="${esc(a.type_designator || '')}">${esc(a.tail)} — ${esc(a.make_model)} (${esc(a.class)})</option>`).join('')}</select></label>
      <label>Planned test date<input type="date" name="test_date"></label>
      <label class="full">Location<input name="location" placeholder="e.g. KPBI, Atlantic Aviation"></label></div>
      <div id="res" class="banner info" style="margin-top:.4rem"></div>
      <div class="btn-row" style="justify-content:flex-end"><a class="btn ghost" href="#/poas">Cancel</a><button class="btn" type="submit">Create plan</button></div></form></div>`;
    const f = qs('#f', c);
    if (cr) {
      const pu = window.SPOA.CR.PURPOSE_OF[cr.test_type]; if (pu) f.purpose.value = pu;
      if (cr.grade_sought) f.cert.value = cr.grade_sought;
      if (cr.class) f.cls.value = cr.class;
      if (cr.scheduled_at) f.test_date.value = cr.scheduled_at.slice(0, 10);
      if (cr.departure_airport) f.location.value = cr.departure_airport;
      const tailOpt = Array.from(f.aircraft.options).find((o) => cr.tail_number && o.textContent.toUpperCase().startsWith(cr.tail_number.toUpperCase())); if (tailOpt) f.aircraft.value = tailOpt.value;
      c.querySelector('.page-head .sub').textContent = 'Prefilled from the checkride record: ' + [cr.test_type, cr.departure_airport, cr.scheduled_at ? fmtDT(cr.scheduled_at) : ''].filter(Boolean).join(' · ') + '. Review each field.';
    }
    const sync = () => {
      const p = f.purpose.value;
      qs('#heldL', c).style.display = p === 'added_rating' ? '' : 'none';
      qs('#typeL', c).style.display = p === 'type_rating' || f.cert.value === 'atp' ? '' : 'none';
      qs('#atpL', c).style.display = p === 'type_rating' ? '' : 'none';
      qs('#retL', c).style.display = p === 'retest' || p === 'continuation' ? '' : 'none';
      if (p === 'type_rating') f.cert.value = 'atp';
      if (p === 'reinstatement') f.cert.value = 'cfi';
      const prof = { cert: f.cert.value, cls: f.cls.value, purpose: p, held: f.held.value };
      const r = E.resolveStandard(S.std, prof);
      if (r.error) { qs('#res', c).className = 'banner bad'; qs('#res', c).textContent = r.error; return; }
      const t = E.requiredTasks(r.doc, Object.assign(prof, { atpCert: f.atpCert.checked }));
      qs('#res', c).className = 'banner info';
      qs('#res', c).innerHTML = `Governing standard: <b>${esc(r.doc.num)}</b> — ${esc(r.doc.title)} (${esc(r.doc.edition_date)}). ${t.filter((x) => x.required).length} of ${t.length} tasks required for this profile.` + (p === 'added_rating' && !(r.doc.additional_rating && r.doc.additional_rating[prof.cls]) ? ' <br>This standard has no Additional Rating Task Table for ' + esc(prof.cls) + '; all applicable tasks are listed and you can mark exclusions with a reason.' : '');
    };
    ['purpose', 'cert', 'cls', 'held', 'atpCert'].forEach((n) => f[n].addEventListener('change', sync));
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
      const appFull = await q(sb.from('applicants').select('knowledge_test').eq('id', app.id).single());
      const aktr = (appFull.knowledge_test && appFull.knowledge_test.aktr) || [];
      const usage = await elementUsage();
      const tasks = E.requiredTasks(r.doc, prof, { usage });
      if (r.doc.cfi_matrix && prof.cert === 'cfi') prof.cfiPicks = tasks.filter((t) => t.required).map((t) => t.key);
      const content = { tasks: {}, scenario: { triggers: [] }, briefings: {}, questions: [], eligibility: {}, attest: {}, aktr };
      tasks.forEach((t) => { const s = E.selectElements(r.doc, t.area, t.task, { aktr, usage }); content.tasks[t.key] = { included: t.required, elements: t.required ? s.selected : [], why: s.why, method: defaultMethod(t), excludeReason: '' }; });
      Object.keys(E.DEFAULT_BRIEFINGS).forEach((k) => content.briefings[k] = (((orgSt.briefings || {})[k]) || E.DEFAULT_BRIEFINGS[k]).replace(/\{std\}/g, r.doc.num));
      const sp = E.scenarioProfile(orgSt, prof.cert);
      if (cr) { content.scenario.dep = cr.departure_airport || ''; content.checkride = { id: cr.id, test_type: cr.test_type, basis: cr.basis, preapproval_number: cr.preapproval_number, scheduled_at: cr.scheduled_at, aircraft: cr.aircraft_make_model, tail: cr.tail_number, notes: cr.notes }; }
      if (sp) { content.scenario.profile = sp; if (sp.arrival && !content.scenario.dest) content.scenario.dest = sp.arrival; if (sp.weather) content.scenario.weather = sp.weather; }
      const ac = acs.find((a) => a.id === f.aircraft.value);
      const row = { org_id: S.orgId, applicant_id: app.id, aircraft_id: ac ? ac.id : null, examiner_id: S.ctx.user_id, purpose: prof.purpose, test_profile: prof, standard_id: r.doc.id,
        standard_sha256: ((S.docsDb || []).find((d) => d.id === r.doc.id) || {}).sha256 || r.doc.sha256, test_date: f.test_date.value || null, location: f.location.value.trim() || null, title: profileTitle(prof, app), content };
      try {
        const p = await act(qs('button[type=submit]', f), () => q(sb.from('poas').insert(row).select('id').single()));
        if (cr) { try { await q(sb.from('checkrides').update({ poa_id: p.id }).eq('id', cr.id)); } catch (_) { toast('Plan created, but the checkride record could not be linked.', true); } }
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
    const comp = () => E.complianceChecks({ doc, profile: p.test_profile, tasks, content, priorPoas: prior, aktr: content.aktr || (app && app.knowledge_test && app.knowledge_test.aktr) || [], docStatus, lastCheck: S.lastCheck });
    const save = () => {
      if (!editable) return;
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
      if (p.status === 'final' && can('org_admin', 'examiner')) a.push(`<a class="btn" href="#/debrief/${p.id}">${debrief ? 'Open debrief' : 'Start checkride'}</a>`);
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
        <div class="card"><h2>Logistics</h2><div class="form-grid"><label>Title<input id="ti" ${dis} value="${esc(p.title)}"></label><label>Test date<input id="td" type="date" ${dis} value="${esc(p.test_date)}"></label><label class="full">Location<input id="lo" ${dis} value="${esc(p.location)}"></label>
        <label class="full">Examiner notes (internal)<textarea id="nt" ${dis}>${esc(content.notes)}</textarea></label></div>${editable ? '<button class="btn sm" id="sv">Save logistics</button>' : ''}</div>
        <div class="card"><h2>Versions</h2>${versions.length ? `<table class="t">${versions.map((v) => `<tr><td class="sm">Version ${v.version}</td><td class="mono xs">${esc(v.content_hash)}</td><td class="sm muted">${fmtDT(v.created_at)}</td></tr>`).join('')}</table>` : '<p class="sm muted">No finalized versions yet.</p>'}</div>
        <div class="card"><div class="card-head"><h2>Attached documents</h2>${can('org_admin', 'examiner') ? '<button class="btn sm" id="up">Upload</button>' : ''}</div><div id="docs"></div></div>`;
      renderDocs(qs('#docs', el), docs);
      const up = qs('#up', el); if (up) up.onclick = () => uploadDoc({ applicant_id: p.applicant_id, poa_id: p.id }, () => route());
      const sv = qs('#sv', el); if (sv) sv.onclick = async () => { content.notes = qs('#nt', c).value; try { await act(sv, () => q(sb.from('poas').update({ title: qs('#ti', c).value.trim() || p.title, test_date: qs('#td', c).value || null, location: qs('#lo', c).value.trim() || null, content }).eq('id', p.id)), 'Saved'); p.title = qs('#ti', c).value.trim() || p.title; p.test_date = qs('#td', c).value || null; p.location = qs('#lo', c).value.trim() || null; } catch (_) {} };
    }

    function paneTasks(el) {
      const aktr = new Set((content.aktr || []).map((x) => x.toUpperCase()));
      const byArea = [];
      tasks.forEach((t) => { let a = byArea.find((x) => x.area === t.area); if (!a) byArea.push(a = { area: t.area, list: [] }); a.list.push(t); });
      const inc = tasks.filter((t) => content.tasks[t.key] && content.tasks[t.key].included).length;
      el.innerHTML = `<div class="banner info">Required tasks are pre-selected from <b>${esc(doc.num)}</b>. ${doc.kind === 'ACS' ? 'For each task smartPOA selects every skill element, any knowledge-test (AKTR) deficiencies, and at least one knowledge and one risk management element, rotating toward elements you have used least.' : 'PTS objective items are all selected.'} ${inc} task(s) included.</div>
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
              ${t.required && !ct.included ? `<label class="xs" style="margin:.35rem 0 0">Reason for leaving out (shown on the proof form)<input class="exr" ${dis} value="${esc(ct.excludeReason)}"></label>` : ''}</div>
              <div class="seg" role="group" aria-label="Method">${['oral', 'flight', 'both'].map((m) => `<button type="button" data-m="${m}" class="${ct.method === m ? 'on' : ''}" ${dis}>${m === 'both' ? 'Both' : m === 'oral' ? 'Oral' : 'Flight'}</button>`).join('')}</div></div>
              <details class="els-d" ${ct.included ? '' : ''}><summary class="xs muted" style="margin:.35rem 0 0 3.8rem;cursor:pointer">${sel.size} of ${t.task.elements.length} elements selected</summary><div class="els">
              ${t.task.elements.map((e, i) => { const ref = codes[i]; const isA = aktr.has(ref.toUpperCase()); return `<label class="el t-${e.type}"><input type="checkbox" class="elc" data-ref="${esc(ref)}" ${sel.has(ref) ? 'checked' : ''} ${dis || (!ct.included ? 'disabled' : '')}><span class="code">${esc(ref)}</span><span style="flex:1${e.sub ? ';padding-left:.8rem' : ''}">${esc(e.text)}</span>${isA ? '<span class="pill bad">AKTR</span>' : ct.why && ct.why[ref] && sel.has(ref) ? `<span class="why">${esc(ct.why[ref])}</span>` : ''}</label>`; }).join('')}
              </div></details></div>`;
          }).join('')}</div></div>`;
        }).join('')}`;
      qsa('.area-head', el).forEach((h) => h.onclick = () => { const b = h.nextElementSibling; b.style.display = b.style.display === 'none' ? '' : 'none'; });
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
          if (ct.included && !(ct.elements || []).length) { const s = E.selectElements(doc, t.area, t.task, { aktr: content.aktr || [] }); ct.elements = s.selected; ct.why = s.why; }
          save(); const open = qs('.area-body', tv.closest('.area')).style.display; paneTasks(el); const ar = qs(`[data-area="${t.area.roman}"] .area-body`, el); if (ar) ar.style.display = open;
          const showEx = qs('#showEx', el); if (showEx) { showEx.checked = !t.required || showEx.checked; showEx.dispatchEvent(new Event('change')); }
        };
        qsa('.elc', tv).forEach((cb) => cb.onchange = () => { const s = new Set(ct.elements || []); cb.checked ? s.add(cb.dataset.ref) : s.delete(cb.dataset.ref); ct.elements = Array.from(s); qs('summary', tv).textContent = s.size + ' of ' + t.task.elements.length + ' elements selected'; save(); });
        qsa('[data-m]', tv).forEach((b) => b.onclick = () => { ct.method = b.dataset.m; qsa('[data-m]', tv).forEach((x) => x.classList.toggle('on', x === b)); save(); });
        const ex = qs('.exr', tv); if (ex) ex.oninput = () => { ct.excludeReason = ex.value; save(); };
      });
      const rs = qs('#resample', el); if (rs) rs.onclick = async () => {
        const usage = await elementUsage();
        tasks.forEach((t) => { const ct = content.tasks[t.key]; if (!ct || !ct.included) return; const s = E.selectElements(doc, t.area, t.task, { aktr: content.aktr || [], usage, rand: Math.random }); ct.elements = s.selected; ct.why = s.why; });
        save(); paneTasks(el); toast('Knowledge and risk elements re-sampled');
      };
    }

    function paneScenario(el) {
      const sc = content.scenario = content.scenario || { triggers: [] };
      const missions = E.missionsFor(p.test_profile);
      const avail = E.triggersFor(tasks);
      const cov = E.scenarioCoverage(tasks, sc);
      const pct = cov.total ? Math.round(100 * cov.covered.length / cov.total) : 0;
      const fill = (s) => String(s).replace(/\{dest\}/g, sc.dest || 'the destination').replace(/\{dep\}/g, sc.dep || 'the departure airport').replace(/\{aircraft\}/g, ac ? ac.make_model : 'aircraft');
      const on = new Set((sc.triggers || []).map((t) => t.id));
      const uncovered = tasks.filter((t) => t.required && !cov.covered.includes(t.key));
      el.innerHTML = `<div class="grid2"><div class="card"><h2>Mission</h2>
        ${editable && can('org_admin', 'examiner') ? `<div class="btn-row" style="margin-bottom:.4rem"><button type="button" class="btn ghost sm" id="aiM">Draft scenario with AI</button><button type="button" class="btn ghost sm" id="aiT">Draft task sub-scenarios with AI</button><span class="xs muted">AI drafts need examiner review. No applicant information is sent.</span></div>` : ''}
        ${sc.aiDraft ? '<div class="banner warn xs" style="margin-bottom:.4rem">AI draft — examiner review required before use.</div>' : ''}
        <label>Start from a template<select id="tpl" ${dis}><option value="">Choose a mission template…</option>${missions.map((m, i) => `<option value="${i}">${esc(m.name)}</option>`).join('')}</select></label>
        <div class="form-grid3"><label>Departure<input id="dep" ${dis} value="${esc(sc.dep)}" placeholder="KPBI"></label><label>Destination<input id="dest" ${dis} value="${esc(sc.dest)}" placeholder="KVRB"></label><label>Alternate<input id="alt" ${dis} value="${esc(sc.alt)}" placeholder="KFPR"></label></div>
        <label>Scenario given to the applicant<textarea id="mission" ${dis} style="min-height:140px" placeholder="Describe the flight the applicant will plan.">${esc(sc.mission)}</textarea></label>
        <div class="form-grid"><label>Route / altitude<input id="route" ${dis} value="${esc(sc.route)}"></label><label>Passengers & cargo<input id="pax" ${dis} value="${esc(sc.pax)}" placeholder="2 adults, 40 lb baggage"></label></div>
        <label>Weather package / source<textarea id="wx" ${dis} style="min-height:60px" placeholder="e.g. Use actual weather on test day; backup: archived package dated…">${esc(sc.weather)}</textarea></label>
        <label>Constraints given to the applicant<textarea id="cons" ${dis} style="min-height:60px" placeholder="e.g. Must arrive before 1700; one passenger is nervous">${esc(sc.constraints)}</textarea></label></div>
        <div class="card"><h2>Scenario coverage</h2><div class="meter" aria-label="coverage"><i style="width:${pct}%"></i></div><p class="sm"><b>${cov.covered.length} of ${cov.total}</b> required tasks are evaluated through the planning phase and selected events (${pct}%). The managing specialist looks for a scenario that evaluates most tasks with minimum disruptions.</p>
        ${uncovered.length ? `<h3>Not yet covered by the scenario</h3><div class="xs">${uncovered.map((t) => `<label class="check" style="margin-bottom:.25rem"><input type="checkbox" class="xc" data-k="${t.key}" ${(sc.extraCovered || []).includes(t.key) ? 'checked' : ''} ${dis}><span><span class="mono">${t.key}</span> ${esc(t.task.title_plain)}</span></label>`).join('')}</div><p class="xs muted">Tick a task if your mission covers it in a way not listed in events (for example, a maneuver flown as part of the arrival).</p>` : '<div class="banner ok">Every required task is tied to the scenario.</div>'}</div></div>
        ${Object.keys(sc.taskScenarios || {}).length ? `<div class="card"><div class="card-head"><h2>Task sub-scenarios</h2><span class="xs muted">AI draft — examiner review · printed with each task</span></div>${Object.entries(sc.taskScenarios).map(([k, v]) => { const t = tasks.find((x) => x.key === k); return `<label class="sm"><span class="mono">${esc(k)}</span> ${esc(t ? t.task.title_plain || t.task.title : '')}<textarea class="tsc" data-k="${esc(k)}" ${dis} style="min-height:56px">${esc(v)}</textarea></label>`; }).join('')}${editable ? '<button type="button" class="btn ghost sm" id="clrT">Remove sub-scenarios</button>' : ''}</div>` : ''}
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
      const aiT = qs('#aiT', el); if (aiT) aiT.onclick = async () => {
        if (!sc.mission || sc.mission.trim().length < 30) { toast('Write or draft the main scenario first.', true); return; }
        const list = tasks.filter((t) => content.tasks[t.key] && content.tasks[t.key].included && content.tasks[t.key].method !== 'oral').slice(0, 30)
          .map((t) => ({ key: t.key, title: t.task.title_plain || t.task.title, skills: t.task.elements.filter((e) => e.type === 'S').map((e) => e.text) }));
        if (!list.length) { toast('No flight or combined tasks are included.', true); return; }
        try { const r = await act(aiT, () => A2().ai('task_scenarios', { master: sc.mission, tasks: list })); sc.taskScenarios = Object.assign({}, sc.taskScenarios || {}); (r.items || []).forEach((x) => { if (list.some((t) => t.key === x.key)) sc.taskScenarios[x.key] = x.text; }); save(); paneScenario(el); toast((r.items || []).length + ' sub-scenario(s) drafted. Review before use.'); } catch (_) {}
      };
      qsa('.tsc', el).forEach((t) => t.oninput = () => { sc.taskScenarios[t.dataset.k] = t.value; save(); });
      const clrT = qs('#clrT', el); if (clrT) clrT.onclick = () => { delete sc.taskScenarios; save(); paneScenario(el); };
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
      el.innerHTML = `<div class="banner info">Order 8000.95D asks the managing specialist to confirm the plan contains the pretest, preflight and postflight briefings. Start from these defaults and edit them to match how you conduct tests.</div>
        ${[['pretest', 'Pretest briefing'], ['preflight', 'Preflight briefing'], ['postflight', 'Postflight debriefing']].map(([k, l]) => `<div class="card"><div class="card-head"><h2>${l}</h2>${editable ? `<button class="btn ghost sm" data-reset="${k}">Reset to default</button>` : ''}</div><textarea data-k="${k}" ${dis} style="min-height:150px">${esc(b[k])}</textarea></div>`).join('')}`;
      if (!editable) return;
      qsa('textarea[data-k]', el).forEach((t) => t.oninput = () => { b[t.dataset.k] = t.value; save(); });
      qsa('[data-reset]', el).forEach((x) => x.onclick = () => { b[x.dataset.reset] = E.DEFAULT_BRIEFINGS[x.dataset.reset].replace('{std}', doc.num); save(); paneBriefings(el); });
    }

    async function paneQuestions(el) {
      const qsList = content.questions = content.questions || [];
      const sel = []; tasks.forEach((t) => { const ct = content.tasks[t.key]; if (!ct || !ct.included) return; const codes = E.elementCodes(doc, t.area, t.task); t.task.elements.forEach((e, i) => { if ((ct.elements || []).includes(codes[i])) sel.push({ t, e, ref: codes[i] }); }); });
      let bank = [];
      try { bank = await q(sb.from('questions').select('*').eq('org_id', S.orgId).eq('status', 'approved').eq('standard_id', doc.id)); } catch (_) {}
      const bankMatch = bank.filter((b) => sel.some((s) => s.ref === b.element_code) && !qsList.some((x) => x.bankId === b.id));
      const counts = qsList.reduce((a, x) => (a[x.portion] = (a[x.portion] || 0) + 1, a), {});
      el.innerHTML = `<div class="banner info">Questions are generated from the ACS elements selected in this plan and framed in the scenario. They are drafts: review the wording before the test. Approved questions from your bank that match selected elements can be added too.</div>
        <div class="btn-row" style="margin-bottom:.8rem">${editable ? `<button class="btn" id="gen">Generate from selected elements (${sel.length})</button>${bankMatch.length ? `<button class="btn ghost" id="bank">Add ${bankMatch.length} matching bank question(s)</button>` : ''}${can('org_admin', 'examiner') ? `<button class="btn ghost" id="aiQ">Draft questions and expected answers with AI</button>` : ''}<button class="btn ghost" id="addQ">Add a question</button>${qsList.length ? '<button class="btn danger sm" id="clr">Clear all</button>' : ''}` : ''}
        <span class="sm muted">${qsList.length} total · ${counts.oral || 0} oral · ${counts.scenario || 0} scenario · ${counts.flight || 0} flight</span></div>
        <div class="card flush"><div class="table-wrap"><table class="t"><thead><tr><th style="width:8.5rem">Element</th><th>Prompt</th><th style="width:6.5rem">Portion</th><th></th></tr></thead><tbody>
        ${qsList.length ? qsList.map((x, i) => `<tr><td class="mono xs">${esc(x.ref || '')}</td><td>${editable ? `<textarea data-i="${i}" class="qp" style="min-height:52px;margin:0">${esc(x.prompt)}</textarea>` : esc(x.prompt)}${x.source === 'bank' ? '<span class="pill info">Bank</span>' : ''}${x.source === 'ai' ? '<span class="pill warn">AI draft — examiner review</span>' : ''}${x.expected ? `<div class="xs muted" style="margin-top:.25rem"><b>Expected:</b> ${editable ? `<textarea data-i="${i}" class="qe" style="min-height:44px;margin:.2rem 0 0">${esc(x.expected)}</textarea>` : esc(x.expected)}</div>` : ''}</td><td><span class="pill ${x.portion === 'flight' ? 'ok' : x.portion === 'scenario' ? 'warn' : 'info'}">${esc(x.portion)}</span></td><td>${editable ? `<button class="btn ghost sm" data-del="${i}" aria-label="Remove">✕</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="4"><div class="empty"><span class="strong">No questions yet</span>Generate them from the selected elements.</div></td></tr>'}
        </tbody></table></div></div>`;
      if (!editable) return;
      const g = qs('#gen', el); if (g) g.onclick = () => {
        const have = new Set(qsList.filter((x) => x.source === 'generated').map((x) => x.ref));
        const ctx = { scenarioName: (content.scenario && content.scenario.missionName) || '', aircraft: ac ? ac.make_model : '' };
        let n = 0;
        sel.forEach(({ t, e, ref }) => { if (have.has(ref)) return; const qq = E.questionFor(e, ctx); qsList.push({ id: uid().slice(0, 8), ref, task: t.key, portion: qq.portion, prompt: qq.prompt, source: 'generated' }); n++; });
        save(); paneQuestions(el); toast(n + ' question(s) added');
      };
      const bk = qs('#bank', el); if (bk) bk.onclick = () => { bankMatch.forEach((b) => qsList.push({ id: uid().slice(0, 8), bankId: b.id, ref: b.element_code, task: b.task_ref, portion: b.portion, prompt: b.prompt, expected: b.expected, source: 'bank' })); save(); paneQuestions(el); };
      const aiQ = qs('#aiQ', el); if (aiQ) aiQ.onclick = async () => {
        const have = new Set(qsList.filter((x) => x.source === 'ai').map((x) => x.ref));
        const pick = sel.filter(({ e, ref }) => e.type !== 'S' && !have.has(ref)).slice(0, 40);
        if (!pick.length) { toast('Every selected knowledge and risk element already has an AI question.', true); return; }
        const aktr = new Set((content.aktr || []).map((x) => x.toUpperCase()));
        const st = await A2().orgSettings(); const sp = E.scenarioProfile(st, p.test_profile.cert) || {};
        try {
          const r = await act(aiQ, () => A2().ai('questions', { difficulty: sp.difficulty || '', elements: pick.map(({ t, e, ref }) => ({ code: ref, type: aktr.has(ref.toUpperCase()) ? 'A' : e.type, text: e.text, references: t.task.references || '' })) }));
          let n = 0; (r.items || []).forEach((x) => { const m = pick.find((y) => y.ref.toUpperCase() === String(x.code).toUpperCase()); if (!m) return; qsList.push({ id: uid().slice(0, 8), ref: m.ref, task: m.t.key, portion: m.e.type === 'R' ? 'scenario' : 'oral', prompt: x.question, expected: x.expected, source: 'ai' }); n++; });
          save(); paneQuestions(el); toast(n + ' AI question(s) added. Review before use.');
        } catch (_) {}
      };
      qsa('.qe', el).forEach((t) => t.oninput = () => { qsList[+t.dataset.i].expected = t.value; save(); });
      const aq = qs('#addQ', el); if (aq) aq.onclick = () => { qsList.push({ id: uid().slice(0, 8), ref: '', portion: 'oral', prompt: 'New question', source: 'manual' }); save(); paneQuestions(el); };
      const cl = qs('#clr', el); if (cl) cl.onclick = async () => { if (await confirmBox('Clear all questions?', 'All questions in this plan will be removed.', 'Clear')) { content.questions = []; save(); paneQuestions(el); } };
      qsa('.qp', el).forEach((t) => t.oninput = () => { qsList[+t.dataset.i].prompt = t.value; save(); });
      qsa('[data-del]', el).forEach((b) => b.onclick = () => { qsList.splice(+b.dataset.del, 1); save(); paneQuestions(el); });
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
        <div class="card"><h2>Compliance checks</h2>${cc.rows.map((r) => { const qt = r.quoteKey ? regs[r.quoteKey] : null; return `<div class="comp-row"><div>${{ met: '<span class="pill ok">Met</span>', gap: '<span class="pill bad">Gap</span>', review: '<span class="pill warn">Review</span>', attested: '<span class="pill info">Attested</span>' }[r.status]}</div><div><div class="sm strong">${esc(qt ? qt.src : r.cite)}</div>${qt ? `<div class="quote">“${esc(qt.text)}”${qt.paraphrase ? ' <span class="xs muted">(summary)</span>' : ''}</div>` : ''}<div class="sm">${esc(r.evidence)}</div></div></div>`; }).join('')}</div>`;
      if (!editable) return;
      qsa('[data-e]', el).forEach((cb) => cb.onchange = () => { eg[cb.dataset.e] = cb.checked; save(); paneReview(el); render2(); });
      qsa('[data-a]', el).forEach((cb) => cb.onchange = () => { at[cb.dataset.a] = cb.checked; save(); paneReview(el); render2(); });
      const cr = qs('[data-crew]', el); if (cr) cr.onchange = () => { eg.crew = cr.value; save(); paneReview(el); render2(); };
    }
    function render2() { const cc = comp(); const s = qs('.sticky-actions .sm'); if (s) s.innerHTML = (cc.ready ? '<span class="pill ok">No compliance gaps</span>' : `<span class="pill bad">${cc.counts.gap || 0} gap(s)</span>`) + ` <span class="pill warn">${cc.counts.review || 0} to review</span>`; }
    render();
  }

  // expose for other modules
  Object.assign(window.SPOA, { esc, qs, qsa, fmtDate, fmtDT, today, uid, rpc, q, act, busy, toast, friendly, go, org, roles, can, isOwner, shell, head, modal, confirmBox, loadStd, loadDocsDb, stdDoc, bindRows, statusPill, outcomePill, renderDocs, uploadDoc, ROLE_LABEL, ROLE_DESC, noOrg, AKTR_RE, aktrList, route });

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
        [/^\/(home|login)?$/, () => viewHome()], [/^\/applicants$/, () => viewApplicants()], [/^\/applicant\/([\w-]+)$/, (x) => viewApplicant(x[1])], [/^\/aircraft$/, () => viewAircraft()],
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

/* smartPOA updates: checks version.json for a newer release (on start, when the app comes back to the
   foreground, and every 5 minutes), applies it automatically when nothing is being edited, and shows a
   What's new window once after each update. Works on phones and home-screen installs, which have no reload button. */
(function () {
  'use strict';
  const A = window.SPOA;
  const { S, esc, qs, modal, isOwner, can } = A;
  const C = window.SPOA_CONFIG || {};
  const CUR = C.version || '0.0.0';
  const SEEN_KEY = 'spoa_seen_version';
  const TRY_KEY = 'spoa_update_try';
  let dirty = false, pending = null, info = null, shownWn = false;

  const cmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };

  // Remove the cache-busting ?u= marker after an update reload.
  if (/[?&]u=/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash);

  document.addEventListener('input', (e) => { if (e.target && e.target.closest && e.target.closest('form, .modal, #content')) dirty = true; }, true);
  document.addEventListener('submit', () => { setTimeout(() => { dirty = false; maybeApply(); }, 1500); }, true);
  window.addEventListener('hashchange', () => { dirty = false; maybeApply(); });

  async function fetchInfo() {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('version check ' + r.status);
    return r.json();
  }

  function canApply() { return !dirty && !qs('.modal-bg') && !qs('button[disabled][data-l]'); }

  function apply(ver) {
    sessionStorage.setItem(TRY_KEY, ver);
    location.replace(location.pathname + '?u=' + encodeURIComponent(ver) + location.hash);
  }

  function banner(ver) {
    if (qs('#updBar')) return;
    const b = document.createElement('div');
    b.id = 'updBar'; b.className = 'upd-bar no-print'; b.setAttribute('role', 'status');
    b.innerHTML = `<span>A new version of smartPOA (v${esc(ver)}) is ready.</span><button class="btn sm" type="button" id="updNow">Update now</button><button class="btn ghost sm" type="button" id="updLater">Later</button>`;
    document.body.appendChild(b);
    qs('#updNow').onclick = () => { if (dirty && !confirm('Updating reloads the page. Anything you have not saved will be lost. Update now?')) return; apply(ver); };
    qs('#updLater').onclick = () => b.remove();
  }

  function maybeApply() {
    if (!pending) return;
    // Avoid a reload loop if the server is still delivering the old files.
    if (sessionStorage.getItem(TRY_KEY) === pending) { banner(pending); return; }
    if (canApply()) apply(pending); else banner(pending);
  }

  async function check() {
    try {
      info = await fetchInfo();
      if (info.version && cmp(info.version, CUR) > 0) { pending = info.version; maybeApply(); }
      else sessionStorage.removeItem(TRY_KEY);
    } catch (_) { /* offline or temporary error: try again later */ }
  }

  // ---------- What's new ----------
  function visible(item) {
    if (!item.roles || !item.roles.length) return true;
    if (item.roles.includes('owner') && isOwner()) return true;
    const r = item.roles.filter((x) => x !== 'owner');
    return r.length ? can(...r) : false;
  }
  function fmt(d) { try { return new Date(d + 'T12:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (_) { return d; } }

  async function openWhatsNew(since) {
    if (!info) { try { info = await fetchInfo(); } catch (_) { return; } }
    let rel = (info.releases || []).filter((r) => cmp(r.version, CUR) <= 0);
    if (since === 'first') rel = rel.filter((r) => cmp(r.version, CUR) === 0);
    else if (since) rel = rel.filter((r) => cmp(r.version, since) > 0);
    rel = rel.map((r) => ({ ...r, items: (r.items || []).map((i) => (typeof i === 'string' ? { text: i, roles: r.roles || [] } : i)).filter((i) => i && i.text).filter(visible) })).filter((r) => r.items.length).slice(0, since ? 4 : 6);
    if (!rel.length) return;
    modal(`<h2>What's new in smartPOA</h2><p class="sm muted">Version ${esc(CUR)}</p>
      ${rel.map((r) => `<div class="wn-rel"><div class="wn-head"><span class="strong">${esc(r.title)}</span><span class="xs muted">v${esc(r.version)} · ${esc(fmt(r.date))}</span></div><ul>${r.items.map((i) => `<li>${esc(i.text)}</li>`).join('')}</ul></div>`).join('')}
      <div class="btn-row" style="justify-content:flex-end"><button class="btn" type="button" data-close>Got it</button></div>`);
  }
  A.openWhatsNew = () => openWhatsNew(null);

  function bindLink() {
    const l = qs('#wnLink'); if (l && !l.dataset.b) { l.dataset.b = '1'; l.onclick = (e) => { e.preventDefault(); openWhatsNew(null); }; }
  }

  function maybeShowWhatsNew() {
    bindLink();
    if (shownWn || !S.ctx || !qs('.sidebar')) return;
    shownWn = true;
    const seen = localStorage.getItem(SEEN_KEY);
    localStorage.setItem(SEEN_KEY, CUR);
    if (seen && cmp(seen, CUR) >= 0) return;
    // First visit on this device: show only the current release. After an update: show everything since.
    openWhatsNew(seen || 'first');
  }

  new MutationObserver(() => { bindLink(); if (!shownWn) setTimeout(maybeShowWhatsNew, 600); }).observe(document.getElementById('app'), { childList: true });

  check();
  setInterval(() => { if (document.visibilityState === 'visible') check(); }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('focus', () => check());
  window.addEventListener('online', () => check());
})();

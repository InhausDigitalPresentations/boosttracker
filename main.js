/* ==========================================================================
   MAIN.JS — app bootstrap, hash router, and live-sync with Supabase
   ==========================================================================
   Routes:
     #/dashboard
     #/clients
     #/archive
     #/settings
     #/client/:clientId
     #/client/:clientId/:month   (view a specific — possibly archived — month)

   Live sync:
     - Every view queries Supabase directly (see db.js) — there's no local
       cache, so navigating anywhere always shows what's really in the
       database right now.
     - A Supabase Realtime subscription listens for ANY change to the four
       tables and re-renders the current view automatically, so a tab left
       open picks up teammates' edits within a moment, no polling needed.
     - A slow (60s) background poll is kept purely as a safety net in case
       the realtime connection silently drops.
     - The sidebar footer shows sync status + a manual "Refresh now" button.
   ========================================================================== */

(function () {
  const appContent = document.getElementById('app-content');
  const SAFETY_POLL_MS = 60000;
  const REALTIME_DEBOUNCE_MS = 400;
  let pollTimer = null;
  let realtimeDebounceTimer = null;

  function setActiveNav(routeKey) {
    document.querySelectorAll('.nav-item').forEach((a) => {
      a.classList.toggle('active', a.dataset.route === routeKey);
    });
  }

  function parseHash() {
    const raw = window.location.hash.replace(/^#\/?/, '');
    return raw.split('/').filter(Boolean);
  }

  // ---- sync status indicator (sidebar footer) --------------------------------
  function setSyncStatus(status, message) {
    const dot = document.getElementById('sync-dot');
    const label = document.getElementById('sync-label');
    if (!dot || !label) return;
    dot.className = 'sync-dot ' + status; // 'pending' | 'ok' | 'error'
    label.textContent = message;
  }

  function timeAgo(ts) {
    if (!ts) return 'never';
    const seconds = Math.round((Date.now() - ts) / 1000);
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const mins = Math.round(seconds / 60);
    return `${mins}m ago`;
  }

  function refreshSyncLabel() {
    const dot = document.getElementById('sync-dot');
    if (!dot || dot.classList.contains('error') || dot.classList.contains('pending')) return;
    const label = document.getElementById('sync-label');
    if (label) label.textContent = 'Synced ' + timeAgo(window.DB.getLastSyncedAt());
  }

  function isAnyModalOpen() {
    return !!document.querySelector('.modal-overlay:not(.hidden)');
  }

  // ---- top loading bar (feedback for the round-trip on navigation) -------------
  function loadingBarStart() {
    const bar = document.getElementById('route-loading-bar');
    if (!bar) return;
    bar.classList.remove('done');
    void bar.offsetWidth; // restart the transition if it's already mid-animation
    bar.classList.add('active');
  }

  function loadingBarFinish() {
    const bar = document.getElementById('route-loading-bar');
    if (!bar) return;
    bar.classList.remove('active');
    bar.classList.add('done');
    setTimeout(() => bar.classList.remove('done'), 500);
  }

  // ---- setup notice (shown when db.js's Supabase config hasn't been set) -------
  function showSetupNotice() {
    document.getElementById('fab-add-boost').style.display = 'none';
    appContent.innerHTML = `
      <div class="setup-notice">
        <h2>Almost there — connect Supabase</h2>
        <p>This app reads and writes a Supabase database, but the connection hasn't been configured yet.</p>
        <ol>
          <li>Open <code>SETUP.md</code> in this project for the full walkthrough.</li>
          <li>Run <code>supabase_schema.sql</code> once in your Supabase project's SQL Editor.</li>
          <li>Copy your Project URL and anon key from Settings &gt; API and paste them into <code>SUPABASE_URL</code> / <code>SUPABASE_ANON_KEY</code> at the top of <code>db.js</code>.</li>
          <li>Reload this page.</li>
        </ol>
      </div>
    `;
    setSyncStatus('error', 'Not connected');
  }

  function showConnectionError(err) {
    appContent.innerHTML = `
      <div class="setup-notice">
        <h2>Can't reach Supabase right now</h2>
        <p>${Utils.escapeHtml(err && err.message ? err.message : String(err))}</p>
        <p>Check your internet connection and that the Supabase project is active (Free-tier projects pause after a week of inactivity — reopen the project in your Supabase dashboard to wake it up), then hit refresh below.</p>
      </div>
    `;
    setSyncStatus('error', 'Connection error');
  }

  // ---- router -------------------------------------------------------------------
  async function renderRoute() {
    const parts = parseHash();
    const routeKey = parts[0] || 'dashboard';
    setActiveNav(routeKey === 'client' ? '' : routeKey);

    setSyncStatus('pending', 'Syncing…');
    loadingBarStart();

    try {
      switch (routeKey) {
        case 'dashboard': await window.Views.dashboard(appContent); break;
        case 'clients': await window.Views.clients(appContent); break;
        case 'archive': await window.Views.archive(appContent); break;
        case 'settings': await window.Views.settings(appContent); break;
        case 'client': await window.Views.clientDetail(appContent, parts[1], parts[2]); break;
        default: await window.Views.dashboard(appContent);
      }
      setSyncStatus('ok', 'Synced ' + timeAgo(window.DB.getLastSyncedAt()));
    } catch (err) {
      if (err && err.message === 'NOT_CONFIGURED') { showSetupNotice(); return; }
      console.error('Failed to render route', routeKey, err);
      showConnectionError(err);
      return;
    } finally {
      loadingBarFinish();
    }
  }

  // ---- realtime + safety-net polling --------------------------------------------
  function onRemoteChange() {
    if (isAnyModalOpen()) return; // don't yank the rug out from under an open form
    clearTimeout(realtimeDebounceTimer);
    realtimeDebounceTimer = setTimeout(() => { renderRoute(); }, REALTIME_DEBOUNCE_MS);
  }

  function startSafetyPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (window.DB.isConfigured() && !isAnyModalOpen()) renderRoute();
    }, SAFETY_POLL_MS);
    setInterval(refreshSyncLabel, 5000);
  }

  function bindSyncButton() {
    const btn = document.getElementById('sync-refresh-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const icon = btn.querySelector('.sync-icon');
      if (icon) icon.classList.add('spinning');
      await renderRoute();
      if (icon) icon.classList.remove('spinning');
      Utils.toast('Refreshed');
    });
  }

  async function start() {
    Modals.init();
    bindSyncButton();

    window.Router = { rerender: renderRoute };
    window.addEventListener('hashchange', renderRoute);

    if (!window.location.hash || window.location.hash === '#') {
      window.location.hash = '#/dashboard';
    } else {
      await renderRoute();
    }

    if (window.DB.isConfigured()) window.DB.subscribeToChanges(onRemoteChange);
    startSafetyPoll();
  }

  document.addEventListener('DOMContentLoaded', start);
})();

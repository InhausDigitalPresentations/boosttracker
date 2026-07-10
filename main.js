/* ==========================================================================
   MAIN.JS — app bootstrap, hash router, and live-sync with the Google Sheet
   ==========================================================================
   Routes:
     #/dashboard
     #/clients
     #/archive
     #/settings
     #/client/:clientId
     #/client/:clientId/:month   (view a specific — possibly archived — month)

   Live sync:
     - Every route change re-fetches the full dataset from the Sheet first,
       so navigating around always shows what's really there right now.
     - A background timer refreshes every 25s so a tab left open on the
       Dashboard picks up teammates' edits without anyone touching anything.
     - The sidebar footer shows sync status + a manual "Refresh now" button.
   ========================================================================== */

(function () {
  const appContent = document.getElementById('app-content');
  const POLL_INTERVAL_MS = 25000;
  let pollTimer = null;

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

  // ---- top loading bar (feedback for the Sheet round-trip on navigation) -------
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

  // ---- setup notice (shown when db.js's WEB_APP_URL hasn't been set yet) -------
  function showSetupNotice() {
    document.getElementById('fab-add-boost').style.display = 'none';
    appContent.innerHTML = `
      <div class="setup-notice">
        <h2>Almost there — connect the Google Sheet</h2>
        <p>This app is wired to read and write a Google Sheet through an Apps Script Web App, but the connection hasn't been configured yet.</p>
        <ol>
          <li>Open <code>SETUP.md</code> in this project for the full walkthrough.</li>
          <li>Deploy <code>Code.gs</code> on your Google Sheet as a Web App (Execute as "Me", access "Anyone").</li>
          <li>Copy the deployment URL and paste it into <code>WEB_APP_URL</code> at the top of <code>db.js</code>.</li>
          <li>Reload this page.</li>
        </ol>
      </div>
    `;
    setSyncStatus('error', 'Not connected');
  }

  function showConnectionError(err) {
    appContent.innerHTML = `
      <div class="setup-notice">
        <h2>Can't reach the Google Sheet right now</h2>
        <p>${Utils.escapeHtml(err && err.message ? err.message : String(err))}</p>
        <p>Check that the Apps Script Web App is still deployed with "Anyone" access, and that you have an internet connection, then hit refresh below.</p>
      </div>
    `;
    setSyncStatus('error', 'Connection error');
  }

  // ---- router -------------------------------------------------------------------
  async function renderRoute(opts) {
    opts = opts || {};
    const parts = parseHash();
    const routeKey = parts[0] || 'dashboard';
    setActiveNav(routeKey === 'client' ? '' : routeKey);

    if (opts.skipRefresh !== true) {
      setSyncStatus('pending', 'Syncing…');
      loadingBarStart();
      try {
        await window.DB.refresh();
      } catch (err) {
        loadingBarFinish();
        if (err && err.message === 'NOT_CONFIGURED') { showSetupNotice(); return; }
        showConnectionError(err);
        return;
      }
      loadingBarFinish();
    }
    setSyncStatus('ok', 'Synced ' + timeAgo(window.DB.getLastSyncedAt()));

    try {
      switch (routeKey) {
        case 'dashboard': await window.Views.dashboard(appContent); break;
        case 'clients': await window.Views.clients(appContent); break;
        case 'archive': await window.Views.archive(appContent); break;
        case 'settings': await window.Views.settings(appContent); break;
        case 'client': await window.Views.clientDetail(appContent, parts[1], parts[2]); break;
        default: await window.Views.dashboard(appContent);
      }
    } catch (err) {
      console.error('Failed to render route', routeKey, err);
      appContent.innerHTML = `<div class="empty-state"><p>Something went wrong loading this page.</p></div>`;
    }
  }

  // ---- background polling + manual refresh --------------------------------------
  async function backgroundRefresh() {
    if (!window.DB.isConfigured()) return; // setup notice is already showing; nothing to poll yet
    if (isAnyModalOpen()) return; // don't yank the rug out from under an open form
    try {
      await window.DB.refresh();
      setSyncStatus('ok', 'Synced ' + timeAgo(window.DB.getLastSyncedAt()));
      await renderRoute({ skipRefresh: true });
    } catch (err) {
      setSyncStatus('error', 'Connection error');
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(backgroundRefresh, POLL_INTERVAL_MS);
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

    window.Router = { rerender: () => renderRoute({ skipRefresh: true }) };
    window.addEventListener('hashchange', () => renderRoute());

    if (!window.location.hash || window.location.hash === '#') {
      window.location.hash = '#/dashboard';
    } else {
      await renderRoute();
    }

    startPolling();
  }

  document.addEventListener('DOMContentLoaded', start);
})();

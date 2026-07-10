/* ==========================================================================
   DB.JS — DATA ACCESS LAYER (Google Sheet backed, via Apps Script Web App)
   ==========================================================================
   Every function here still returns a Promise with the exact same shape as
   before, so dashboard.js / clientDetail.js / clients.js / archiveView.js /
   settingsView.js / modals.js do not need to change at all.

   How it works:
     - GET  {WEB_APP_URL}?action=getAll   loads the whole dataset once and
       caches it in `state`. All the getX() readers below just read that
       cache synchronously (wrapped in Promise.resolve), so switching pages
       is instant and doesn't hammer the Apps Script quota.
     - Every write (add/update/delete/closeMonth) POSTs {action, payload} to
       the same URL. The Apps Script responds with the FULL fresh state,
       which replaces the local cache — so the very next screen you look at
       is already showing what's really in the Sheet.
     - main.js re-fetches (DB.refresh()) on every route change and on a
       timer, so a second person's edits show up for everyone else too.

   Setup: deploy Code.gs as a Web App (see SETUP.md), then paste the URL
   into WEB_APP_URL below.
   ========================================================================== */

window.DB = (function () {
  // ⚠️ SET THIS after deploying Code.gs — see SETUP.md.
  // Deploy > New deployment > Web app > Execute as "Me" > Who has access "Anyone"
  const WEB_APP_URL = 'https://script.google.com/a/macros/inhaus.ae/s/AKfycbwVLnvuGhK3fOffGWZ6VcKw2nhBIMylJiQT0cCd4Ti-Qj3jyKij89tX6OIu2YymyyDV/exec';

  let state = { clients: [], teamMembers: [], boosts: [], archive: [] };
  let lastSyncedAt = null;

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function pad2(n) { return String(n).padStart(2, '0'); }

  function currentMonthStr() {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  }

  function nextMonthStr(monthStr) {
    let [y, m] = monthStr.split('-').map(Number);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    return `${y}-${pad2(m)}`;
  }

  function isConfigured() {
    return !!WEB_APP_URL && WEB_APP_URL.indexOf('PASTE_YOUR') === -1;
  }

  // ---- transport --------------------------------------------------------------
  async function apiGet() {
    if (!isConfigured()) throw new Error('NOT_CONFIGURED');
    const res = await fetch(`${WEB_APP_URL}?action=getAll`, { method: 'GET' });
    if (!res.ok) throw new Error('Could not reach the Google Sheet backend (HTTP ' + res.status + ')');
    return res.json();
  }

  async function apiPost(action, payload) {
    if (!isConfigured()) throw new Error('NOT_CONFIGURED');
    // Content-Type text/plain keeps this a CORS "simple request" — Apps
    // Script web apps don't implement doOptions, so application/json would
    // trigger a preflight that fails. Apps Script still parses the JSON
    // body fine on its end via e.postData.contents.
    const res = await fetch(WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload }),
    });
    if (!res.ok) throw new Error('Could not save to the Google Sheet backend (HTTP ' + res.status + ')');
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Unknown error saving to the sheet');
    state = json.state;
    lastSyncedAt = Date.now();
    return json.entity;
  }

  // ---- init / live sync ---------------------------------------------------------
  async function refresh() {
    state = await apiGet();
    lastSyncedAt = Date.now();
    return clone(state);
  }

  const init = refresh; // same operation — kept as a separate name for readability at call sites

  function getLastSyncedAt() { return lastSyncedAt; }

  // ---- clients ------------------------------------------------------------------
  function getClients() { return Promise.resolve(clone(state.clients)); }

  function getClient(id) {
    const c = state.clients.find((c) => c.id === id);
    return Promise.resolve(c ? clone(c) : null);
  }

  function addClient(data) { return apiPost('addClient', data); }
  function updateClient(id, data) { return apiPost('updateClient', Object.assign({ id }, data)); }
  function deleteClient(id) { return apiPost('deleteClient', { id }); }

  // ---- team members ------------------------------------------------------------
  function getTeamMembers() { return Promise.resolve(clone(state.teamMembers)); }
  function addTeamMember(data) { return apiPost('addTeamMember', data); }
  function updateTeamMember(id, data) { return apiPost('updateTeamMember', Object.assign({ id }, data)); }
  function deleteTeamMember(id) { return apiPost('deleteTeamMember', { id }); }

  // ---- boosts ---------------------------------------------------------------------
  function getBoosts(filter) {
    filter = filter || {};
    let list = state.boosts.slice();
    if (filter.clientId) list = list.filter((b) => b.clientId === filter.clientId);
    if (filter.month) list = list.filter((b) => b.month === filter.month);
    return Promise.resolve(clone(list));
  }

  function getBoost(id) {
    const b = state.boosts.find((b) => b.id === id);
    return Promise.resolve(b ? clone(b) : null);
  }

  function addBoost(data) { return apiPost('addBoost', data); }
  function updateBoost(id, data) { return apiPost('updateBoost', Object.assign({ id }, data)); }
  function deleteBoost(id) { return apiPost('deleteBoost', { id }); }

  // ---- archive ----------------------------------------------------------------------
  function getArchive(filter) {
    filter = filter || {};
    let list = state.archive.slice();
    if (filter.year) list = list.filter((a) => a.month.startsWith(String(filter.year)));
    if (filter.month) list = list.filter((a) => a.month === filter.month);
    if (filter.clientId) list = list.filter((a) => a.clientId === filter.clientId);
    list.sort((a, b) => (a.month < b.month ? 1 : -1));
    return Promise.resolve(clone(list));
  }

  function getArchiveEntry(id) {
    const a = state.archive.find((a) => a.id === id);
    return Promise.resolve(a ? clone(a) : null);
  }

  function updateArchiveInvoice(id, data) { return apiPost('updateArchiveInvoice', Object.assign({ id }, data)); }
  function closeMonth() { return apiPost('closeMonth', {}); }

  // ---- misc ---------------------------------------------------------------------------
  function getCurrentMonth() { return currentMonthStr(); }

  return {
    init, refresh, getLastSyncedAt, isConfigured,
    getClients, getClient, addClient, updateClient, deleteClient,
    getTeamMembers, addTeamMember, updateTeamMember, deleteTeamMember,
    getBoosts, getBoost, addBoost, updateBoost, deleteBoost,
    getArchive, getArchiveEntry, updateArchiveInvoice, closeMonth,
    getCurrentMonth, nextMonthStr,
  };
})();

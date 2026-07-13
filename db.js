/* ==========================================================================
   DB.JS — DATA ACCESS LAYER (Supabase Postgres backend)
   ==========================================================================
   Every function here still returns a Promise with the exact same shape as
   the local/Sheets versions before it, so dashboard.js / clientDetail.js /
   clients.js / archiveView.js / settingsView.js / modals.js don't need to
   change at all.

   Unlike the Google Sheets version, there is no local cache here — every
   call is a live query straight to Postgres via supabase-js, so the app is
   always showing what's actually in the database, on every render.

   Column names in Postgres are snake_case (idiomatic SQL); the rest of the
   app works in camelCase. The small *FromRow / *ToRow mapper functions below
   are the only place that translation happens.

   Setup: create a Supabase project, run supabase_schema.sql once in its SQL
   Editor, then paste the Project URL + anon key below — see SETUP.md.
   ========================================================================== */

window.DB = (function () {
  // ⚠️ SET THESE after creating your Supabase project — see SETUP.md.
  // Find them in your project: Settings > API.
  const SUPABASE_URL = 'https://vxdtewpyumcfovcwhujr.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4ZHRld3B5dW1jZm92Y3dodWpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3ODIzNDQsImV4cCI6MjA5OTM1ODM0NH0.wqvCSH6sIUfABNXL99q4tfTIxsYMNkdKykTJrhOJCZ4';

  let sb = null;
  let lastSyncedAt = null;
  let realtimeChannel = null;

  function isConfigured() {
    return SUPABASE_URL.indexOf('PASTE_YOUR') === -1 && SUPABASE_ANON_KEY.indexOf('PASTE_YOUR') === -1;
  }

  function client() {
    if (!isConfigured()) throw new Error('NOT_CONFIGURED');
    if (!sb) sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return sb;
  }

  // auth.js uses the exact same client instance (and therefore the same
  // logged-in session) rather than creating a second, disconnected one.
  function getRawClient() { return client(); }

  async function unwrap(builder) {
    const { data, error } = await builder;
    if (error) throw new Error(error.message || String(error));
    lastSyncedAt = Date.now();
    return data;
  }

  function getLastSyncedAt() { return lastSyncedAt; }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function currentMonthStr() {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  }
  function nextMonthStr(monthStr) {
    let [y, m] = monthStr.split('-').map(Number);
    m += 1; if (m > 12) { m = 1; y += 1; }
    return `${y}-${pad2(m)}`;
  }

  // ---- row <-> app-object mappers -------------------------------------------
  function clientFromRow(r) {
    return {
      id: r.id,
      name: r.name,
      monthlyBudget: Number(r.monthly_budget) || 0,
      activeMonth: r.active_month,
      createdAt: r.created_at,
    };
  }
  function clientToInsertRow(data) {
    return {
      name: data.name,
      monthly_budget: Number(data.monthlyBudget) || 0,
      active_month: currentMonthStr(),
    };
  }
  function clientToUpdateRow(data) {
    const row = {};
    if (data.name !== undefined) row.name = data.name;
    if (data.monthlyBudget !== undefined) row.monthly_budget = Number(data.monthlyBudget) || 0;
    return row;
  }

  function boostFromRow(r) {
    return {
      id: r.id,
      clientId: r.client_id,
      month: r.month,
      platform: r.platform,
      postLink: r.post_link,
      objective: r.objective,
      budget: Number(r.budget) || 0,
      startDate: r.start_date,
      duration: Number(r.duration) || 1,
      endDate: r.end_date,
      assignedTo: r.assigned_to,
      status: r.status,
      priority: r.priority,
      notes: r.notes || '',
      createdAt: r.created_at,
    };
  }
  function boostToInsertRow(data) {
    return {
      client_id: data.clientId,
      month: data.month || currentMonthStr(),
      platform: data.platform,
      post_link: data.postLink,
      objective: data.objective,
      budget: Number(data.budget) || 0,
      start_date: data.startDate,
      duration: Number(data.duration) || 1,
      assigned_to: data.assignedTo,
      status: data.status || 'To Do',
      priority: data.priority || 'Normal',
      notes: data.notes || '',
    };
  }
  const BOOST_FIELD_MAP = {
    clientId: 'client_id', month: 'month', platform: 'platform', postLink: 'post_link',
    objective: 'objective', budget: 'budget', startDate: 'start_date', duration: 'duration',
    assignedTo: 'assigned_to', status: 'status', priority: 'priority', notes: 'notes',
  };
  function boostToUpdateRow(data) {
    const row = {};
    Object.keys(BOOST_FIELD_MAP).forEach((k) => {
      if (data[k] === undefined) return;
      row[BOOST_FIELD_MAP[k]] = (k === 'budget' || k === 'duration') ? Number(data[k]) : data[k];
    });
    return row;
  }

  function archiveFromRow(r) {
    return {
      id: r.id,
      clientId: r.client_id,
      clientName: r.client_name,
      month: r.month,
      monthlyBudget: Number(r.monthly_budget) || 0,
      allocatedBudget: Number(r.allocated_budget) || 0,
      remainingBudget: Number(r.remaining_budget) || 0,
      numBoosts: Number(r.num_boosts) || 0,
      invoiceStatus: r.invoice_status,
      invoiceNumber: r.invoice_number || '',
      invoiceDate: r.invoice_date,
      boostsSnapshot: (r.boosts_snapshot || []).map(boostFromRow),
      closedAt: r.closed_at,
    };
  }

  // ---- clients ------------------------------------------------------------------
  async function getClients() {
    const rows = await unwrap(client().from('clients').select('*').order('name'));
    return rows.map(clientFromRow);
  }

  async function getClient(id) {
    const { data, error } = await client().from('clients').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    lastSyncedAt = Date.now();
    return data ? clientFromRow(data) : null;
  }

  async function addClient(data) {
    const row = await unwrap(client().from('clients').insert(clientToInsertRow(data)).select().single());
    return clientFromRow(row);
  }

  async function updateClient(id, data) {
    const row = await unwrap(client().from('clients').update(clientToUpdateRow(data)).eq('id', id).select().single());
    return clientFromRow(row);
  }

  async function deleteClient(id) {
    // boosts cascade automatically (ON DELETE CASCADE FK); archive rows are
    // intentionally untouched, they don't reference clients as a foreign key.
    await unwrap(client().from('clients').delete().eq('id', id));
    return { id };
  }

  // ---- team members ---------------------------------------------------------------
  // Rows here are created automatically when someone signs up with an
  // @inhaus.ae account (see the on_auth_user_created trigger in
  // supabase_schema.sql) — there is no addTeamMember/deleteTeamMember
  // anymore. updateTeamMember still exists so people can fix their
  // auto-generated display name or pick a different avatar color.
  async function getTeamMembers() {
    return unwrap(client().from('team_members').select('*').order('name'));
  }

  async function updateTeamMember(id, data) {
    const row = {};
    if (data.name !== undefined) row.name = data.name;
    if (data.color !== undefined) row.color = data.color;
    return unwrap(client().from('team_members').update(row).eq('id', id).select().single());
  }

  // ---- boosts ----------------------------------------------------------------------
  async function getBoosts(filter) {
    filter = filter || {};
    let q = client().from('boosts').select('*').order('created_at');
    if (filter.clientId) q = q.eq('client_id', filter.clientId);
    if (filter.month) q = q.eq('month', filter.month);
    const rows = await unwrap(q);
    return rows.map(boostFromRow);
  }

  async function getBoost(id) {
    const { data, error } = await client().from('boosts').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    lastSyncedAt = Date.now();
    return data ? boostFromRow(data) : null;
  }

  async function addBoost(data) {
    const row = await unwrap(client().from('boosts').insert(boostToInsertRow(data)).select().single());
    return boostFromRow(row);
  }

  async function updateBoost(id, data) {
    const row = await unwrap(client().from('boosts').update(boostToUpdateRow(data)).eq('id', id).select().single());
    return boostFromRow(row);
  }

  async function deleteBoost(id) {
    await unwrap(client().from('boosts').delete().eq('id', id));
    return { id };
  }

  // ---- archive -----------------------------------------------------------------------
  async function getArchive(filter) {
    filter = filter || {};
    let q = client().from('archive').select('*').order('month', { ascending: false });
    if (filter.year) q = q.ilike('month', `${filter.year}-%`);
    if (filter.month) q = q.eq('month', filter.month);
    if (filter.clientId) q = q.eq('client_id', filter.clientId);
    const rows = await unwrap(q);
    return rows.map(archiveFromRow);
  }

  async function getArchiveEntry(id) {
    const { data, error } = await client().from('archive').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    lastSyncedAt = Date.now();
    return data ? archiveFromRow(data) : null;
  }

  async function updateArchiveInvoice(id, data) {
    const row = {};
    if (data.invoiceStatus !== undefined) row.invoice_status = data.invoiceStatus;
    if (data.invoiceNumber !== undefined) row.invoice_number = data.invoiceNumber;
    if (data.invoiceDate !== undefined) row.invoice_date = data.invoiceDate || null;
    const updated = await unwrap(client().from('archive').update(row).eq('id', id).select().single());
    return archiveFromRow(updated);
  }

  async function closeMonth() {
    await unwrap(client().rpc('close_month'));
    return { closedAt: Date.now() };
  }

  // ---- realtime ---------------------------------------------------------------------
  // Subscribes once to every change on the four tables and calls onChange for
  // any insert/update/delete anywhere. main.js debounces + re-renders on this.
  function subscribeToChanges(onChange) {
    if (!isConfigured() || realtimeChannel) return;
    realtimeChannel = client()
      .channel('boost-tracker-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boosts' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'archive' }, onChange)
      .subscribe();
  }

  function unsubscribeFromChanges() {
    if (realtimeChannel) {
      client().removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
  }

  // ---- misc ----------------------------------------------------------------------------
  function getCurrentMonth() { return currentMonthStr(); }

  return {
    isConfigured, getLastSyncedAt, subscribeToChanges, unsubscribeFromChanges, getRawClient,
    getClients, getClient, addClient, updateClient, deleteClient,
    getTeamMembers, updateTeamMember,
    getBoosts, getBoost, addBoost, updateBoost, deleteBoost,
    getArchive, getArchiveEntry, updateArchiveInvoice, closeMonth,
    getCurrentMonth, nextMonthStr,
  };
})();

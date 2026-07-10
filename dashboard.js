/* ==========================================================================
   DASHBOARD.JS — current-month overview: summary cards + one card per client
   ========================================================================== */

window.Views = window.Views || {};

window.Views.dashboard = async function (container) {
  const month = DB.getCurrentMonth();
  const [clients, boosts] = await Promise.all([DB.getClients(), DB.getBoosts({ month })]);

  // ---- per-client stats -----------------------------------------------------
  const clientStats = clients.map((client) => {
    const clientBoosts = boosts.filter((b) => b.clientId === client.id);
    const allocated = Utils.calcAllocated(clientBoosts);
    const remaining = Utils.calcRemaining(client.monthlyBudget, allocated);
    const pending = Utils.calcPendingTasks(clientBoosts);
    return { client, allocated, remaining, pending, numBoosts: clientBoosts.length };
  });

  // ---- global summary ---------------------------------------------------------
  const totalMonthly = clients.reduce((s, c) => s + Number(c.monthlyBudget || 0), 0);
  const totalAllocated = clientStats.reduce((s, c) => s + c.allocated, 0);
  const totalRemaining = totalMonthly - totalAllocated;
  const totalPending = clientStats.reduce((s, c) => s + c.pending, 0);

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Dashboard</h1>
        <p class="page-subtitle">${Utils.escapeHtml(Utils.monthLabel(month))}</p>
      </div>
    </div>

    <div class="summary-grid">
      ${summaryCard('Active Clients', clients.length, null)}
      ${summaryCard('Total Monthly Budget', Utils.formatCurrency(totalMonthly), null)}
      ${summaryCard('Total Allocated', Utils.formatCurrency(totalAllocated), null)}
      ${summaryCard('Total Remaining', Utils.formatCurrency(totalRemaining), totalRemaining < 0 ? 'negative' : null)}
      ${summaryCard('Pending Tasks', totalPending, null)}
    </div>

    <div class="section-heading">Clients — ${Utils.escapeHtml(Utils.monthLabel(month))}</div>

    ${clientStats.length ? `<div class="client-grid" id="client-grid"></div>` : emptyState()}
  `;

  if (clientStats.length) {
    const grid = container.querySelector('#client-grid');
    clientStats.forEach((cs) => grid.appendChild(clientCard(cs)));
  }

  // toggle floating add-boost button on this view
  const fab = document.getElementById('fab-add-boost');
  fab.style.display = 'flex';
  fab.onclick = () => Modals.openBoostModal({ month });
};

function summaryCard(label, value, modifier) {
  return `
    <div class="summary-card">
      <div class="summary-label">${Utils.escapeHtml(label)}</div>
      <div class="summary-value ${modifier === 'negative' ? 'text-red' : ''}">${value}</div>
    </div>
  `;
}

function emptyState() {
  return `
    <div class="empty-state">
      <p>No clients yet.</p>
      <a href="#/clients" class="btn btn-primary">Add your first client</a>
    </div>
  `;
}

function clientCard(cs) {
  const { client, allocated, remaining, pending, numBoosts } = cs;
  const pct = Utils.progressPercent(allocated, client.monthlyBudget);
  const card = Utils.el('div', { class: 'client-card', role: 'button', tabindex: '0' }, []);

  card.innerHTML = `
    <div class="client-card-header">
      <div class="client-card-name">${Utils.escapeHtml(client.name)}</div>
      ${pending > 0 ? `<span class="badge badge-orange">${pending} pending</span>` : `<span class="badge badge-green">All clear</span>`}
    </div>

    <div class="client-card-budgets">
      <div class="budget-stat">
        <span class="budget-stat-label">Monthly</span>
        <span class="budget-stat-value">${Utils.formatCurrency(client.monthlyBudget)}</span>
      </div>
      <div class="budget-stat">
        <span class="budget-stat-label">Allocated</span>
        <span class="budget-stat-value">${Utils.formatCurrency(allocated)}</span>
      </div>
      <div class="budget-stat">
        <span class="budget-stat-label">Remaining</span>
        <span class="budget-stat-value ${remaining < 0 ? 'text-red' : ''}">${Utils.formatCurrency(remaining)}</span>
      </div>
    </div>

    <div class="progress-bar">
      <div class="progress-fill ${remaining < 0 ? 'over' : ''}" style="width:${Math.min(pct, 100)}%"></div>
    </div>
    ${remaining < 0 ? `<div class="warning-banner small">⚠ Over budget by ${Utils.formatCurrency(Math.abs(remaining))}</div>` : ''}

    <div class="client-card-footer">
      <span>${numBoosts} boost${numBoosts === 1 ? '' : 's'}</span>
      <span>${pending} pending task${pending === 1 ? '' : 's'}</span>
    </div>
  `;

  card.addEventListener('click', () => { window.location.hash = `#/client/${client.id}`; });
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter') window.location.hash = `#/client/${client.id}`; });

  return card;
}

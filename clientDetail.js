/* ==========================================================================
   CLIENTDETAIL.JS — single client, single month: budget summary + boost table
   ==========================================================================
   Route shapes:
     #/client/:id            -> client's current active (editable) month
     #/client/:id/:month     -> a specific month; read-only if it is archived
   ========================================================================== */

window.Views = window.Views || {};

window.Views.clientDetail = async function (container, clientId, monthParam) {
  const client = await DB.getClient(clientId);
  if (!client) {
    container.innerHTML = `<div class="empty-state"><p>Client not found.</p><a class="btn btn-primary" href="#/clients">Back to Clients</a></div>`;
    document.getElementById('fab-add-boost').style.display = 'none';
    return;
  }

  const [teamMembers, archiveEntries] = await Promise.all([
    DB.getTeamMembers(),
    DB.getArchive({ clientId }),
  ]);

  const month = monthParam || client.activeMonth;
  const isArchivedMonth = month !== client.activeMonth;
  const archiveEntry = isArchivedMonth ? archiveEntries.find((a) => a.month === month) : null;

  let boosts, monthlyBudget;
  if (isArchivedMonth && archiveEntry) {
    boosts = archiveEntry.boostsSnapshot;
    monthlyBudget = archiveEntry.monthlyBudget;
  } else {
    boosts = await DB.getBoosts({ clientId, month });
    monthlyBudget = client.monthlyBudget;
  }

  const allocated = Utils.calcAllocated(boosts);
  const remaining = Utils.calcRemaining(monthlyBudget, allocated);
  const pct = Utils.progressPercent(allocated, monthlyBudget);

  // ---- month selector options: active month first, then archived months ------
  const monthOptions = [`<option value="${client.activeMonth}">${Utils.monthLabel(client.activeMonth)} (current)</option>`]
    .concat(archiveEntries.map((a) => `<option value="${a.month}" ${a.month === month ? 'selected' : ''}>${Utils.monthLabel(a.month)} (archived)</option>`));
  // mark current selected if that's the active one
  let monthSelectHtml = monthOptions.join('');
  if (!isArchivedMonth) {
    monthSelectHtml = monthSelectHtml.replace(`value="${client.activeMonth}"`, `value="${client.activeMonth}" selected`);
  }

  container.innerHTML = `
    <div class="page-header">
      <div>
        <a href="#/dashboard" class="back-link">&larr; Dashboard</a>
        <h1 class="page-title">${Utils.escapeHtml(client.name)}</h1>
        <p class="page-subtitle">${isArchivedMonth ? '<span class="badge badge-grey">Archived · Read-only</span>' : '<span class="badge badge-green">Current month</span>'}</p>
      </div>
      <div class="page-header-actions">
        <label class="month-selector-label" for="month-select">Month</label>
        <select id="month-select" class="month-selector">${monthSelectHtml}</select>
      </div>
    </div>

    <div class="detail-summary-card">
      <div class="client-card-budgets large">
        <div class="budget-stat">
          <span class="budget-stat-label">Monthly Budget</span>
          <span class="budget-stat-value">${Utils.formatCurrency(monthlyBudget)}</span>
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
      <div class="progress-bar large">
        <div class="progress-fill ${remaining < 0 ? 'over' : ''}" style="width:${Math.min(pct, 100)}%"></div>
      </div>
      ${remaining < 0 ? `<div class="warning-banner">⚠ Remaining budget is negative — over by ${Utils.formatCurrency(Math.abs(remaining))}</div>` : ''}
    </div>

    <div class="section-heading">Boost Tasks</div>

    <div class="table-wrapper">
      <table class="table">
        <thead>
          <tr>
            <th>Platform</th>
            <th>Post Link</th>
            <th>Objective</th>
            <th>Budget</th>
            <th>Start Date</th>
            <th>Duration</th>
            <th>Assigned To</th>
            <th>Status</th>
            ${isArchivedMonth ? '' : '<th class="col-actions">Actions</th>'}
          </tr>
        </thead>
        <tbody id="boost-table-body">
          ${boosts.length ? boosts.map((b) => boostRow(b, teamMembers, isArchivedMonth)).join('') : `<tr><td colspan="9" class="table-empty">No boosts for this month yet.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  // ---- month selector navigation ---------------------------------------------
  container.querySelector('#month-select').addEventListener('change', (e) => {
    const selected = e.target.value;
    if (selected === client.activeMonth) {
      window.location.hash = `#/client/${client.id}`;
    } else {
      window.location.hash = `#/client/${client.id}/${selected}`;
    }
  });

  // ---- inline status editing (current month only) -----------------------------
  if (!isArchivedMonth) {
    container.querySelectorAll('.status-select').forEach((sel) => {
      sel.addEventListener('change', async (e) => {
        const boostId = e.target.dataset.id;
        await DB.updateBoost(boostId, { status: e.target.value });
        Utils.toast('Status updated');
        window.Router.rerender();
      });
    });

    container.querySelectorAll('[data-action="edit-boost"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const boost = await DB.getBoost(btn.dataset.id);
        Modals.openBoostModal({ boost, month: client.activeMonth });
      });
    });

    container.querySelectorAll('[data-action="delete-boost"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this boost task? This cannot be undone.')) return;
        await DB.deleteBoost(btn.dataset.id);
        Utils.toast('Boost task deleted');
        window.Router.rerender();
      });
    });
  }

  // ---- floating add-boost button ------------------------------------------------
  const fab = document.getElementById('fab-add-boost');
  if (isArchivedMonth) {
    fab.style.display = 'none';
  } else {
    fab.style.display = 'flex';
    fab.onclick = () => Modals.openBoostModal({ clientId: client.id, month: client.activeMonth });
  }
};

function boostRow(boost, teamMembers, readOnly) {
  const member = teamMembers.find((m) => m.id === boost.assignedTo);
  const memberHtml = member
    ? `<span class="avatar-inline"><span class="avatar" style="background:${member.color}">${Utils.initials(member.name)}</span>${Utils.escapeHtml(member.name)}</span>`
    : '<span class="text-muted">Unassigned</span>';

  const statusCell = readOnly
    ? `<span class="${Utils.statusBadgeClass(boost.status)}">${boost.status}</span>`
    : `<select class="status-select ${Utils.statusBadgeClass(boost.status)}" data-id="${boost.id}">
        ${['To Do', 'In Progress', 'Boosted', 'Completed', 'Cancelled'].map((s) => `<option value="${s}" ${s === boost.status ? 'selected' : ''}>${s}</option>`).join('')}
      </select>`;

  return `
    <tr>
      <td>${Utils.escapeHtml(boost.platform)}</td>
      <td><a href="${Utils.escapeHtml(boost.postLink)}" target="_blank" rel="noopener noreferrer" class="post-link">View post ↗</a></td>
      <td>${Utils.escapeHtml(boost.objective)}</td>
      <td>${Utils.formatCurrency(boost.budget)}</td>
      <td>${Utils.formatDate(boost.startDate)}</td>
      <td>${boost.duration} day${boost.duration === 1 ? '' : 's'} <span class="text-muted">(ends ${Utils.formatDate(boost.endDate)})</span></td>
      <td>${memberHtml}</td>
      <td>${statusCell} ${boost.priority === 'Urgent' ? `<span class="${Utils.priorityBadgeClass(boost.priority)}">Urgent</span>` : ''}</td>
      ${readOnly ? '' : `
      <td class="col-actions">
        <button class="btn-icon" data-action="edit-boost" data-id="${boost.id}" title="Edit">✎</button>
        <button class="btn-icon danger" data-action="delete-boost" data-id="${boost.id}" title="Delete">🗑</button>
      </td>`}
    </tr>
  `;
}

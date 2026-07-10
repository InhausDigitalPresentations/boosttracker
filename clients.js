/* ==========================================================================
   CLIENTS.JS — client roster: name, monthly budget, active month, quick edit
   ========================================================================== */

window.Views = window.Views || {};

window.Views.clients = async function (container) {
  const clients = await DB.getClients();

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Clients</h1>
        <p class="page-subtitle">${clients.length} client${clients.length === 1 ? '' : 's'}</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary" id="add-client-btn">+ Add Client</button>
      </div>
    </div>

    <div class="table-wrapper">
      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Monthly Budget</th>
            <th>Active Month</th>
            <th class="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${clients.length ? clients.map(clientRow).join('') : `<tr><td colspan="4" class="table-empty">No clients yet. Add your first one.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('fab-add-boost').style.display = 'none';

  container.querySelector('#add-client-btn').addEventListener('click', () => {
    Modals.openClientModal(null);
  });

  container.querySelectorAll('[data-action="quick-edit-client"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const client = await DB.getClient(btn.dataset.id);
      Modals.openClientModal(client);
    });
  });

  container.querySelectorAll('[data-action="delete-client"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name;
      if (!confirm(`Delete "${name}"? This removes the client and any of their active boost tasks for the current month. Already-archived months are kept for invoicing history. This cannot be undone.`)) return;
      await DB.deleteClient(btn.dataset.id);
      Utils.toast('Client deleted');
      window.Router.rerender();
    });
  });

  container.querySelectorAll('[data-action="view-client"]').forEach((el) => {
    el.addEventListener('click', () => { window.location.hash = `#/client/${el.dataset.id}`; });
  });
};

function clientRow(client) {
  return `
    <tr>
      <td><span class="link-like" data-action="view-client" data-id="${client.id}">${Utils.escapeHtml(client.name)}</span></td>
      <td>${Utils.formatCurrency(client.monthlyBudget)}</td>
      <td>${Utils.monthLabel(client.activeMonth)}</td>
      <td class="col-actions">
        <button class="btn btn-secondary btn-sm" data-action="quick-edit-client" data-id="${client.id}">Quick Edit</button>
        <button class="btn-icon danger" data-action="delete-client" data-id="${client.id}" data-name="${Utils.escapeHtml(client.name)}" title="Delete client">🗑</button>
      </td>
    </tr>
  `;
}

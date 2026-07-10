/* ==========================================================================
   ARCHIVEVIEW.JS — searchable archive of closed months + "Close Month" action
   ========================================================================== */

window.Views = window.Views || {};

window.Views.archive = async function (container) {
  const [allArchive, clients] = await Promise.all([DB.getArchive({}), DB.getClients()]);

  const years = Array.from(new Set(allArchive.map((a) => a.month.slice(0, 4)))).sort().reverse();
  const months = Array.from(new Set(allArchive.map((a) => a.month))).sort().reverse();

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Archive</h1>
        <p class="page-subtitle">${allArchive.length} archived record${allArchive.length === 1 ? '' : 's'}</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-danger" id="close-month-btn">Close Month</button>
      </div>
    </div>

    <div class="filters-bar">
      <select id="filter-year">
        <option value="">All Years</option>
        ${years.map((y) => `<option value="${y}">${y}</option>`).join('')}
      </select>
      <select id="filter-month">
        <option value="">All Months</option>
        ${months.map((m) => `<option value="${m}">${Utils.monthLabel(m)}</option>`).join('')}
      </select>
      <select id="filter-client">
        <option value="">All Clients</option>
        ${clients.map((c) => `<option value="${c.id}">${Utils.escapeHtml(c.name)}</option>`).join('')}
      </select>
    </div>

    <div class="table-wrapper">
      <table class="table">
        <thead>
          <tr>
            <th>Month</th>
            <th>Client</th>
            <th>Monthly Budget</th>
            <th>Allocated</th>
            <th>Remaining</th>
            <th>Boosts</th>
            <th>Invoice Status</th>
            <th>Invoice #</th>
            <th>Invoice Date</th>
          </tr>
        </thead>
        <tbody id="archive-table-body"></tbody>
      </table>
    </div>
  `;

  document.getElementById('fab-add-boost').style.display = 'none';

  function renderRows() {
    const y = container.querySelector('#filter-year').value;
    const m = container.querySelector('#filter-month').value;
    const c = container.querySelector('#filter-client').value;

    let rows = allArchive.slice();
    if (y) rows = rows.filter((a) => a.month.startsWith(y));
    if (m) rows = rows.filter((a) => a.month === m);
    if (c) rows = rows.filter((a) => a.clientId === c);

    const tbody = container.querySelector('#archive-table-body');
    tbody.innerHTML = rows.length ? rows.map(archiveRow).join('') : `<tr><td colspan="9" class="table-empty">No archived months match these filters.</td></tr>`;

    // open archived detail on month click
    tbody.querySelectorAll('[data-action="open-archive"]').forEach((elx) => {
      elx.addEventListener('click', () => {
        window.location.hash = `#/client/${elx.dataset.clientId}/${elx.dataset.month}`;
      });
    });

    // inline invoice editing
    tbody.querySelectorAll('.invoice-status-select').forEach((sel) => {
      sel.addEventListener('change', async (e) => {
        await DB.updateArchiveInvoice(e.target.dataset.id, { invoiceStatus: e.target.value });
        Utils.toast('Invoice status updated');
        window.Router.rerender();
      });
    });
    tbody.querySelectorAll('.invoice-number-input').forEach((inp) => {
      inp.addEventListener('change', async (e) => {
        await DB.updateArchiveInvoice(e.target.dataset.id, { invoiceNumber: e.target.value });
        Utils.toast('Invoice number saved');
      });
    });
    tbody.querySelectorAll('.invoice-date-input').forEach((inp) => {
      inp.addEventListener('change', async (e) => {
        await DB.updateArchiveInvoice(e.target.dataset.id, { invoiceDate: e.target.value });
        Utils.toast('Invoice date saved');
      });
    });
  }

  renderRows();

  container.querySelector('#filter-year').addEventListener('change', renderRows);
  container.querySelector('#filter-month').addEventListener('change', renderRows);
  container.querySelector('#filter-client').addEventListener('change', renderRows);

  container.querySelector('#close-month-btn').addEventListener('click', () => {
    Modals.openCloseMonthModal();
  });
};

function archiveRow(a) {
  return `
    <tr>
      <td><span class="link-like" data-action="open-archive" data-client-id="${a.clientId}" data-month="${a.month}">${Utils.monthLabel(a.month)}</span></td>
      <td>${Utils.escapeHtml(a.clientName)}</td>
      <td>${Utils.formatCurrency(a.monthlyBudget)}</td>
      <td>${Utils.formatCurrency(a.allocatedBudget)}</td>
      <td class="${a.remainingBudget < 0 ? 'text-red' : ''}">${Utils.formatCurrency(a.remainingBudget)}</td>
      <td>${a.numBoosts}</td>
      <td>
        <select class="invoice-status-select ${Utils.invoiceBadgeClass(a.invoiceStatus)}" data-id="${a.id}">
          ${['Pending', 'Invoiced', 'Paid'].map((s) => `<option value="${s}" ${s === a.invoiceStatus ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </td>
      <td><input type="text" class="invoice-number-input" data-id="${a.id}" value="${Utils.escapeHtml(a.invoiceNumber)}" placeholder="INV-0000" /></td>
      <td><input type="date" class="invoice-date-input" data-id="${a.id}" value="${a.invoiceDate || ''}" /></td>
    </tr>
  `;
}

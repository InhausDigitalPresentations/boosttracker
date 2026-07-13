/* ==========================================================================
   MODALS.JS — Add/Edit Boost, Quick Edit Client, Close Month, Team Member
   ========================================================================== */

window.Modals = (function () {

  const TEAM_COLORS = ['#F886FE', '#7DD3FC', '#C4B5FD', '#86EFAC', '#FCA5A5', '#FDBA74', '#A5B4FC', '#F9A8D4'];

  function show(id) { document.getElementById(id).classList.remove('hidden'); }
  function hide(id) { document.getElementById(id).classList.add('hidden'); }

  function bindCloseButtons() {
    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.onclick = () => hide(btn.dataset.close);
    });
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
      overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) hide(overlay.id);
      });
    });
  }

  // ---- BOOST MODAL ------------------------------------------------------------
  async function openBoostModal(opts) {
    opts = opts || {};
    const { boost, clientId, month } = opts;
    const isEdit = !!boost;

    const [clients, teamMembers] = await Promise.all([DB.getClients(), DB.getTeamMembers()]);

    document.getElementById('boost-modal-title').textContent = isEdit ? 'Edit Boost Task' : 'Add Boost Task';
    document.getElementById('boost-id').value = boost ? boost.id : '';

    const clientSelect = document.getElementById('boost-client');
    clientSelect.innerHTML = clients.map((c) => `<option value="${c.id}">${Utils.escapeHtml(c.name)}</option>`).join('');
    clientSelect.value = boost ? boost.clientId : (clientId || (clients[0] && clients[0].id) || '');
    clientSelect.disabled = !!clientId && !isEdit; // locked when adding from a client detail page

    const assignedSelect = document.getElementById('boost-assigned');
    assignedSelect.innerHTML = teamMembers.map((m) => `<option value="${m.id}">${Utils.escapeHtml(m.name)}</option>`).join('');

    document.getElementById('boost-platform').value = boost ? boost.platform : 'Instagram';
    document.getElementById('boost-objective').value = boost ? boost.objective : 'Reach';
    document.getElementById('boost-link').value = boost ? boost.postLink : '';
    document.getElementById('boost-budget').value = boost ? boost.budget : '';
    document.getElementById('boost-priority').value = boost ? boost.priority : 'Normal';
    document.getElementById('boost-start').value = boost ? boost.startDate : Utils.todayStr();
    document.getElementById('boost-duration').value = boost ? boost.duration : 7;
    assignedSelect.value = boost ? boost.assignedTo : (teamMembers[0] && teamMembers[0].id) || '';
    document.getElementById('boost-notes').value = boost ? boost.notes : '';

    updateEndDatePreview();
    updateBudgetWarning(clients);

    document.getElementById('boost-modal').dataset.month = month || (boost && boost.month) || DB.getCurrentMonth();

    show('boost-modal');
  }

  function updateEndDatePreview() {
    const start = document.getElementById('boost-start').value;
    const duration = Number(document.getElementById('boost-duration').value);
    const end = Utils.calcEndDate(start, duration);
    document.getElementById('boost-end-date').textContent = end ? Utils.formatDate(end) : '—';
  }

  async function updateBudgetWarning(clientsCache) {
    const clients = clientsCache || (await DB.getClients());
    const clientId = document.getElementById('boost-client').value;
    const boostId = document.getElementById('boost-id').value;
    const month = document.getElementById('boost-modal').dataset.month || DB.getCurrentMonth();
    const budget = Number(document.getElementById('boost-budget').value) || 0;

    const client = clients.find((c) => c.id === clientId);
    if (!client) return;

    const existingBoosts = await DB.getBoosts({ clientId, month });
    const currentAllocated = existingBoosts
      .filter((b) => b.id !== boostId)
      .reduce((sum, b) => sum + Number(b.budget || 0), 0);
    const projectedRemaining = client.monthlyBudget - (currentAllocated + budget);

    const warning = document.getElementById('boost-warning');
    warning.classList.toggle('hidden', projectedRemaining >= 0);
  }

  function bindBoostFormListeners() {
    ['boost-start', 'boost-duration'].forEach((id) => {
      document.getElementById(id).addEventListener('input', updateEndDatePreview);
    });
    ['boost-client', 'boost-budget'].forEach((id) => {
      document.getElementById(id).addEventListener('input', () => updateBudgetWarning());
    });

    document.getElementById('boost-save-btn').addEventListener('click', async () => {
      const form = document.getElementById('boost-form');
      if (!form.reportValidity()) return;

      const id = document.getElementById('boost-id').value;
      const month = document.getElementById('boost-modal').dataset.month || DB.getCurrentMonth();

      const data = {
        clientId: document.getElementById('boost-client').value,
        platform: document.getElementById('boost-platform').value,
        postLink: document.getElementById('boost-link').value.trim(),
        objective: document.getElementById('boost-objective').value,
        budget: Number(document.getElementById('boost-budget').value) || 0,
        startDate: document.getElementById('boost-start').value,
        duration: Number(document.getElementById('boost-duration').value) || 1,
        assignedTo: document.getElementById('boost-assigned').value,
        priority: document.getElementById('boost-priority').value,
        notes: document.getElementById('boost-notes').value.trim(),
        month,
      };

      if (id) {
        await DB.updateBoost(id, data);
        Utils.toast('Boost task updated');
      } else {
        data.status = 'To Do';
        await DB.addBoost(data);
        Utils.toast('Boost task added');
      }

      hide('boost-modal');
      window.Router.rerender();
    });
  }

  // ---- CLIENT MODAL -----------------------------------------------------------
  function openClientModal(client) {
    document.getElementById('client-modal-title').textContent = client ? 'Edit Client' : 'Add Client';
    document.getElementById('client-id').value = client ? client.id : '';
    document.getElementById('client-name').value = client ? client.name : '';
    document.getElementById('client-budget').value = client ? client.monthlyBudget : '';
    show('client-modal');
  }

  function bindClientFormListeners() {
    document.getElementById('client-save-btn').addEventListener('click', async () => {
      const form = document.getElementById('client-form');
      if (!form.reportValidity()) return;

      const id = document.getElementById('client-id').value;
      const data = {
        name: document.getElementById('client-name').value.trim(),
        monthlyBudget: Number(document.getElementById('client-budget').value) || 0,
      };

      if (id) {
        await DB.updateClient(id, data);
        Utils.toast('Client updated');
      } else {
        await DB.addClient(data);
        Utils.toast('Client added');
      }

      hide('client-modal');
      window.Router.rerender();
    });
  }

  // ---- CLOSE MONTH MODAL --------------------------------------------------------
  function openCloseMonthModal() {
    show('close-month-modal');
  }

  function bindCloseMonthListeners() {
    document.getElementById('confirm-close-month-btn').addEventListener('click', async () => {
      await DB.closeMonth();
      Utils.toast('Month closed and archived');
      hide('close-month-modal');
      window.Router.rerender();
    });
  }

  // ---- TEAM MEMBER MODAL --------------------------------------------------------
  // Edit-only: team members are created automatically when someone signs up
  // with an @inhaus.ae account (see supabase_schema.sql), so this modal is
  // never opened in "add" mode anymore — just lets someone fix their
  // auto-generated display name or pick a different avatar color.
  function openTeamModal(member) {
    if (!member) return;
    document.getElementById('team-modal-title').textContent = 'Edit Team Member';
    document.getElementById('team-id').value = member.id;
    document.getElementById('team-name').value = member.name;
    document.getElementById('team-email-display').textContent = member.email || '';
    const chosenColor = member.color || TEAM_COLORS[0];
    document.getElementById('team-color').value = chosenColor;

    const swatchContainer = document.getElementById('team-color-swatches');
    swatchContainer.innerHTML = TEAM_COLORS.map((c) => `
      <button type="button" class="color-swatch ${c === chosenColor ? 'selected' : ''}" data-color="${c}" style="background:${c}"></button>
    `).join('');

    swatchContainer.querySelectorAll('.color-swatch').forEach((sw) => {
      sw.addEventListener('click', () => {
        swatchContainer.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('selected'));
        sw.classList.add('selected');
        document.getElementById('team-color').value = sw.dataset.color;
      });
    });

    show('team-modal');
  }

  function bindTeamFormListeners() {
    document.getElementById('team-save-btn').addEventListener('click', async () => {
      const form = document.getElementById('team-form');
      if (!form.reportValidity()) return;

      const id = document.getElementById('team-id').value;
      const data = {
        name: document.getElementById('team-name').value.trim(),
        color: document.getElementById('team-color').value,
      };

      await DB.updateTeamMember(id, data);
      Utils.toast('Team member updated');

      hide('team-modal');
      window.Router.rerender();
    });
  }

  function init() {
    bindCloseButtons();
    bindBoostFormListeners();
    bindClientFormListeners();
    bindCloseMonthListeners();
    bindTeamFormListeners();
  }

  return { init, openBoostModal, openClientModal, openCloseMonthModal, openTeamModal };
})();

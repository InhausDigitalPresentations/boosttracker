/* ==========================================================================
   SETTINGSVIEW.JS — team member roster management
   ========================================================================== */

window.Views = window.Views || {};

window.Views.settings = async function (container) {
  const teamMembers = await DB.getTeamMembers();

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Settings</h1>
        <p class="page-subtitle">Manage the team members boosts can be assigned to</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary" id="add-team-member-btn">+ Add Team Member</button>
      </div>
    </div>

    <div class="section-heading">Team Members</div>

    <div class="team-grid" id="team-grid">
      ${teamMembers.length ? teamMembers.map(teamMemberCard).join('') : `<div class="empty-state"><p>No team members yet.</p></div>`}
    </div>

    <div class="section-heading" style="margin-top:32px;">About</div>
    <div class="detail-summary-card">
      <p class="text-muted">Inhaus Boost Tracker is an internal operations tool for assigning boosted posts, tracking client boosting budgets, and archiving months for invoicing. Data is currently stored locally in this browser; the data layer (<code>db.js</code>) is structured so it can be swapped for a real Supabase backend without changing the rest of the app.</p>
    </div>
  `;

  document.getElementById('fab-add-boost').style.display = 'none';

  container.querySelector('#add-team-member-btn').addEventListener('click', () => {
    Modals.openTeamModal(null);
  });

  container.querySelectorAll('[data-action="edit-member"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const members = await DB.getTeamMembers();
      const member = members.find((m) => m.id === btn.dataset.id);
      Modals.openTeamModal(member);
    });
  });

  container.querySelectorAll('[data-action="delete-member"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this team member? Existing boosts keep their assignment history but will show as unassigned.')) return;
      await DB.deleteTeamMember(btn.dataset.id);
      Utils.toast('Team member removed');
      window.Router.rerender();
    });
  });
};

function teamMemberCard(member) {
  return `
    <div class="team-card">
      <span class="avatar" style="background:${member.color}">${Utils.initials(member.name)}</span>
      <span class="team-card-name">${Utils.escapeHtml(member.name)}</span>
      <div class="team-card-actions">
        <button class="btn-icon" data-action="edit-member" data-id="${member.id}" title="Edit">✎</button>
        <button class="btn-icon danger" data-action="delete-member" data-id="${member.id}" title="Remove">🗑</button>
      </div>
    </div>
  `;
}

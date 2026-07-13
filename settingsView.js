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
        <p class="page-subtitle">Everyone who has logged in with an @inhaus.ae account — boosts can be assigned to any of them</p>
      </div>
    </div>

    <div class="section-heading">Team Members</div>

    <div class="team-grid" id="team-grid">
      ${teamMembers.length ? teamMembers.map(teamMemberCard).join('') : `<div class="empty-state"><p>Nobody has logged in yet.</p></div>`}
    </div>
    <p class="text-muted" style="margin-top:8px;">To add someone, have them sign up on the login screen with their @inhaus.ae email — they'll appear here automatically. To remove someone's access, delete their account from the Supabase dashboard (Authentication &gt; Users).</p>

    <div class="section-heading" style="margin-top:32px;">About</div>
    <div class="detail-summary-card">
      <p class="text-muted">Inhaus Boost Tracker is an internal operations tool for assigning boosted posts, tracking client boosting budgets, and archiving months for invoicing. Data is currently stored locally in this browser; the data layer (<code>db.js</code>) is structured so it can be swapped for a real Supabase backend without changing the rest of the app.</p>
    </div>
  `;

  document.getElementById('fab-add-boost').style.display = 'none';

  container.querySelectorAll('[data-action="edit-member"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const members = await DB.getTeamMembers();
      const member = members.find((m) => m.id === btn.dataset.id);
      Modals.openTeamModal(member);
    });
  });
};

function teamMemberCard(member) {
  return `
    <div class="team-card">
      <span class="avatar" style="background:${member.color}">${Utils.initials(member.name)}</span>
      <div class="team-card-info">
        <span class="team-card-name">${Utils.escapeHtml(member.name)}</span>
        <span class="team-card-email text-muted">${Utils.escapeHtml(member.email || '')}</span>
      </div>
      <div class="team-card-actions">
        <button class="btn-icon" data-action="edit-member" data-id="${member.id}" title="Edit">✎</button>
      </div>
    </div>
  `;
}

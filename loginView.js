/* ==========================================================================
   LOGINVIEW.JS — email/password sign in + sign up, gated to @inhaus.ae
   ==========================================================================
   Rendered directly by main.js (outside the normal hash-router) whenever
   there's no active session. Manages its own tiny bit of local state
   (sign-in vs. create-account mode, inline status message) and re-renders
   itself into the same container on every change.
   ========================================================================== */

window.LoginView = (function () {
  let mode = 'signin'; // 'signin' | 'signup'
  let statusMessage = null; // { type: 'error' | 'info', text }

  function render(container) {
    const domain = window.Auth.ALLOWED_DOMAIN;

    container.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card">
          <img src="logo.svg" alt="Inhaus" class="auth-logo" />
          <h2 class="auth-title">${mode === 'signin' ? 'Sign in' : 'Create your account'}</h2>
          <p class="auth-subtitle">Boost Tracker is restricted to <strong>@${Utils.escapeHtml(domain)}</strong> team members.</p>

          ${statusMessage ? `<div class="auth-message ${statusMessage.type === 'error' ? 'auth-message-error' : 'auth-message-info'}">${Utils.escapeHtml(statusMessage.text)}</div>` : ''}

          <form id="auth-form">
            <div class="form-group">
              <label for="auth-email">Work email</label>
              <input type="email" id="auth-email" placeholder="you@${Utils.escapeHtml(domain)}" autocomplete="email" required />
            </div>
            <div class="form-group">
              <label for="auth-password">Password</label>
              <input type="password" id="auth-password" minlength="6" placeholder="At least 6 characters" autocomplete="${mode === 'signin' ? 'current-password' : 'new-password'}" required />
            </div>
            <button type="submit" class="btn btn-primary auth-submit" id="auth-submit-btn">
              ${mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <button class="auth-toggle" id="auth-toggle-btn" type="button">
            ${mode === 'signin' ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    `;

    container.querySelector('#auth-toggle-btn').addEventListener('click', () => {
      mode = mode === 'signin' ? 'signup' : 'signin';
      statusMessage = null;
      render(container);
    });

    container.querySelector('#auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = container.querySelector('#auth-email').value.trim();
      const password = container.querySelector('#auth-password').value;
      const btn = container.querySelector('#auth-submit-btn');
      btn.disabled = true;
      btn.textContent = mode === 'signin' ? 'Signing in…' : 'Creating account…';

      try {
        if (mode === 'signin') {
          await window.Auth.signIn(email, password);
          // window.Auth.onAuthStateChange (wired up in main.js) takes it from here
        } else {
          const result = await window.Auth.signUp(email, password);
          if (result.session) {
            // email confirmations are off for this project — signed in immediately
            return;
          }
          statusMessage = { type: 'info', text: 'Account created — check your inbox to confirm your email, then sign in.' };
          mode = 'signin';
          render(container);
        }
      } catch (err) {
        statusMessage = { type: 'error', text: (err && err.message) || String(err) };
        render(container);
      }
    });
  }

  return { render };
})();

/* ==========================================================================
   AUTH.JS — email/password login, gated to @inhaus.ae addresses
   ==========================================================================
   The @inhaus.ae domain restriction is enforced SERVER-SIDE by a Supabase
   "Before User Created" Auth Hook (see supabase_schema.sql +
   hook_restrict_signup_domain) — this file's own domain check is just a
   friendlier, instant error message. Removing it wouldn't open a security
   hole; the real gate is in the database.

   Uses the exact same Supabase client instance as db.js (via
   DB.getRawClient()) so the logged-in session is shared everywhere —
   auth.js only concerns itself with *who* is signed in, db.js still owns
   *what* they can do with the data.
   ========================================================================== */

window.Auth = (function () {
  const ALLOWED_DOMAIN = 'inhaus.ae';

  function isAllowedEmail(email) {
    return (email || '').trim().toLowerCase().endsWith('@' + ALLOWED_DOMAIN);
  }

  async function signUp(email, password) {
    if (!isAllowedEmail(email)) {
      throw new Error(`Only @${ALLOWED_DOMAIN} email addresses can create an account.`);
    }
    const { data, error } = await window.DB.getRawClient().auth.signUp({ email, password });
    if (error) throw new Error(error.message);
    return data;
  }

  async function signIn(email, password) {
    const { data, error } = await window.DB.getRawClient().auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return data;
  }

  async function signOut() {
    const { error } = await window.DB.getRawClient().auth.signOut();
    if (error) throw new Error(error.message);
  }

  async function getSession() {
    const { data, error } = await window.DB.getRawClient().auth.getSession();
    if (error) throw new Error(error.message);
    return data.session;
  }

  function onAuthStateChange(callback) {
    return window.DB.getRawClient().auth.onAuthStateChange((event, session) => callback(event, session));
  }

  return { ALLOWED_DOMAIN, isAllowedEmail, signUp, signIn, signOut, getSession, onAuthStateChange };
})();

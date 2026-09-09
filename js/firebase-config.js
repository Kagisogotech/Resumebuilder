/* ============================================================
   firebase-config.js — your Firebase project's identifiers

   ── Paste your config below. See FIREBASE_SETUP.md. ──────────

   These values are NOT secrets. Firebase config is designed to be
   shipped in public client code — the apiKey is a project
   identifier, not a credential, and Google's own docs say to
   commit it. What actually protects your data is the Firestore
   security rules in firestore.rules, which only let a signed-in
   user touch documents under their own user id.

   So: committing this file is correct. Deploying the rules is
   what matters. Without them, anyone could read every CV.

   While these fields are blank the app simply runs in local-only
   mode — nothing breaks, cloud sync is just unavailable.
   ============================================================ */

window.RB = window.RB || {};

RB.firebaseConfig = {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: ''
};

/* True once the config above is filled in. The UI uses this to
   decide whether to offer cloud accounts or local PIN profiles. */
RB.cloudConfigured = function () {
    var c = RB.firebaseConfig;
    return !!(c && c.apiKey && c.projectId && c.authDomain);
};

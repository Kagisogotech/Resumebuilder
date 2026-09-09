/* ============================================================
   firebase-config.js — your Firebase project's identifiers

   ── Paste your config VALUES below. See FIREBASE_SETUP.md. ───

   ⚠ Copy only the six values into RB.firebaseConfig below. Do NOT
   paste the whole snippet the Firebase console shows you. That
   snippet is written for a bundler and looks like this:

       import { initializeApp } from "firebase/app";   <-- breaks it
       const firebaseConfig = { ... };                 <-- wrong name
       const app = initializeApp(firebaseConfig);      <-- done for you

   This app loads Firebase as a plain <script>, so an `import`
   statement here is a syntax error that stops the entire file from
   parsing. The app is initialised for you in js/store-cloud.js.
   Only the values matter, and they must be on RB.firebaseConfig.

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
    apiKey: 'AIzaSyCv3mJZi8TgsFzal8OMq5jywPWzFAZw3G0',
    authDomain: 'nene-cv-platform.firebaseapp.com',
    projectId: 'nene-cv-platform',
    storageBucket: 'nene-cv-platform.firebasestorage.app',
    messagingSenderId: '162394084099',
    appId: '1:162394084099:web:4de80702d421a10d0b4f36'
};

/* True once the config above is filled in. The UI uses this to
   decide whether to offer cloud accounts or local PIN profiles. */
RB.cloudConfigured = function () {
    var c = RB.firebaseConfig;
    return !!(c && c.apiKey && c.projectId && c.authDomain);
};

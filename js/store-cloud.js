/* ============================================================
   store-cloud.js — Firebase Auth + Firestore

   Provides two things:

     1. RB.cloud.auth  — real accounts: email/password, Google,
        password reset by email, email verification.
     2. RB.cloud.driver — a data driver implementing the same
        resume methods as the local drivers in store.js, so the
        rest of the app is unaware of which one is in use.

   Firestore layout:

       users/{uid}/resumes/{resumeId}
           { name, template, data, createdAt, updatedAt }

   Every document lives under the owner's uid, which is what makes
   the security rules trivial to get right: a user may read and
   write users/{their own uid}/** and nothing else. See
   firestore.rules.

   ── What changes for the user ─────────────────────────────────
   Signing in means CVs are stored on Google's servers rather than
   only in the browser. That is the whole point — it is how they
   reach another device — but it is a genuine change in where the
   data lives, and the UI says so rather than glossing over it.
   Guest mode remains local-only for anyone who would rather not.
   ── ───────────────────────────────────────────────────────────
   ============================================================ */

(function (RB) {
    'use strict';

    var u = RB.util;

    var app = null;
    var auth = null;
    var db = null;
    var initError = null;
    var persistenceNote = '';

    /* ---------- availability ---------- */

    function sdkPresent() {
        return !!(window.firebase &&
                  window.firebase.initializeApp &&
                  window.firebase.auth &&
                  window.firebase.firestore);
    }

    /* Defensive on purpose. If js/firebase-config.js fails to parse —
       the classic being pasting Firebase's ES-module snippet, whose
       `import` statement is a syntax error in a plain script — then
       RB.cloudConfigured never gets defined. Calling it blind threw a
       TypeError during boot and took the whole editor down with it:
       no CV loaded, no score, blank header. A broken config must cost
       you cloud sync, never the app. */
    function configOk() {
        try {
            return typeof RB.cloudConfigured === 'function' && RB.cloudConfigured() === true;
        } catch (e) {
            return false;
        }
    }

    function available() {
        return sdkPresent() && configOk();
    }

    /* Why cloud is unavailable, in words a user can act on. */
    function unavailableReason() {
        if (typeof RB.cloudConfigured !== 'function') {
            return 'js/firebase-config.js did not load. If you pasted the snippet from the ' +
                   'Firebase console, remove its "import" and "initializeApp" lines — this app ' +
                   'loads Firebase as a plain script, so only the config values belong in that ' +
                   'file, assigned to RB.firebaseConfig. See FIREBASE_SETUP.md.';
        }
        if (!configOk()) {
            return 'Cloud accounts are not set up for this copy of the app. ' +
                   'Paste your Firebase config into js/firebase-config.js — see FIREBASE_SETUP.md.';
        }
        if (!sdkPresent()) {
            return 'The Firebase libraries could not be loaded. Check your internet connection.';
        }
        if (initError) return initError;
        return '';
    }

    function init() {
        if (!available()) return Promise.resolve(false);
        if (app) return Promise.resolve(true);

        try {
            app = window.firebase.initializeApp(RB.firebaseConfig);
            auth = window.firebase.auth();
            db = window.firebase.firestore();
        } catch (e) {
            initError = 'Firebase failed to start: ' + (e.message || e);
            app = null;
            return Promise.resolve(false);
        }

        /* Offline cache. Lets a signed-in user keep editing on a bad
           connection, with writes flushed when it returns. Fails
           harmlessly when several tabs are open, so never block on it. */
        return db.enablePersistence({ synchronizeTabs: true })
            .then(function () { return true; })
            .catch(function (err) {
                if (err && err.code === 'failed-precondition') {
                    persistenceNote = 'Offline editing is off because the app is open in ' +
                        'another tab. Everything still saves while you are online.';
                } else if (err && err.code === 'unimplemented') {
                    persistenceNote = 'This browser does not support offline editing. ' +
                        'Everything still saves while you are online.';
                }
                return true;
            });
    }

    /* ---------- error translation ----------
       Firebase error codes are useless to a person. Every one of
       these is a message that tells the user what to do next. */

    var AUTH_MESSAGES = {
        'auth/invalid-email': 'That email address is not valid.',
        'auth/user-disabled': 'That account has been disabled.',
        'auth/user-not-found': 'No account exists for that email address.',
        'auth/wrong-password': 'Incorrect password.',
        'auth/invalid-credential': 'That email and password combination is not correct.',
        'auth/invalid-login-credentials': 'That email and password combination is not correct.',
        'auth/email-already-in-use': 'An account already exists for that email address. Try signing in instead.',
        'auth/weak-password': 'That password is too weak. Use at least 8 characters.',
        'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
        'auth/network-request-failed': 'Could not reach the server. Check your internet connection.',
        'auth/popup-closed-by-user': 'The Google sign-in window was closed before finishing.',
        'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups for this site, or use email and password.',
        'auth/cancelled-popup-request': 'Sign-in was cancelled.',
        'auth/account-exists-with-different-credential':
            'You already have an account with that email using a different sign-in method. ' +
            'Sign in the original way, then link Google from your profile.',
        'auth/operation-not-allowed':
            'That sign-in method is not enabled on the Firebase project. Enable it under ' +
            'Authentication → Sign-in method in the Firebase console.',
        'auth/unauthorized-domain':
            'This domain is not authorised for sign-in. Add it under Authentication → ' +
            'Settings → Authorized domains in the Firebase console.',
        'auth/requires-recent-login':
            'For security this needs a fresh sign-in. Sign out, sign back in, and try again.',

        /* Setup-time mistakes. These are the ones the person wiring
           up Firebase will actually hit, so they name the fix. */
        'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
            'That Firebase API key is not valid. Check the apiKey in js/firebase-config.js ' +
            'matches your project exactly — see FIREBASE_SETUP.md.',
        'auth/api-key-not-valid':
            'That Firebase API key is not valid. Check the apiKey in js/firebase-config.js ' +
            'matches your project exactly — see FIREBASE_SETUP.md.',
        'auth/invalid-api-key':
            'That Firebase API key is not valid. Check the apiKey in js/firebase-config.js.',
        'auth/configuration-not-found':
            'Firebase Authentication is not set up on this project yet. In the Firebase console, ' +
            'open Authentication, click "Get started", and enable Email/Password.',
        'auth/project-not-found':
            'That Firebase project was not found. Check the projectId in js/firebase-config.js.',
        'auth/invalid-user-token': 'Your session expired. Please sign in again.',
        'auth/user-token-expired': 'Your session expired. Please sign in again.',
        'permission-denied':
            'The database refused that request. This usually means the Firestore security ' +
            'rules have not been deployed — see FIREBASE_SETUP.md.',
        'unavailable': 'Could not reach the database. Check your internet connection.',
        'failed-precondition':
            'Firestore is not ready. Make sure you created a Firestore database in the ' +
            'Firebase console (not just the project).'
    };

    function friendly(err) {
        var code = u.trim(err && err.code).toLowerCase();
        if (AUTH_MESSAGES[code]) return new Error(AUTH_MESSAGES[code]);

        /* Some SDK builds put the code only in the message, as
           "Firebase: Error (auth/whatever)." — dig it out and retry
           the lookup before giving up. */
        var raw = (err && err.message) || '';
        var embedded = /\(((?:auth|firestore)\/[a-z0-9-.]+)\)/i.exec(raw);
        if (embedded) {
            var found = embedded[1].toLowerCase();
            if (AUTH_MESSAGES[found]) return new Error(AUTH_MESSAGES[found]);
            code = code || found;
        }

        /* Never surface a raw "Firebase: Error (…)" string: it tells a
           job seeker nothing and looks broken. Say something useful and
           keep the code for whoever has to debug it. */
        var cleaned = raw
            .replace(/^Firebase:\s*/i, '')
            .replace(/\s*\((?:auth|firestore)\/[a-z0-9-.]+\)\.?\s*$/i, '')
            .trim();

        if (!cleaned || /^error$/i.test(cleaned)) {
            cleaned = 'Something went wrong reaching the server.';
        }
        return new Error(cleaned + (code ? ' (' + code + ')' : ''));
    }

    /* ---------- auth ---------- */

    function requireAuth() {
        if (!auth) throw new Error(unavailableReason() || 'Cloud accounts are unavailable.');
        return auth;
    }

    function publicUser(fbUser) {
        if (!fbUser) return null;
        return {
            uid: fbUser.uid,
            email: fbUser.email || '',
            displayName: fbUser.displayName || (fbUser.email || '').split('@')[0] || 'Account',
            emailVerified: !!fbUser.emailVerified,
            providers: (fbUser.providerData || []).map(function (p) { return p.providerId; }),
            cloud: true
        };
    }

    function validatePassword(password) {
        var p = String(password || '');
        if (p.length < 8) return 'Use at least 8 characters.';
        if (/^\d+$/.test(p)) return 'Use more than just digits.';
        if (/^(password|12345678|qwerty|letmein|iloveyou)/i.test(p)) {
            return 'That password is too common. Choose something less guessable.';
        }
        return null;
    }

    function signUp(email, password, displayName) {
        var a;
        try { a = requireAuth(); } catch (e) { return Promise.reject(e); }

        var problem = validatePassword(password);
        if (problem) return Promise.reject(new Error(problem));

        return a.createUserWithEmailAndPassword(u.trim(email), password)
            .then(function (cred) {
                var name = u.trim(displayName);
                var next = name
                    ? cred.user.updateProfile({ displayName: name })
                    : Promise.resolve();
                // Verification is sent but never enforced: locking someone
                // out of their own CV over an unread email is hostile.
                return next
                    .then(function () { return cred.user.sendEmailVerification(); })
                    .catch(function () { /* non-fatal */ })
                    .then(function () { return publicUser(a.currentUser); });
            })
            .catch(function (err) { throw friendly(err); });
    }

    function signIn(email, password) {
        var a;
        try { a = requireAuth(); } catch (e) { return Promise.reject(e); }
        return a.signInWithEmailAndPassword(u.trim(email), password)
            .then(function (cred) { return publicUser(cred.user); })
            .catch(function (err) { throw friendly(err); });
    }

    function signInWithGoogle() {
        var a;
        try { a = requireAuth(); } catch (e) { return Promise.reject(e); }
        var provider = new window.firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        return a.signInWithPopup(provider)
            .then(function (cred) { return publicUser(cred.user); })
            .catch(function (err) { throw friendly(err); });
    }

    function sendPasswordReset(email) {
        var a;
        try { a = requireAuth(); } catch (e) { return Promise.reject(e); }
        return a.sendPasswordResetEmail(u.trim(email))
            .catch(function (err) { throw friendly(err); });
    }

    function resendVerification() {
        var a;
        try { a = requireAuth(); } catch (e) { return Promise.reject(e); }
        if (!a.currentUser) return Promise.reject(new Error('Not signed in.'));
        return a.currentUser.sendEmailVerification()
            .catch(function (err) { throw friendly(err); });
    }

    function signOutCloud() {
        if (!auth) return Promise.resolve();
        return auth.signOut().catch(function () { /* already gone */ });
    }

    function currentUser() {
        return auth ? publicUser(auth.currentUser) : null;
    }

    function isSignedIn() {
        return !!(auth && auth.currentUser);
    }

    /* Fires immediately with the restored session, then on change. */
    function onAuthChanged(callback) {
        if (!auth) { callback(null); return function () {}; }
        return auth.onAuthStateChanged(function (fbUser) {
            callback(publicUser(fbUser));
        });
    }

    /* Deleting an account must also delete its data. Firebase removes
       the auth record but leaves Firestore documents orphaned, so the
       CVs are cleared first — otherwise "delete my account" silently
       leaves the user's CVs on Google's servers. */
    function deleteAccount(password) {
        var a;
        try { a = requireAuth(); } catch (e) { return Promise.reject(e); }
        var user = a.currentUser;
        if (!user) return Promise.reject(new Error('Not signed in.'));

        var reauth;
        var usesPassword = (user.providerData || []).some(function (p) {
            return p.providerId === 'password';
        });

        if (usesPassword) {
            if (!password) return Promise.reject(new Error('Enter your password to confirm.'));
            var cred = window.firebase.auth.EmailAuthProvider.credential(user.email, password);
            reauth = user.reauthenticateWithCredential(cred);
        } else {
            var provider = new window.firebase.auth.GoogleAuthProvider();
            reauth = user.reauthenticateWithPopup(provider);
        }

        return reauth
            .then(function () { return deleteAllResumes(user.uid); })
            .then(function () { return user.delete(); })
            .catch(function (err) { throw friendly(err); });
    }

    function deleteAllResumes(uid) {
        return collectionRef(uid).get().then(function (snap) {
            var batch = db.batch();
            snap.forEach(function (doc) { batch.delete(doc.ref); });
            return batch.commit();
        });
    }

    /* ---------- data driver ---------- */

    function collectionRef(uid) {
        return db.collection('users').doc(uid).collection('resumes');
    }

    function activeUid() {
        if (!auth || !auth.currentUser) throw new Error('Not signed in.');
        return auth.currentUser.uid;
    }

    function toRecord(doc) {
        var d = doc.data() || {};
        return {
            id: doc.id,
            owner: d.owner || '',
            name: d.name || 'Untitled CV',
            template: d.template || 'modern',
            data: d.data || RB.model.blankResume(),
            createdAt: d.createdAt || 0,
            updatedAt: d.updatedAt || 0
        };
    }

    var driver = {
        name: 'firestore',

        open: function () { return init(); },

        /* Cloud identity comes from Firebase Auth, so the local
           PIN-profile methods are deliberately inert here. */
        getUser: function () { return Promise.resolve(null); },
        putUser: function () { return Promise.resolve(); },
        deleteUser: function () { return Promise.resolve(); },
        allUsers: function () { return Promise.resolve([]); },

        getResume: function (id) {
            var uid;
            try { uid = activeUid(); } catch (e) { return Promise.reject(e); }
            return collectionRef(uid).doc(id).get()
                .then(function (doc) { return doc.exists ? toRecord(doc) : null; })
                .catch(function (err) { throw friendly(err); });
        },

        putResume: function (record) {
            var uid;
            try { uid = activeUid(); } catch (e) { return Promise.reject(e); }
            return collectionRef(uid).doc(record.id).set({
                owner: uid,
                name: record.name,
                template: record.template,
                data: record.data,
                createdAt: record.createdAt || Date.now(),
                updatedAt: record.updatedAt || Date.now()
            }).catch(function (err) { throw friendly(err); });
        },

        deleteResume: function (id) {
            var uid;
            try { uid = activeUid(); } catch (e) { return Promise.reject(e); }
            return collectionRef(uid).doc(id).delete()
                .catch(function (err) { throw friendly(err); });
        },

        resumesByOwner: function () {
            var uid;
            try { uid = activeUid(); } catch (e) { return Promise.reject(e); }
            return collectionRef(uid).get()
                .then(function (snap) {
                    var out = [];
                    snap.forEach(function (doc) { out.push(toRecord(doc)); });
                    return out;
                })
                .catch(function (err) { throw friendly(err); });
        }
    };

    RB.cloud = {
        available: available,
        unavailableReason: unavailableReason,
        persistenceNote: function () { return persistenceNote; },
        init: init,
        driver: driver,
        validatePassword: validatePassword,
        auth: {
            signUp: signUp,
            signIn: signIn,
            signInWithGoogle: signInWithGoogle,
            sendPasswordReset: sendPasswordReset,
            resendVerification: resendVerification,
            signOut: signOutCloud,
            currentUser: currentUser,
            isSignedIn: isSignedIn,
            onAuthChanged: onAuthChanged,
            deleteAccount: deleteAccount
        }
    };
})(window.RB);

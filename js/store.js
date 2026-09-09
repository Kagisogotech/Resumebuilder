/* ============================================================
   store.js — local accounts and saved CVs

   ── Be clear about the security model ─────────────────────────
   These are LOCAL profiles, not real authentication. Everything
   lives in this browser on this device. The PIN keeps casual
   users out of each other's CVs on a shared machine; it is
   PBKDF2-stretched and never stored in plain text, but anyone
   with developer tools can read the stored records directly.
   It is separation of profiles, not protection of secrets.
   Don't put anything genuinely sensitive in a CV field.

   Swapping in real cloud auth later means writing one more
   driver with the same nine methods — see DRIVER CONTRACT below.
   ── ───────────────────────────────────────────────────────────

   Records:
     user   { username, displayName, salt, hash, iterations, weak, createdAt }
     resume { id, owner, name, template, data, createdAt, updatedAt }

   `owner` is the username, or "__guest__" when nobody is signed
   in, so the app is fully usable without ever making an account.
   ============================================================ */

(function (RB) {
    'use strict';

    var u = RB.util;

    var DB_NAME = 'smart_resume_builder';
    var DB_VERSION = 1;
    var STORE_USERS = 'users';
    var STORE_RESUMES = 'resumes';

    var SESSION_KEY = 'rb.session';
    var LS_PREFIX = 'rb.fallback.';
    var GUEST = '__guest__';

    var PBKDF2_ITERATIONS = 150000;

    var driver = null;      // local driver, chosen at init()
    var driverName = '';
    var session = null;     // { username } for local PIN profiles
    var cloudUser = null;   // set when a Firebase account is signed in

    /* Which driver reads and writes CVs right now. Signing in to a
       cloud account switches the whole app over without any other
       module knowing. */
    function activeDriver() {
        if (cloudUser && RB.cloud && RB.cloud.available()) return RB.cloud.driver;
        return driver;
    }

    function mode() {
        return cloudUser ? 'cloud' : 'local';
    }

    /* ============================================================
       DRIVER CONTRACT
       Each driver implements:
         open()                          -> Promise
         getUser(username)               -> Promise<user|null>
         putUser(user)                   -> Promise
         deleteUser(username)            -> Promise
         allUsers()                      -> Promise<user[]>
         getResume(id)                   -> Promise<resume|null>
         putResume(resume)               -> Promise
         deleteResume(id)                -> Promise
         resumesByOwner(owner)           -> Promise<resume[]>
       ============================================================ */

    /* ---------- driver A: IndexedDB ---------- */

    function idbDriver() {
        var db = null;

        function tx(storeName, mode) {
            return db.transaction(storeName, mode).objectStore(storeName);
        }

        function wrap(request) {
            return new Promise(function (resolve, reject) {
                request.onsuccess = function () { resolve(request.result); };
                request.onerror = function () { reject(request.error); };
            });
        }

        return {
            name: 'indexeddb',

            open: function () {
                return new Promise(function (resolve, reject) {
                    if (!window.indexedDB) return reject(new Error('No IndexedDB'));

                    var req;
                    try {
                        req = window.indexedDB.open(DB_NAME, DB_VERSION);
                    } catch (e) {
                        return reject(e);
                    }

                    req.onupgradeneeded = function (event) {
                        var database = event.target.result;
                        if (!database.objectStoreNames.contains(STORE_USERS)) {
                            database.createObjectStore(STORE_USERS, { keyPath: 'username' });
                        }
                        if (!database.objectStoreNames.contains(STORE_RESUMES)) {
                            var os = database.createObjectStore(STORE_RESUMES, { keyPath: 'id' });
                            os.createIndex('owner', 'owner', { unique: false });
                        }
                    };
                    req.onsuccess = function () { db = req.result; resolve(); };
                    req.onerror = function () { reject(req.error); };
                    req.onblocked = function () { reject(new Error('IndexedDB blocked')); };

                    // Some browsers hang instead of firing onerror on file://
                    setTimeout(function () {
                        if (!db) reject(new Error('IndexedDB open timed out'));
                    }, 3000);
                });
            },

            getUser: function (username) {
                return wrap(tx(STORE_USERS, 'readonly').get(username))
                    .then(function (r) { return r || null; });
            },
            putUser: function (user) {
                return wrap(tx(STORE_USERS, 'readwrite').put(user));
            },
            deleteUser: function (username) {
                return wrap(tx(STORE_USERS, 'readwrite').delete(username));
            },
            allUsers: function () {
                return wrap(tx(STORE_USERS, 'readonly').getAll())
                    .then(function (r) { return r || []; });
            },
            getResume: function (id) {
                return wrap(tx(STORE_RESUMES, 'readonly').get(id))
                    .then(function (r) { return r || null; });
            },
            putResume: function (record) {
                return wrap(tx(STORE_RESUMES, 'readwrite').put(record));
            },
            deleteResume: function (id) {
                return wrap(tx(STORE_RESUMES, 'readwrite').delete(id));
            },
            resumesByOwner: function (owner) {
                return wrap(tx(STORE_RESUMES, 'readonly').index('owner').getAll(owner))
                    .then(function (r) { return r || []; });
            }
        };
    }

    /* ---------- driver B: localStorage ----------
       Same contract, used when IndexedDB is unavailable (private
       mode, or a browser that blocks it on file:// origins). */

    function localDriver() {
        function read(key, fallback) {
            try {
                var raw = localStorage.getItem(LS_PREFIX + key);
                return raw ? JSON.parse(raw) : fallback;
            } catch (e) {
                return fallback;
            }
        }
        function write(key, value) {
            localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
        }

        return {
            name: 'localstorage',

            open: function () {
                // Confirm localStorage actually works before committing to it.
                return new Promise(function (resolve, reject) {
                    try {
                        localStorage.setItem(LS_PREFIX + '__probe', '1');
                        localStorage.removeItem(LS_PREFIX + '__probe');
                        resolve();
                    } catch (e) {
                        reject(new Error('No usable local storage'));
                    }
                });
            },

            getUser: function (username) {
                return Promise.resolve(read('users', {})[username] || null);
            },
            putUser: function (user) {
                var users = read('users', {});
                users[user.username] = user;
                write('users', users);
                return Promise.resolve();
            },
            deleteUser: function (username) {
                var users = read('users', {});
                delete users[username];
                write('users', users);
                return Promise.resolve();
            },
            allUsers: function () {
                var users = read('users', {});
                return Promise.resolve(Object.keys(users).map(function (k) { return users[k]; }));
            },
            getResume: function (id) {
                return Promise.resolve(read('resumes', {})[id] || null);
            },
            putResume: function (record) {
                var all = read('resumes', {});
                all[record.id] = record;
                write('resumes', all);
                return Promise.resolve();
            },
            deleteResume: function (id) {
                var all = read('resumes', {});
                delete all[id];
                write('resumes', all);
                return Promise.resolve();
            },
            resumesByOwner: function (owner) {
                var all = read('resumes', {});
                return Promise.resolve(Object.keys(all)
                    .map(function (k) { return all[k]; })
                    .filter(function (r) { return r.owner === owner; }));
            }
        };
    }

    /* ---------- PIN hashing ---------- */

    function randomSaltHex() {
        var bytes = new Uint8Array(16);
        if (window.crypto && window.crypto.getRandomValues) {
            window.crypto.getRandomValues(bytes);
        } else {
            for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
        }
        return bytesToHex(bytes);
    }

    function bytesToHex(bytes) {
        var out = '';
        for (var i = 0; i < bytes.length; i++) {
            out += ('0' + bytes[i].toString(16)).slice(-2);
        }
        return out;
    }

    function hexToBytes(hex) {
        var out = new Uint8Array(hex.length / 2);
        for (var i = 0; i < out.length; i++) {
            out[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        return out;
    }

    var subtle = (window.crypto && window.crypto.subtle) || null;

    /* Returns { hash, iterations, weak }. `weak` flags the
       non-WebCrypto fallback so the UI can be honest about it. */
    function hashPin(pin, saltHex, iterations) {
        var iters = iterations || PBKDF2_ITERATIONS;

        if (subtle && subtle.importKey && subtle.deriveBits) {
            var enc = new TextEncoder();
            return subtle.importKey('raw', enc.encode(pin), { name: 'PBKDF2' }, false, ['deriveBits'])
                .then(function (key) {
                    return subtle.deriveBits({
                        name: 'PBKDF2',
                        salt: hexToBytes(saltHex),
                        iterations: iters,
                        hash: 'SHA-256'
                    }, key, 256);
                })
                .then(function (bits) {
                    return { hash: bytesToHex(new Uint8Array(bits)), iterations: iters, weak: false };
                })
                .catch(function () {
                    return { hash: weakHash(pin, saltHex, iters), iterations: iters, weak: true };
                });
        }

        return Promise.resolve({ hash: weakHash(pin, saltHex, iters), iterations: iters, weak: true });
    }

    /* Fallback only. An iterated FNV-1a — obfuscation, not
       cryptography. Reached only where WebCrypto is missing. */
    function weakHash(pin, saltHex, iterations) {
        var input = saltHex + ':' + pin;
        var h1 = 0x811c9dc5, h2 = 0x01000193;
        var rounds = Math.min(iterations, 20000);
        for (var r = 0; r < rounds; r++) {
            for (var i = 0; i < input.length; i++) {
                h1 ^= input.charCodeAt(i);
                h1 = (h1 * 0x01000193) >>> 0;
                h2 = ((h2 << 5) - h2 + h1) >>> 0;
            }
            input = h1.toString(16) + h2.toString(16) + saltHex;
        }
        return ('00000000' + h1.toString(16)).slice(-8) +
               ('00000000' + h2.toString(16)).slice(-8);
    }

    /* Constant-time-ish comparison. */
    function hashesEqual(a, b) {
        if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
        var diff = 0;
        for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
        return diff === 0;
    }

    /* ---------- session ---------- */

    function loadSession() {
        try {
            var raw = localStorage.getItem(SESSION_KEY);
            session = raw ? JSON.parse(raw) : null;
        } catch (e) {
            session = null;
        }
    }

    function persistSession() {
        try {
            if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
            else localStorage.removeItem(SESSION_KEY);
        } catch (e) { /* storage disabled; session stays in memory */ }
    }

    /* ---------- public API ---------- */

    function init() {
        loadSession();

        var idb = idbDriver();
        return idb.open()
            .then(function () {
                driver = idb;
                driverName = idb.name;
            })
            .catch(function () {
                var ls = localDriver();
                return ls.open().then(function () {
                    driver = ls;
                    driverName = ls.name;
                });
            })
            .then(function () {
                // Verify the signed-in local profile still exists here.
                if (!session || !session.username) return;
                return driver.getUser(session.username).then(function (user) {
                    if (!user) { session = null; persistSession(); }
                });
            })
            .then(function () {
                // Start Firebase if it is configured. Never fatal: the
                // app must keep working locally when cloud is absent.
                if (!cloudAvailable()) return;
                return RB.cloud.init().catch(function () {});
            })
            .then(function () {
                return {
                    driver: driverName,
                    cloudAvailable: cloudAvailable(),
                    cloudConfigured: !!(RB.cloudConfigured && RB.cloudConfigured())
                };
            });
    }

    /* Register for Firebase session changes. Fires once with the
       restored session on page load, then on every sign-in/out. */
    function watchCloudAuth(callback) {
        if (!cloudAvailable()) { callback(null); return function () {}; }
        return RB.cloud.auth.onAuthChanged(function (user) {
            setCloudUser(user);
            callback(user);
        });
    }

    function normaliseUsername(name) {
        return u.trim(name).toLowerCase().replace(/\s+/g, '');
    }

    function validatePin(pin) {
        var s = String(pin || '');
        if (!/^\d{4,8}$/.test(s)) return 'PIN must be 4 to 8 digits.';
        if (/^(\d)\1+$/.test(s)) return 'PIN cannot be the same digit repeated.';
        if (/^(0123|1234|2345|3456|4567|5678|6789|9876|8765|7654|4321|3210)/.test(s)) {
            return 'PIN cannot be a simple run of digits.';
        }
        return null;
    }

    function listProfiles() {
        return driver.allUsers().then(function (users) {
            return users
                .map(function (x) {
                    return {
                        username: x.username,
                        displayName: x.displayName || x.username,
                        createdAt: x.createdAt
                    };
                })
                .sort(function (a, b) {
                    return String(a.displayName).localeCompare(String(b.displayName));
                });
        });
    }

    function createProfile(displayName, pin) {
        var username = normaliseUsername(displayName);
        if (username.length < 2) {
            return Promise.reject(new Error('Please enter a name of at least 2 characters.'));
        }
        var pinError = validatePin(pin);
        if (pinError) return Promise.reject(new Error(pinError));

        return driver.getUser(username).then(function (existing) {
            if (existing) throw new Error('A profile named "' + u.trim(displayName) + '" already exists on this device.');

            var salt = randomSaltHex();
            return hashPin(pin, salt).then(function (h) {
                var user = {
                    username: username,
                    displayName: u.trim(displayName),
                    salt: salt,
                    hash: h.hash,
                    iterations: h.iterations,
                    weak: h.weak,
                    createdAt: Date.now()
                };
                return driver.putUser(user).then(function () {
                    session = { username: username };
                    persistSession();
                    return publicUser(user);
                });
            });
        });
    }

    function signIn(username, pin) {
        var key = normaliseUsername(username);
        return driver.getUser(key).then(function (user) {
            if (!user) throw new Error('No profile with that name on this device.');
            return hashPin(pin, user.salt, user.iterations).then(function (h) {
                if (!hashesEqual(h.hash, user.hash)) throw new Error('Incorrect PIN.');
                session = { username: key };
                persistSession();
                return publicUser(user);
            });
        });
    }

    function signOut() {
        session = null;
        persistSession();
        return Promise.resolve();
    }

    function currentUser() {
        // A cloud account outranks a local profile.
        if (cloudUser) return Promise.resolve(cloudUser);
        if (!session || !session.username) return Promise.resolve(null);
        return driver.getUser(session.username).then(function (user) {
            return user ? publicUser(user) : null;
        });
    }

    function isSignedIn() {
        return !!cloudUser || !!(session && session.username);
    }

    /* The key under which CVs are filed. In cloud mode Firestore
       already scopes documents by uid, but the field is still set so
       a downloaded backup records who it belonged to. */
    function owner() {
        if (cloudUser) return cloudUser.uid;
        if (session && session.username) return session.username;
        return GUEST;
    }

    function publicUser(user) {
        return {
            username: user.username,
            displayName: user.displayName || user.username,
            weakHashing: !!user.weak,
            createdAt: user.createdAt
        };
    }

    function changePin(oldPin, newPin) {
        if (!isSignedIn()) return Promise.reject(new Error('Not signed in.'));
        var pinError = validatePin(newPin);
        if (pinError) return Promise.reject(new Error(pinError));

        return driver.getUser(session.username).then(function (user) {
            return hashPin(oldPin, user.salt, user.iterations).then(function (h) {
                if (!hashesEqual(h.hash, user.hash)) throw new Error('Current PIN is incorrect.');
                var salt = randomSaltHex();
                return hashPin(newPin, salt).then(function (nh) {
                    user.salt = salt;
                    user.hash = nh.hash;
                    user.iterations = nh.iterations;
                    user.weak = nh.weak;
                    return driver.putUser(user);
                });
            });
        });
    }

    /* Deletes the profile and every CV belonging to it. */
    function deleteProfile(pin) {
        if (!isSignedIn()) return Promise.reject(new Error('Not signed in.'));
        var username = session.username;

        return driver.getUser(username).then(function (user) {
            return hashPin(pin, user.salt, user.iterations).then(function (h) {
                if (!hashesEqual(h.hash, user.hash)) throw new Error('Incorrect PIN.');
                return driver.resumesByOwner(username).then(function (list) {
                    return Promise.all(list.map(function (r) { return driver.deleteResume(r.id); }));
                }).then(function () {
                    return driver.deleteUser(username);
                }).then(function () {
                    session = null;
                    persistSession();
                });
            });
        });
    }

    /* ---------- saved CVs ---------- */

    function listResumes() {
        return activeDriver().resumesByOwner(owner()).then(function (list) {
            return list.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
        });
    }

    function getResume(id) {
        return activeDriver().getResume(id);
    }

    function createResume(name, data, template) {
        var now = Date.now();
        var record = {
            id: u.uid(),
            owner: owner(),
            name: u.trim(name) || 'Untitled CV',
            template: template || 'modern',
            data: data || RB.model.blankResume(),
            createdAt: now,
            updatedAt: now
        };
        return activeDriver().putResume(record).then(function () { return record; });
    }

    function updateResume(id, patch) {
        var d = activeDriver();
        return d.getResume(id).then(function (record) {
            if (!record) throw new Error('That CV no longer exists.');
            Object.keys(patch).forEach(function (k) { record[k] = patch[k]; });
            record.updatedAt = Date.now();
            return d.putResume(record).then(function () { return record; });
        });
    }

    function duplicateResume(id) {
        return activeDriver().getResume(id).then(function (record) {
            if (!record) throw new Error('That CV no longer exists.');
            return createResume(record.name + ' (copy)', u.deepClone(record.data), record.template);
        });
    }

    function deleteResume(id) {
        return activeDriver().deleteResume(id);
    }

    /* Move guest-owned CVs onto a local profile at first sign-in, so
       work done before making an account isn't stranded. */
    function claimGuestResumes() {
        if (!session || !session.username) return Promise.resolve(0);
        var target = session.username;
        return driver.resumesByOwner(GUEST).then(function (list) {
            if (!list.length) return 0;
            return Promise.all(list.map(function (r) {
                r.owner = target;
                r.updatedAt = Date.now();
                return driver.putResume(r);
            })).then(function () { return list.length; });
        });
    }

    /* ------------------------------------------------------------
       CLOUD MODE
       ------------------------------------------------------------ */

    function cloudAvailable() {
        return !!(RB.cloud && RB.cloud.available());
    }

    /* Called by the auth listener whenever the Firebase session
       changes — including the silent restore on page load. */
    function setCloudUser(user) {
        cloudUser = user || null;
    }

    function currentCloudUser() {
        return cloudUser;
    }

    /* Everything held locally, across the guest bucket and every
       local PIN profile, ready to be copied into an account. */
    function localResumesForUpload() {
        if (!driver) return Promise.resolve([]);
        return driver.allUsers().then(function (users) {
            var owners = [GUEST].concat(users.map(function (x) { return x.username; }));
            return Promise.all(owners.map(function (o) {
                return driver.resumesByOwner(o).catch(function () { return []; });
            }));
        }).then(function (lists) {
            return lists.reduce(function (acc, l) { return acc.concat(l); }, []);
        }).catch(function () { return []; });
    }

    /* Copy local CVs into the signed-in account. Deliberately a copy,
       not a move: if the upload half-fails, or the user signed in on
       someone else's machine by mistake, the originals are still here.
       Duplicate names are skipped so signing in twice does not
       produce three copies of everything. */
    function uploadLocalResumes() {
        if (!cloudUser) return Promise.reject(new Error('Not signed in to an account.'));

        return Promise.all([localResumesForUpload(), listResumes()])
            .then(function (both) {
                var local = both[0];
                var existingNames = {};
                both[1].forEach(function (r) {
                    existingNames[u.trim(r.name).toLowerCase()] = true;
                });

                var toCopy = local.filter(function (r) {
                    return !RB.model.isEmptyResume(RB.model.migrate(r.data)) &&
                           !existingNames[u.trim(r.name).toLowerCase()];
                });

                if (!toCopy.length) return { copied: 0, skipped: local.length };

                return toCopy.reduce(function (chain, r) {
                    return chain.then(function () {
                        return createResume(r.name, RB.model.migrate(r.data), r.template);
                    });
                }, Promise.resolve()).then(function () {
                    return { copied: toCopy.length, skipped: local.length - toCopy.length };
                });
            });
    }

    function countLocalResumes() {
        return localResumesForUpload().then(function (list) {
            return list.filter(function (r) {
                return !RB.model.isEmptyResume(RB.model.migrate(r.data));
            }).length;
        });
    }

    /* ---------- backup ----------
       The escape hatch that makes local-only storage acceptable:
       one file the user can move to another browser or machine. */

    function exportBackup() {
        return listResumes().then(function (list) {
            return {
                format: 'smart-resume-builder-backup',
                version: 1,
                exportedAt: new Date().toISOString(),
                resumes: list.map(function (r) {
                    return {
                        name: r.name,
                        template: r.template,
                        data: r.data,
                        createdAt: r.createdAt,
                        updatedAt: r.updatedAt
                    };
                })
            };
        });
    }

    function importBackup(payload) {
        if (!payload || payload.format !== 'smart-resume-builder-backup' ||
            !Array.isArray(payload.resumes)) {
            return Promise.reject(new Error('That file is not a Smart Resume Builder backup.'));
        }
        var jobs = payload.resumes.map(function (r) {
            return createResume(r.name, RB.model.migrate(r.data), r.template);
        });
        return Promise.all(jobs).then(function (created) { return created.length; });
    }

    /* ---------- legacy migration ----------
       v1 kept a single CV in localStorage under "resumeData".
       Pull it in once, then mark it done. */

    var LEGACY_FLAG = 'rb.legacyImported';

    function importLegacyIfPresent() {
        var raw, appState;
        // Only ever pull the old localStorage CV into local storage —
        // silently uploading it to someone's cloud account would be
        // a surprise, and the upload flow is explicit and opt-in.
        if (cloudUser) return Promise.resolve(null);
        try {
            if (localStorage.getItem(LEGACY_FLAG)) return Promise.resolve(null);
            raw = localStorage.getItem('resumeData');
            appState = localStorage.getItem('appState');
        } catch (e) {
            return Promise.resolve(null);
        }
        if (!raw) return Promise.resolve(null);

        var data, template = 'modern';
        try {
            data = RB.model.migrate(JSON.parse(raw));
        } catch (e) {
            return Promise.resolve(null);
        }
        try {
            if (appState) {
                var parsed = JSON.parse(appState);
                // "professional" was renamed to "executive" in v2.
                template = parsed.currentTemplate === 'professional'
                    ? 'executive'
                    : (parsed.currentTemplate || 'modern');
            }
        } catch (e) { /* keep the default */ }

        if (RB.model.isEmptyResume(data)) {
            try { localStorage.setItem(LEGACY_FLAG, '1'); } catch (e) {}
            return Promise.resolve(null);
        }

        return createResume('Imported CV', data, template).then(function (record) {
            try { localStorage.setItem(LEGACY_FLAG, '1'); } catch (e) {}
            return record;
        });
    }

    RB.store = {
        GUEST: GUEST,
        init: init,
        driverName: function () { return activeDriver() ? activeDriver().name : ''; },
        localDriverName: function () { return driverName; },
        mode: mode,

        /* cloud */
        cloudAvailable: cloudAvailable,
        watchCloudAuth: watchCloudAuth,
        currentCloudUser: currentCloudUser,
        uploadLocalResumes: uploadLocalResumes,
        countLocalResumes: countLocalResumes,
        validatePin: validatePin,
        listProfiles: listProfiles,
        createProfile: createProfile,
        signIn: signIn,
        signOut: signOut,
        currentUser: currentUser,
        isSignedIn: isSignedIn,
        owner: owner,
        changePin: changePin,
        deleteProfile: deleteProfile,
        listResumes: listResumes,
        getResume: getResume,
        createResume: createResume,
        updateResume: updateResume,
        duplicateResume: duplicateResume,
        deleteResume: deleteResume,
        claimGuestResumes: claimGuestResumes,
        exportBackup: exportBackup,
        importBackup: importBackup,
        importLegacyIfPresent: importLegacyIfPresent
    };
})(window.RB);

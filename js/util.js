/* ============================================================
   util.js — shared helpers
   Loaded first. Exposes window.RB (the app namespace).
   Plain <script> rather than an ES module so the app still
   works when opened straight off disk (file://).
   ============================================================ */

window.RB = window.RB || {};

(function (RB) {
    'use strict';

    /* ---------- HTML escaping ----------
       Every template in this app interpolates user text into
       innerHTML. All of it goes through esc() first, otherwise a
       resume containing "<img onerror=...>" runs script in the
       page — and imported CVs are untrusted input by definition. */

    var ESC_MAP = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };

    function esc(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/[&<>"']/g, function (ch) {
            return ESC_MAP[ch];
        });
    }

    /* Escape for a quoted HTML attribute (same map; separate name
       so intent is readable at call sites). */
    function escAttr(value) {
        return esc(value);
    }

    /* ---------- DOM ---------- */

    function $(selector, root) {
        return (root || document).querySelector(selector);
    }

    function $$(selector, root) {
        return Array.prototype.slice.call((root || document).querySelectorAll(selector));
    }

    function on(el, type, handler, opts) {
        if (el) el.addEventListener(type, handler, opts);
    }

    /* ---------- text helpers ---------- */

    function trim(s) {
        return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    }

    function isBlank(s) {
        return !s || !String(s).trim();
    }

    function titleCase(s) {
        // Leaves acronyms (all-caps runs of 2+) alone, so "BCom" and
        // "AWS" survive in qualifications and certification names.
        return String(s || '').replace(/\b[\w'’-]+\b/g, function (word) {
            if (/^[A-Z0-9]{2,}$/.test(word)) return word;
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        });
    }

    /* For people's names, where the acronym exemption above is wrong:
       it would leave "SIPHO NKOSI" untouched, since each word reads as
       an acronym. Names get cased unconditionally. */
    function forceTitleCase(s) {
        return String(s || '').replace(/[A-Za-z'’-]+/g, function (word) {
            // Keep the second capital in Scots/Irish prefixes.
            if (/^(mc|mac|o')/i.test(word) && word.length > 3) {
                var prefixLength = /^o'/i.test(word) ? 2 : (/^mac/i.test(word) ? 3 : 2);
                return word.charAt(0).toUpperCase() +
                       word.slice(1, prefixLength).toLowerCase() +
                       word.charAt(prefixLength).toUpperCase() +
                       word.slice(prefixLength + 1).toLowerCase();
            }
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        });
    }

    function wordCount(s) {
        var t = trim(s);
        return t ? t.split(/\s+/).length : 0;
    }

    function clamp(n, lo, hi) {
        return Math.max(lo, Math.min(hi, n));
    }

    function uid() {
        // Good enough for local record ids; not a security token.
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function debounce(fn, ms) {
        var t;
        return function () {
            var args = arguments, self = this;
            clearTimeout(t);
            t = setTimeout(function () { fn.apply(self, args); }, ms || 200);
        };
    }

    /* ---------- dates ----------
       Stored as "YYYY-MM" (from <input type="month">) and rendered
       as "Jan 2020". A plain hyphen joins ranges: some older
       parsers mishandle en/em dashes. */

    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    function formatMonth(value) {
        if (isBlank(value)) return '';
        var m = /^(\d{4})-(\d{1,2})$/.exec(String(value).trim());
        if (m) {
            var idx = parseInt(m[2], 10) - 1;
            if (idx >= 0 && idx < 12) return MONTHS[idx] + ' ' + m[1];
            return m[1];
        }
        // Already human-readable, or a bare year — pass through.
        return trim(value);
    }

    function formatRange(start, end, current) {
        var a = formatMonth(start);
        var b = current ? 'Present' : formatMonth(end);
        if (a && b) return a + ' - ' + b;
        return a || b || '';
    }

    /* Turn free text like "March 2019", "03/2019", "2019" into
       the "YYYY-MM" the month input expects. Used by the importer. */
    function parseToMonthValue(text) {
        var s = trim(text);
        if (!s) return '';

        var named = /^([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(s);
        if (named) {
            var i = monthIndexFromName(named[1]);
            if (i >= 0) return named[2] + '-' + pad2(i + 1);
        }

        var numeric = /^(\d{1,2})[\/\-.](\d{4})$/.exec(s);
        if (numeric && +numeric[1] >= 1 && +numeric[1] <= 12) {
            return numeric[2] + '-' + pad2(+numeric[1]);
        }

        var iso = /^(\d{4})[\/\-.](\d{1,2})$/.exec(s);
        if (iso && +iso[2] >= 1 && +iso[2] <= 12) {
            return iso[1] + '-' + pad2(+iso[2]);
        }

        var yearOnly = /^(19|20)\d{2}$/.exec(s);
        if (yearOnly) return s; // keep the bare year; renders as-is

        return '';
    }

    function monthIndexFromName(name) {
        var n = String(name).slice(0, 3).toLowerCase();
        for (var i = 0; i < 12; i++) {
            if (MONTHS[i].toLowerCase() === n) return i;
        }
        if (n === 'sept') return 8;
        return -1;
    }

    function pad2(n) {
        return (n < 10 ? '0' : '') + n;
    }

    /* Sortable key so entries can be ordered newest-first. */
    function monthSortKey(value, current) {
        if (current) return 999999;
        var m = /^(\d{4})-(\d{1,2})$/.exec(String(value || '').trim());
        if (m) return parseInt(m[1], 10) * 12 + parseInt(m[2], 10);
        var y = /^(19|20)(\d{2})$/.exec(String(value || '').trim());
        if (y) return parseInt(String(value).trim(), 10) * 12;
        return -1;
    }

    /* ---------- validation ---------- */

    var EMAIL_RE = /^[^\s@]+@[^\s@,;]+\.[A-Za-z]{2,}$/;

    function isValidEmail(s) {
        return EMAIL_RE.test(trim(s));
    }

    /* Deliberately permissive: international formats vary wildly.
       Requires 9-15 digits, which covers ZA (+27 xx xxx xxxx),
       UK, US and EU numbers. */
    function isValidPhone(s) {
        var digits = String(s || '').replace(/\D/g, '');
        return digits.length >= 9 && digits.length <= 15;
    }

    /* ---------- download ---------- */

    function downloadBlob(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Revoke on the next tick so Safari has time to start the save.
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    function safeFilename(s, fallback) {
        var base = trim(s).replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
        return base || fallback || 'resume';
    }

    /* ---------- clipboard ---------- */

    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }
        // Fallback for file:// and older browsers.
        return new Promise(function (resolve, reject) {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            document.body.removeChild(ta);
            ok ? resolve() : reject(new Error('Copy failed'));
        });
    }

    /* ---------- theme ----------
       Three states, not two: "system" follows the OS setting and is
       the default, because a person who has set their laptop to dark
       at night expects apps to follow without being told twice.
       Light and dark are explicit overrides.

       The chosen theme is written to <html data-theme> by an inline
       script in the page head, before first paint — see welcome.html.
       Doing it here would flash the wrong colours on every load. */

    var THEME_KEY = 'rb.theme';
    var themeListeners = [];
    var mediaQuery = window.matchMedia
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;

    function themePreference() {
        try {
            var stored = localStorage.getItem(THEME_KEY);
            if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
        } catch (e) { /* storage blocked */ }
        return 'system';
    }

    function resolvedTheme(preference) {
        var pref = preference || themePreference();
        if (pref === 'system') {
            return mediaQuery && mediaQuery.matches ? 'dark' : 'light';
        }
        return pref;
    }

    function applyTheme(preference) {
        var resolved = resolvedTheme(preference);
        document.documentElement.setAttribute('data-theme', resolved);

        // Tint the mobile browser chrome to match.
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0f1115' : '#f1f5f9');

        themeListeners.forEach(function (fn) {
            try { fn(preference || themePreference(), resolved); } catch (e) {}
        });
        return resolved;
    }

    function setTheme(preference) {
        try { localStorage.setItem(THEME_KEY, preference); } catch (e) {}
        return applyTheme(preference);
    }

    function onThemeChange(fn) {
        themeListeners.push(fn);
    }

    /* Follow the OS live, but only while the user is on "system". */
    if (mediaQuery) {
        var handler = function () {
            if (themePreference() === 'system') applyTheme('system');
        };
        if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', handler);
        else if (mediaQuery.addListener) mediaQuery.addListener(handler);
    }

    RB.util = {
        esc: esc,
        themePreference: themePreference,
        resolvedTheme: resolvedTheme,
        applyTheme: applyTheme,
        setTheme: setTheme,
        onThemeChange: onThemeChange,
        escAttr: escAttr,
        $: $,
        $$: $$,
        on: on,
        trim: trim,
        isBlank: isBlank,
        titleCase: titleCase,
        forceTitleCase: forceTitleCase,
        wordCount: wordCount,
        clamp: clamp,
        uid: uid,
        deepClone: deepClone,
        debounce: debounce,
        MONTHS: MONTHS,
        formatMonth: formatMonth,
        formatRange: formatRange,
        parseToMonthValue: parseToMonthValue,
        monthSortKey: monthSortKey,
        isValidEmail: isValidEmail,
        isValidPhone: isValidPhone,
        downloadBlob: downloadBlob,
        safeFilename: safeFilename,
        copyText: copyText
    };
})(window.RB);

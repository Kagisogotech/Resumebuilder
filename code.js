/* ============================================================
   code.js — Nene's CV Platform: application controller

   Loaded last, after js/util, model, store, ats, parse, revamp,
   render and exporters. Owns the UI, the editing state and the
   autosave loop; delegates all real work to those modules.
   ============================================================ */

(function (RB) {
    'use strict';

    var u = RB.util;
    var model = RB.model;
    var store = RB.store;

    /* ---------- state ---------- */

    var state = {
        resume: model.blankResume(),
        template: 'modern',
        activeSection: 'contact',
        recordId: null,
        recordName: 'Untitled CV',
        user: null,
        dirty: false,
        lastAudit: null
    };

    /* ============================================================
       TOASTS
       ============================================================ */

    function toast(message, tone, ms) {
        var layer = u.$('#toast-layer');
        if (!layer) return;

        var tones = {
            ok:    'bg-emerald-600',
            error: 'bg-red-600',
            info:  'bg-slate-800',
            warn:  'bg-amber-600'
        };

        var el = document.createElement('div');
        el.className = 'pointer-events-auto ' + (tones[tone] || tones.info) +
            ' text-white text-sm px-4 py-2.5 rounded-lg shadow-lg max-w-sm ' +
            'transition-all duration-200 opacity-0 translate-y-2';
        el.textContent = message;
        layer.appendChild(el);

        requestAnimationFrame(function () {
            el.classList.remove('opacity-0', 'translate-y-2');
        });

        setTimeout(function () {
            el.classList.add('opacity-0', 'translate-y-2');
            setTimeout(function () { el.remove(); }, 220);
        }, ms || 3600);
    }

    /* ============================================================
       MODALS
       Built in JS so the markup lives next to the logic that uses
       it. openModal returns the panel element for wiring up.
       ============================================================ */

    var modalStack = [];

    function openModal(opts) {
        var layer = u.$('#modal-layer');

        var backdrop = document.createElement('div');
        backdrop.className = 'fixed inset-0 z-50 flex items-start sm:items-center justify-center ' +
            'p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm overflow-y-auto';

        var sizes = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };

        var panel = document.createElement('div');
        panel.className = 'card w-full ' + (sizes[opts.size] || sizes.md) +
            ' my-auto max-h-[92vh] flex flex-col overflow-hidden';

        panel.innerHTML =
            '<div class="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-200">' +
                '<div>' +
                    '<h2 class="text-lg font-semibold text-slate-800">' + u.esc(opts.title) + '</h2>' +
                    (opts.subtitle
                        ? '<p class="text-sm text-slate-500 mt-0.5">' + u.esc(opts.subtitle) + '</p>'
                        : '') +
                '</div>' +
                '<button data-close class="shrink-0 text-slate-400 hover:text-slate-700 ' +
                    'rounded-lg p-1 -m-1" aria-label="Close">' +
                    '<span data-lucide="x" class="w-5 h-5"></span>' +
                '</button>' +
            '</div>' +
            '<div data-body class="px-5 py-4 overflow-y-auto grow">' + (opts.body || '') + '</div>' +
            (opts.footer
                ? '<div data-footer class="px-5 py-3.5 border-t border-slate-200 bg-slate-50 ' +
                  'flex flex-wrap gap-2 justify-end">' + opts.footer + '</div>'
                : '');

        backdrop.appendChild(panel);
        layer.appendChild(backdrop);

        function close() {
            backdrop.remove();
            modalStack = modalStack.filter(function (m) { return m !== close; });
            document.removeEventListener('keydown', onKey);
            if (!modalStack.length) document.body.style.overflow = '';
            if (opts.onClose) opts.onClose();
        }

        function onKey(e) {
            if (e.key === 'Escape' && modalStack[modalStack.length - 1] === close) close();
        }

        u.$$('[data-close]', panel).forEach(function (btn) {
            u.on(btn, 'click', close);
        });
        u.on(backdrop, 'click', function (e) {
            if (e.target === backdrop) close();
        });
        document.addEventListener('keydown', onKey);

        modalStack.push(close);
        document.body.style.overflow = 'hidden';
        refreshIcons(panel);

        // Move focus in so keyboard users land inside the dialog.
        var focusTarget = panel.querySelector('[data-autofocus]') ||
                          panel.querySelector('input, textarea, button');
        if (focusTarget) setTimeout(function () { focusTarget.focus(); }, 30);

        return { panel: panel, body: u.$('[data-body]', panel), close: close };
    }

    function confirmModal(opts) {
        return new Promise(function (resolve) {
            var m = openModal({
                title: opts.title,
                size: 'sm',
                body: '<p class="text-sm text-slate-600 leading-relaxed">' +
                      u.esc(opts.message) + '</p>' +
                      (opts.detail
                        ? '<p class="text-xs text-slate-500 mt-3 leading-relaxed">' +
                          u.esc(opts.detail) + '</p>'
                        : ''),
                footer:
                    '<button data-cancel class="px-4 py-2 text-sm rounded-lg border ' +
                        'border-slate-300 text-slate-600 hover:bg-slate-100">' +
                        u.esc(opts.cancelLabel || 'Cancel') + '</button>' +
                    '<button data-ok class="px-4 py-2 text-sm rounded-lg text-white ' +
                        (opts.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-sky-600 hover:bg-sky-700') +
                        '">' + u.esc(opts.okLabel || 'Confirm') + '</button>',
                onClose: function () { resolve(false); }
            });

            u.on(u.$('[data-cancel]', m.panel), 'click', m.close);
            u.on(u.$('[data-ok]', m.panel), 'click', function () {
                resolve(true);
                m.close();
            });
        });
    }

    function refreshIcons(root) {
        if (window.lucide && window.lucide.createIcons) {
            try {
                window.lucide.createIcons(root ? { nameAttr: 'data-lucide' } : undefined);
            } catch (e) { /* icons are decorative; never block on them */ }
        }
    }

    /* ============================================================
       PATH HELPERS — data-path="experience.0.title"
       ============================================================ */

    function setPath(root, path, value) {
        var parts = String(path).split('.');
        var node = root;
        for (var i = 0; i < parts.length - 1; i++) {
            var key = parts[i];
            if (/^\d+$/.test(key)) key = parseInt(key, 10);
            if (node[key] === undefined || node[key] === null) return false;
            node = node[key];
        }
        var last = parts[parts.length - 1];
        if (/^\d+$/.test(last)) last = parseInt(last, 10);
        node[last] = value;
        return true;
    }

    function getPath(root, path) {
        var parts = String(path).split('.');
        var node = root;
        for (var i = 0; i < parts.length; i++) {
            var key = parts[i];
            if (/^\d+$/.test(key)) key = parseInt(key, 10);
            if (node === null || node === undefined) return undefined;
            node = node[key];
        }
        return node;
    }

    /* ============================================================
       FIELD BUILDERS
       ============================================================ */

    function textField(label, path, opts) {
        var o = opts || {};
        var value = getPath(state.resume, path);
        return '<div>' +
            '<label class="field-label block mb-1">' + u.esc(label) + '</label>' +
            '<input type="' + (o.type || 'text') + '" class="input-field" ' +
                'data-path="' + u.escAttr(path) + '" ' +
                (o.placeholder ? 'placeholder="' + u.escAttr(o.placeholder) + '" ' : '') +
                (o.inputmode ? 'inputmode="' + u.escAttr(o.inputmode) + '" ' : '') +
                'value="' + u.escAttr(value == null ? '' : value) + '">' +
            (o.hint ? '<p class="text-xs text-slate-400 mt-1">' + u.esc(o.hint) + '</p>' : '') +
            '</div>';
    }

    function areaField(label, path, opts) {
        var o = opts || {};
        var value = getPath(state.resume, path);
        return '<div>' +
            '<label class="field-label block mb-1">' + u.esc(label) + '</label>' +
            '<textarea class="textarea-field" data-path="' + u.escAttr(path) + '" ' +
                (o.rows ? 'rows="' + o.rows + '" ' : '') +
                (o.placeholder ? 'placeholder="' + u.escAttr(o.placeholder) + '" ' : '') +
                '>' + u.esc(value == null ? '' : value) + '</textarea>' +
            (o.hint ? '<p class="text-xs text-slate-400 mt-1">' + u.esc(o.hint) + '</p>' : '') +
            '</div>';
    }

    /* Bullets edit as one-per-line text. Splitting on newline
       without filtering keeps the caret stable while typing. */
    function bulletsField(label, path, opts) {
        var o = opts || {};
        var list = getPath(state.resume, path) || [];
        return '<div>' +
            '<label class="field-label block mb-1">' + u.esc(label) + '</label>' +
            '<textarea class="textarea-field font-mono text-xs leading-relaxed" rows="6" ' +
                'data-path="' + u.escAttr(path) + '" data-kind="lines" ' +
                'placeholder="One achievement per line.">' +
                u.esc(list.join('\n')) + '</textarea>' +
            '<p class="text-xs text-slate-400 mt-1">' +
                u.esc(o.hint || 'One bullet per line. Start with a verb, end with a result, include a number.') +
            '</p>' +
            '</div>';
    }

    function listField(label, path, opts) {
        var o = opts || {};
        var list = getPath(state.resume, path) || [];
        return '<div>' +
            '<label class="field-label block mb-1">' + u.esc(label) + '</label>' +
            '<textarea class="textarea-field" rows="3" data-path="' + u.escAttr(path) + '" ' +
                'data-kind="csv" placeholder="Comma separated">' +
                u.esc(list.join(', ')) + '</textarea>' +
            (o.hint ? '<p class="text-xs text-slate-400 mt-1">' + u.esc(o.hint) + '</p>' : '') +
            '</div>';
    }

    function monthField(label, path, opts) {
        var o = opts || {};
        var raw = getPath(state.resume, path) || '';
        // <input type="month"> only accepts YYYY-MM; a bare year
        // stored from an import falls back to a text input.
        var isMonth = /^\d{4}-\d{2}$/.test(raw);
        if (raw && !isMonth) {
            return '<div>' +
                '<label class="field-label block mb-1">' + u.esc(label) + '</label>' +
                '<input type="text" class="input-field" data-path="' + u.escAttr(path) + '" ' +
                    'value="' + u.escAttr(raw) + '">' +
                '<p class="text-xs text-amber-600 mt-1">Imported as text — retype as a month for a consistent format.</p>' +
                '</div>';
        }
        return '<div>' +
            '<label class="field-label block mb-1">' + u.esc(label) + '</label>' +
            '<input type="month" class="input-field" data-path="' + u.escAttr(path) + '" ' +
                (o.disabled ? 'disabled ' : '') +
                'value="' + u.escAttr(raw) + '">' +
            '</div>';
    }

    function checkField(label, path) {
        var value = !!getPath(state.resume, path);
        return '<label class="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">' +
            '<input type="checkbox" data-path="' + u.escAttr(path) + '" data-kind="bool" ' +
                (value ? 'checked ' : '') +
                'class="rounded border-slate-300 text-sky-600 focus:ring-sky-500">' +
            u.esc(label) +
            '</label>';
    }

    function entryCard(inner, opts) {
        var o = opts || {};
        return '<div class="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 relative">' +
            '<div class="flex items-center justify-between mb-2.5">' +
                '<span class="text-xs font-semibold text-slate-400 uppercase tracking-wide">' +
                    u.esc(o.label || '') + '</span>' +
                '<div class="flex items-center gap-1">' +
                    (o.canMoveUp
                        ? '<button data-move="up" data-section="' + u.escAttr(o.section) + '" ' +
                          'data-index="' + o.index + '" title="Move up" ' +
                          'class="p-1 text-slate-400 hover:text-slate-700 rounded">' +
                          '<span data-lucide="arrow-up" class="w-3.5 h-3.5"></span></button>'
                        : '') +
                    (o.canMoveDown
                        ? '<button data-move="down" data-section="' + u.escAttr(o.section) + '" ' +
                          'data-index="' + o.index + '" title="Move down" ' +
                          'class="p-1 text-slate-400 hover:text-slate-700 rounded">' +
                          '<span data-lucide="arrow-down" class="w-3.5 h-3.5"></span></button>'
                        : '') +
                    '<button data-remove data-section="' + u.escAttr(o.section) + '" ' +
                        'data-index="' + o.index + '" title="Remove" ' +
                        'class="p-1 text-slate-400 hover:text-red-600 rounded">' +
                        '<span data-lucide="trash-2" class="w-3.5 h-3.5"></span></button>' +
                '</div>' +
            '</div>' +
            inner +
            '</div>';
    }

    function addButton(section, label) {
        return '<button data-add data-section="' + u.escAttr(section) + '" ' +
            'class="w-full px-4 py-2.5 text-sm font-medium text-sky-700 border-2 border-dashed ' +
            'border-sky-300 rounded-lg hover:bg-sky-50 hover:border-sky-400 transition-colors ' +
            'flex items-center justify-center gap-2">' +
            '<span data-lucide="plus" class="w-4 h-4"></span>' + u.esc(label) + '</button>';
    }

    /* ============================================================
       INPUT PANEL
       ============================================================ */

    function renderInputPanel() {
        var host = u.$('#input-sections');
        var section = state.activeSection;
        var r = state.resume;
        var meta = model.SECTIONS.filter(function (s) { return s.key === section; })[0] ||
                   model.SECTIONS[0];

        var content = '';
        var note = '';

        switch (section) {
            case 'contact':
                note = 'Keep this to what an employer needs to reach you. Leave out your ID number, ' +
                       'date of birth, marital status and photo — they invite bias and some parsers choke on them.';
                content = '<div class="grid sm:grid-cols-2 gap-3.5">' +
                    textField('Full name', 'contact.name', { placeholder: 'Thandi Mokoena' }) +
                    textField('Target job title', 'contact.title', {
                        placeholder: 'Data Analyst',
                        hint: 'Match the advert wording exactly.'
                    }) +
                    textField('Email', 'contact.email', { type: 'email', placeholder: 'name@example.com' }) +
                    textField('Phone', 'contact.phone', {
                        type: 'tel', inputmode: 'tel', placeholder: '+27 82 555 0134'
                    }) +
                    textField('Location', 'contact.location', {
                        placeholder: 'Johannesburg, South Africa',
                        hint: 'City and country is enough.'
                    }) +
                    textField('LinkedIn', 'contact.linkedin', { placeholder: 'linkedin.com/in/yourname' }) +
                    '<div class="sm:col-span-2">' +
                    textField('Portfolio / GitHub (optional)', 'contact.portfolio', {
                        placeholder: 'github.com/yourname'
                    }) +
                    '</div>' +
                    '</div>';
                break;

            case 'summary':
                note = 'The densest keyword space on the page, and the first thing a human reads. ' +
                       'Formula: role + years of experience + two specialisms + one headline result.';
                content = areaField('Professional summary', 'summary', {
                    rows: 6,
                    placeholder: 'Data analyst with four years of experience turning operational data ' +
                        'into decisions for retail teams...',
                    hint: 'Aim for 40 to 110 words. No "I" or "my". Include one number.'
                }) +
                '<div class="flex flex-wrap gap-2 mt-3">' +
                    '<button data-action="revamp-summary" class="text-xs px-3 py-1.5 rounded-lg ' +
                        'bg-sky-50 text-sky-700 font-medium hover:bg-sky-100 flex items-center gap-1.5">' +
                        '<span data-lucide="wand-2" class="w-3.5 h-3.5"></span>Tidy this summary</button>' +
                    '<span class="text-xs text-slate-400 self-center" id="summary-count"></span>' +
                '</div>';
                break;

            case 'experience':
                note = 'Newest role first. Three to six bullets each, every one starting with a ' +
                       'past-tense verb and carrying a number wherever you honestly can.';
                content = r.experience.map(function (job, i) {
                    return entryCard(
                        '<div class="space-y-3">' +
                            '<div class="grid sm:grid-cols-2 gap-3">' +
                                textField('Job title', 'experience.' + i + '.title', { placeholder: 'Data Analyst' }) +
                                textField('Employer', 'experience.' + i + '.company', { placeholder: 'Naledi Retail Group' }) +
                            '</div>' +
                            '<div class="grid sm:grid-cols-3 gap-3">' +
                                textField('Location', 'experience.' + i + '.location', { placeholder: 'Johannesburg, ZA' }) +
                                monthField('Start', 'experience.' + i + '.startDate') +
                                monthField('End', 'experience.' + i + '.endDate', { disabled: job.current }) +
                            '</div>' +
                            checkField('This is my current role', 'experience.' + i + '.current') +
                            bulletsField('Achievements', 'experience.' + i + '.bullets') +
                            '<button data-action="revamp-role" data-index="' + i + '" ' +
                                'class="text-xs px-3 py-1.5 rounded-lg bg-sky-50 text-sky-700 ' +
                                'font-medium hover:bg-sky-100 flex items-center gap-1.5">' +
                                '<span data-lucide="wand-2" class="w-3.5 h-3.5"></span>Tidy these bullets</button>' +
                        '</div>',
                        {
                            label: 'Role ' + (i + 1), section: 'experience', index: i,
                            canMoveUp: i > 0, canMoveDown: i < r.experience.length - 1
                        }
                    );
                }).join('') +
                '<div class="flex gap-2">' +
                    addButton('experience', 'Add a role') +
                    (r.experience.length > 1
                        ? '<button data-action="sort-experience" class="shrink-0 px-3 py-2.5 text-xs ' +
                          'font-medium text-slate-600 border border-slate-300 rounded-lg ' +
                          'hover:bg-slate-100 whitespace-nowrap">Sort newest first</button>'
                        : '') +
                '</div>';
                break;

            case 'education':
                note = 'Highest or most recent qualification first. Matric or an NSC counts — many ' +
                       'application systems will not submit without an education record.';
                content = r.education.map(function (edu, i) {
                    return entryCard(
                        '<div class="space-y-3">' +
                            textField('Qualification', 'education.' + i + '.degree', {
                                placeholder: 'BCom Honours, Information Systems'
                            }) +
                            '<div class="grid sm:grid-cols-2 gap-3">' +
                                textField('Institution', 'education.' + i + '.institution', {
                                    placeholder: 'University of Cape Town'
                                }) +
                                textField('Location', 'education.' + i + '.location', { placeholder: 'Cape Town, ZA' }) +
                            '</div>' +
                            '<div class="grid sm:grid-cols-2 gap-3">' +
                                monthField('Start', 'education.' + i + '.startDate') +
                                monthField('Completed', 'education.' + i + '.endDate') +
                            '</div>' +
                            areaField('Notes (optional)', 'education.' + i + '.details', {
                                rows: 2,
                                placeholder: 'Graduated cum laude. Final-year project on demand forecasting.'
                            }) +
                        '</div>',
                        {
                            label: 'Qualification ' + (i + 1), section: 'education', index: i,
                            canMoveUp: i > 0, canMoveDown: i < r.education.length - 1
                        }
                    );
                }).join('') + addButton('education', 'Add a qualification');
                break;

            case 'skills':
                note = 'Group into two to four labelled categories. Use the exact words the job ad uses — ' +
                       'keyword matching is often literal. Skip self-rated star ratings; nobody believes them.';
                content = r.skills.map(function (group, i) {
                    return entryCard(
                        '<div class="space-y-3">' +
                            textField('Category', 'skills.' + i + '.category', {
                                placeholder: 'Technical'
                            }) +
                            listField('Skills', 'skills.' + i + '.items', {
                                hint: 'Comma separated, e.g. SQL, Python, Power BI'
                            }) +
                        '</div>',
                        {
                            label: 'Group ' + (i + 1), section: 'skills', index: i,
                            canMoveUp: i > 0, canMoveDown: i < r.skills.length - 1
                        }
                    );
                }).join('') +
                '<div class="flex gap-2">' +
                    addButton('skills', 'Add a category') +
                    '<button data-action="regroup-skills" class="shrink-0 px-3 py-2.5 text-xs ' +
                        'font-medium text-slate-600 border border-slate-300 rounded-lg ' +
                        'hover:bg-slate-100 whitespace-nowrap">Auto-group</button>' +
                '</div>';
                break;

            case 'certifications':
                note = 'Certifications carry real weight in screening. Include the awarding body and ' +
                       'the date — an unverifiable certificate is worth less than none.';
                content = (r.certifications.length
                    ? r.certifications.map(function (cert, i) {
                        return entryCard(
                            '<div class="space-y-3">' +
                                textField('Certification', 'certifications.' + i + '.name', {
                                    placeholder: 'Microsoft Certified: Power BI Data Analyst Associate'
                                }) +
                                '<div class="grid sm:grid-cols-2 gap-3">' +
                                    textField('Issuer', 'certifications.' + i + '.issuer', { placeholder: 'Microsoft' }) +
                                    monthField('Date', 'certifications.' + i + '.date') +
                                '</div>' +
                            '</div>',
                            {
                                label: 'Certification ' + (i + 1), section: 'certifications', index: i,
                                canMoveUp: i > 0, canMoveDown: i < r.certifications.length - 1
                            }
                        );
                    }).join('')
                    : emptyHint('No certifications yet. This section is optional — but if you have any, add them.')
                ) + addButton('certifications', 'Add a certification');
                break;

            case 'projects':
                note = 'Most useful when you are changing field or early in your career: projects are ' +
                       'how you show skills you have not yet been paid for.';
                content = (r.projects.length
                    ? r.projects.map(function (p, i) {
                        return entryCard(
                            '<div class="space-y-3">' +
                                textField('Project name', 'projects.' + i + '.name', {
                                    placeholder: 'Township Retail Price Index'
                                }) +
                                '<div class="grid sm:grid-cols-2 gap-3">' +
                                    textField('Tools used', 'projects.' + i + '.tech', {
                                        placeholder: 'Python, Streamlit, PostgreSQL'
                                    }) +
                                    textField('Link', 'projects.' + i + '.link', {
                                        placeholder: 'github.com/you/project'
                                    }) +
                                '</div>' +
                                bulletsField('What it does and what came of it', 'projects.' + i + '.bullets', {
                                    hint: 'One point per line, same rules as experience: verb first, ' +
                                          'result at the end, a number wherever you honestly can.'
                                }) +
                            '</div>',
                            {
                                label: 'Project ' + (i + 1), section: 'projects', index: i,
                                canMoveUp: i > 0, canMoveDown: i < r.projects.length - 1
                            }
                        );
                    }).join('')
                    : emptyHint('No projects yet. Optional, but strong evidence if you have them.')
                ) + addButton('projects', 'Add a project');
                break;
        }

        host.innerHTML =
            '<div class="card p-4 sm:p-5">' +
                '<div class="flex items-center gap-2.5 mb-1">' +
                    '<span data-lucide="' + u.escAttr(meta.icon) + '" class="w-5 h-5 text-sky-600"></span>' +
                    '<h2 class="text-base font-semibold text-slate-800">' + u.esc(meta.label) + '</h2>' +
                '</div>' +
                (note ? '<p class="text-xs text-slate-500 leading-relaxed mb-4">' + u.esc(note) + '</p>' : '') +
                '<div class="space-y-3.5">' + content + '</div>' +
            '</div>';

        refreshIcons(host);
        updateSummaryCount();
    }

    function emptyHint(text) {
        return '<p class="text-sm text-slate-400 italic py-2">' + u.esc(text) + '</p>';
    }

    function updateSummaryCount() {
        var el = u.$('#summary-count');
        if (!el) return;
        var n = u.wordCount(state.resume.summary);
        var verdict = n === 0 ? '' : (n < 30 ? ' — a bit short' : (n > 140 ? ' — a bit long' : ' — good length'));
        el.textContent = n + ' words' + verdict;
    }

    /* ============================================================
       PREVIEW, SCORE, NAV
       ============================================================ */

    function renderPreview() {
        var host = u.$('#resume-preview-container');
        host.innerHTML = RB.render.documentHtml(state.resume, state.template);
    }

    var recomputeScore = u.debounce(function () {
        var audit = RB.ats.audit(state.resume);
        state.lastAudit = audit;

        var pill = u.$('#score-pill');
        if (!pill) return;

        var tones = {
            green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
            sky:   'bg-sky-50 text-sky-700 border-sky-200',
            amber: 'bg-amber-50 text-amber-700 border-amber-200',
            red:   'bg-red-50 text-red-700 border-red-200'
        };

        pill.className = 'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border ' +
            'text-xs font-semibold cursor-pointer transition-colors ' +
            (tones[audit.band.tone] || tones.sky);
        pill.innerHTML =
            '<span data-lucide="scan-text" class="w-3.5 h-3.5"></span>' +
            'ATS ' + audit.score + '/100 · ' + u.esc(audit.band.label);
        pill.title = 'Click for the full report';
        refreshIcons(pill);

        var pages = u.$('#page-estimate');
        if (pages) {
            pages.textContent = audit.stats.estimatedPages + ' page' +
                (audit.stats.estimatedPages === 1 ? '' : 's') + ' · ' +
                audit.stats.words + ' words';
        }
    }, 350);

    function renderSectionNav() {
        var nav = u.$('#section-nav');
        nav.innerHTML = model.SECTIONS.map(function (s) {
            var active = s.key === state.activeSection;
            var filled = sectionIsFilled(s.key);
            return '<button data-section-nav="' + u.escAttr(s.key) + '" ' +
                'class="px-3 py-1.5 rounded-full text-xs font-medium transition-colors ' +
                'flex items-center gap-1.5 ' +
                (active
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-sky-50 hover:text-sky-700') + '">' +
                u.esc(s.label) +
                (filled
                    ? '<span class="w-1.5 h-1.5 rounded-full ' +
                      (active ? 'bg-white/70' : 'bg-emerald-500') + '"></span>'
                    : '') +
                '</button>';
        }).join('');
    }

    function sectionIsFilled(key) {
        var r = state.resume;
        switch (key) {
            case 'contact': return !!(u.trim(r.contact.name) && u.trim(r.contact.email));
            case 'summary': return !u.isBlank(r.summary);
            case 'experience': return r.experience.some(function (j) {
                return u.trim(j.title) || u.trim(j.company);
            });
            case 'education': return r.education.some(function (e) {
                return u.trim(e.degree) || u.trim(e.institution);
            });
            case 'skills': return r.skills.some(function (g) { return g.items.length; });
            case 'certifications': return r.certifications.length > 0;
            case 'projects': return r.projects.length > 0;
        }
        return false;
    }

    function renderTemplatePicker() {
        var host = u.$('#template-picker');
        host.innerHTML = model.TEMPLATES.map(function (t) {
            var active = t.key === state.template;
            return '<button data-template="' + u.escAttr(t.key) + '" ' +
                'class="text-left px-3 py-2 rounded-lg border-2 transition-all ' +
                (active
                    ? 'border-sky-500 bg-sky-50'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50') + '">' +
                '<div class="text-sm font-semibold ' +
                    (active ? 'text-sky-800' : 'text-slate-700') + '">' + u.esc(t.label) + '</div>' +
                '<div class="text-xs text-slate-400 mt-0.5">' + u.esc(t.hint) + '</div>' +
                '</button>';
        }).join('');
    }

    function renderIdentity() {
        var el = u.$('#cv-identity');
        if (!el) return;
        el.innerHTML =
            '<button data-action="my-cvs" class="group flex items-center gap-2 text-left ' +
                'px-2.5 py-1.5 rounded-lg hover:bg-slate-100 transition-colors">' +
                '<span data-lucide="folder" class="w-4 h-4 text-slate-400"></span>' +
                '<span>' +
                    '<span class="block text-sm font-medium text-slate-700 leading-tight">' +
                        u.esc(state.recordName) + '</span>' +
                    '<span class="block text-[11px] text-slate-400 leading-tight">' +
                        (state.user
                            ? u.esc(state.user.displayName) + "'s CVs"
                            : 'Not signed in — saved to this browser') +
                    '</span>' +
                '</span>' +
                '<span data-lucide="chevron-down" class="w-3.5 h-3.5 text-slate-300 ' +
                    'group-hover:text-slate-500"></span>' +
            '</button>';
        refreshIcons(el);
    }

    function renderAll() {
        renderTemplatePicker();
        renderSectionNav();
        renderInputPanel();
        renderPreview();
        renderIdentity();
        recomputeScore();
    }

    /* ============================================================
       AUTOSAVE
       ============================================================ */

    var save = u.debounce(function () {
        if (!state.recordId) return;
        store.updateResume(state.recordId, {
            data: state.resume,
            template: state.template,
            name: state.recordName
        }).then(function () {
            state.dirty = false;
            flashSaved();
        }).catch(function (err) {
            toast(err.message || 'Could not save.', 'error');
        });
    }, 700);

    function flashSaved() {
        var el = u.$('#save-status');
        if (!el) return;
        el.textContent = 'Saved';
        el.className = 'text-[11px] text-emerald-600';
        clearTimeout(flashSaved._t);
        flashSaved._t = setTimeout(function () {
            el.textContent = '';
        }, 1800);
    }

    function markDirty() {
        state.dirty = true;
        var el = u.$('#save-status');
        if (el) {
            el.textContent = 'Saving…';
            el.className = 'text-[11px] text-slate-400';
        }
        save();
    }

    /* Touch every derived view after a structural change. */
    function afterEdit(opts) {
        var o = opts || {};
        if (o.rebuildPanel) renderInputPanel();
        if (o.rebuildNav !== false) renderSectionNav();
        renderPreview();
        recomputeScore();
        updateSummaryCount();
        markDirty();
    }

    /* ============================================================
       EDIT EVENTS
       ============================================================ */

    function wireEditing() {
        var host = u.$('#input-sections');

        /* Text input: update state and the preview only. The panel
           is deliberately NOT re-rendered, so the caret and any
           in-progress text (a trailing comma, a half-typed word)
           survive. */
        u.on(host, 'input', function (e) {
            var el = e.target;
            var path = el.dataset.path;
            if (!path) return;

            var kind = el.dataset.kind;
            var value;

            if (kind === 'lines') {
                value = el.value.split(/\n/);
            } else if (kind === 'csv') {
                value = el.value.split(',').map(function (s) { return s.trim(); });
            } else if (kind === 'bool') {
                value = el.checked;
            } else {
                value = el.value;
            }

            setPath(state.resume, path, value);
            renderPreview();
            recomputeScore();
            updateSummaryCount();
            markDirty();
        });

        /* The current-role checkbox needs the End field re-rendered. */
        u.on(host, 'change', function (e) {
            var el = e.target;
            if (el.dataset.kind !== 'bool') return;
            setPath(state.resume, el.dataset.path, el.checked);
            if (/\.current$/.test(el.dataset.path)) {
                var idx = el.dataset.path.split('.')[1];
                if (el.checked) state.resume.experience[idx].endDate = '';
                renderInputPanel();
            }
            renderPreview();
            recomputeScore();
            markDirty();
        });

        u.on(host, 'click', function (e) {
            var addBtn = e.target.closest('[data-add]');
            if (addBtn) return addEntry(addBtn.dataset.section);

            var removeBtn = e.target.closest('[data-remove]');
            if (removeBtn) {
                return removeEntry(removeBtn.dataset.section, parseInt(removeBtn.dataset.index, 10));
            }

            var moveBtn = e.target.closest('[data-move]');
            if (moveBtn) {
                return moveEntry(moveBtn.dataset.section,
                    parseInt(moveBtn.dataset.index, 10),
                    moveBtn.dataset.move === 'up' ? -1 : 1);
            }

            var actionBtn = e.target.closest('[data-action]');
            if (actionBtn) return handleAction(actionBtn.dataset.action, actionBtn);
        });

        /* Left rail */
        u.on(u.$('#section-nav'), 'click', function (e) {
            var btn = e.target.closest('[data-section-nav]');
            if (!btn) return;
            state.activeSection = btn.dataset.sectionNav;
            renderSectionNav();
            renderInputPanel();
        });

        u.on(u.$('#template-picker'), 'click', function (e) {
            var btn = e.target.closest('[data-template]');
            if (!btn) return;
            state.template = btn.dataset.template;
            renderTemplatePicker();
            renderPreview();
            markDirty();
        });

        /* Anything else with data-action, anywhere in the chrome */
        u.on(document, 'click', function (e) {
            var btn = e.target.closest('[data-action]');
            if (!btn) return;
            if (btn.closest('#input-sections')) return;   // handled above
            if (btn.closest('#modal-layer')) return;      // handled per-modal
            handleAction(btn.dataset.action, btn);
        });
    }

    function addEntry(section) {
        var factories = {
            experience: model.newExperience,
            education: model.newEducation,
            skills: function () { return model.newSkillGroup(''); },
            certifications: model.newCertification,
            projects: model.newProject
        };
        if (!factories[section]) return;
        state.resume[section].push(factories[section]());
        afterEdit({ rebuildPanel: true });
    }

    function removeEntry(section, index) {
        var list = state.resume[section];
        if (!list || index < 0 || index >= list.length) return;

        var isLastRequired = list.length === 1 &&
            ['experience', 'education', 'skills'].indexOf(section) !== -1;

        list.splice(index, 1);
        // Keep one blank entry in the required sections so the form
        // never renders as an empty void.
        if (isLastRequired) {
            var factories = {
                experience: model.newExperience,
                education: model.newEducation,
                skills: function () { return model.newSkillGroup(''); }
            };
            list.push(factories[section]());
        }
        afterEdit({ rebuildPanel: true });
    }

    function moveEntry(section, index, delta) {
        var list = state.resume[section];
        var target = index + delta;
        if (!list || target < 0 || target >= list.length) return;
        var tmp = list[index];
        list[index] = list[target];
        list[target] = tmp;
        afterEdit({ rebuildPanel: true });
    }

    /* ============================================================
       ACTIONS
       ============================================================ */

    function handleAction(action, btn) {
        switch (action) {
            case 'my-cvs':          return openCvManager();
            case 'profile':         return openProfileModal();
            case 'upload':          return openUploadModal();
            case 'ats-report':      return openAtsReport();
            case 'job-match':       return openJobMatchModal();
            case 'revamp':          return openRevampModal();
            case 'cover-letter':    return openCoverLetterModal();
            case 'export':          return openExportModal();
            case 'load-sample':     return loadSample();
            case 'clear':           return clearResume();

            case 'revamp-summary':  return tidySummary();
            case 'revamp-role':     return tidyRole(parseInt(btn.dataset.index, 10));
            case 'sort-experience': return sortExperience();
            case 'regroup-skills':  return regroupSkills();
        }
    }

    function tidySummary() {
        if (u.isBlank(state.resume.summary)) {
            return toast('Write a first draft, then this will tidy it up.', 'info');
        }
        var probe = u.deepClone(state.resume);
        var result = RB.revamp.run(probe);
        if (result.resume.summary === state.resume.summary) {
            return toast('Nothing to change — this summary is already clean.', 'ok');
        }
        state.resume.summary = result.resume.summary;
        afterEdit({ rebuildPanel: true });
        toast('Summary tidied. Check it still says what you mean.', 'ok');
    }

    function tidyRole(index) {
        var job = state.resume.experience[index];
        if (!job) return;

        var before = job.bullets.slice();
        var after = before
            .map(function (b) { return RB.revamp.rewriteBullet(b); })
            .filter(function (b) { return u.trim(b); });

        if (!after.length) {
            return toast('Add some bullets first.', 'info');
        }

        var changed = after.length !== before.filter(function (b) { return u.trim(b); }).length ||
            after.some(function (b, i) { return b !== u.trim(before[i]); });

        if (!changed) {
            return toast('These bullets are already in good shape.', 'ok');
        }

        job.bullets = after;
        afterEdit({ rebuildPanel: true });
        toast('Bullets rewritten. No numbers were invented — add those yourself.', 'ok');
    }

    function sortExperience() {
        state.resume.experience = model.sortByRecency(state.resume.experience);
        afterEdit({ rebuildPanel: true });
        toast('Roles sorted newest first.', 'ok');
    }

    function regroupSkills() {
        var probe = u.deepClone(state.resume);
        var result = RB.revamp.run(probe);
        state.resume.skills = result.resume.skills;
        afterEdit({ rebuildPanel: true });
        toast('Skills grouped and de-duplicated.', 'ok');
    }

    function loadSample() {
        confirmModal({
            title: 'Load the example CV?',
            message: 'This replaces everything currently in the editor with a worked example ' +
                'of a strong, ATS-friendly CV.',
            detail: 'Your other saved CVs are not affected.',
            okLabel: 'Load example'
        }).then(function (ok) {
            if (!ok) return;
            state.resume = model.sampleResume();
            state.recordName = 'Example CV';
            renderAll();
            markDirty();
            toast('Example loaded. Edit it, or clear it and start fresh.', 'ok');
        });
    }

    function clearResume() {
        confirmModal({
            title: 'Clear this CV?',
            message: 'Every field in the editor will be emptied.',
            detail: 'This affects only the CV currently open.',
            okLabel: 'Clear it',
            danger: true
        }).then(function (ok) {
            if (!ok) return;
            state.resume = model.blankResume();
            state.activeSection = 'contact';
            renderAll();
            markDirty();
            toast('Cleared.', 'ok');
        });
    }

    /* ============================================================
       CV MANAGER
       ============================================================ */

    function openCvManager() {
        var m = openModal({
            title: 'My CVs',
            subtitle: state.user
                ? 'Signed in as ' + state.user.displayName
                : 'Stored in this browser. Sign in to keep CVs under a profile.',
            size: 'md',
            body: '<div id="cv-list" class="space-y-2"><p class="text-sm text-slate-400">Loading…</p></div>',
            footer:
                '<button data-new-cv class="px-3.5 py-2 text-sm rounded-lg border border-slate-300 ' +
                    'text-slate-700 hover:bg-slate-100 flex items-center gap-1.5">' +
                    '<span data-lucide="plus" class="w-4 h-4"></span>New CV</button>' +
                '<button data-import class="px-3.5 py-2 text-sm rounded-lg border border-slate-300 ' +
                    'text-slate-700 hover:bg-slate-100">Restore backup</button>' +
                '<button data-backup class="px-3.5 py-2 text-sm rounded-lg bg-slate-800 text-white ' +
                    'hover:bg-slate-900">Download backup</button>'
        });

        function refresh() {
            store.listResumes().then(function (list) {
                var host = u.$('#cv-list', m.panel);
                if (!list.length) {
                    host.innerHTML = '<p class="text-sm text-slate-400 py-4">No saved CVs yet.</p>';
                    return;
                }
                host.innerHTML = list.map(function (rec) {
                    var isOpen = rec.id === state.recordId;
                    var audit = RB.ats.audit(model.migrate(rec.data));
                    return '<div class="flex items-center gap-3 p-3 rounded-lg border ' +
                        (isOpen ? 'border-sky-300 bg-sky-50' : 'border-slate-200 hover:bg-slate-50') + '">' +
                        '<div class="grow min-w-0">' +
                            '<div class="flex items-center gap-2">' +
                                '<span class="text-sm font-medium text-slate-800 truncate">' +
                                    u.esc(rec.name) + '</span>' +
                                (isOpen
                                    ? '<span class="chip chip-pass">open</span>'
                                    : '') +
                            '</div>' +
                            '<div class="text-xs text-slate-400 mt-0.5">' +
                                'ATS ' + audit.score + '/100 · updated ' + u.esc(relativeTime(rec.updatedAt)) +
                            '</div>' +
                        '</div>' +
                        '<div class="flex items-center gap-1 shrink-0">' +
                            (isOpen ? '' :
                                '<button data-open="' + u.escAttr(rec.id) + '" title="Open" ' +
                                'class="p-1.5 text-slate-400 hover:text-sky-600 rounded">' +
                                '<span data-lucide="folder-open" class="w-4 h-4"></span></button>') +
                            '<button data-rename="' + u.escAttr(rec.id) + '" title="Rename" ' +
                                'class="p-1.5 text-slate-400 hover:text-slate-700 rounded">' +
                                '<span data-lucide="pencil" class="w-4 h-4"></span></button>' +
                            '<button data-dupe="' + u.escAttr(rec.id) + '" title="Duplicate" ' +
                                'class="p-1.5 text-slate-400 hover:text-slate-700 rounded">' +
                                '<span data-lucide="copy" class="w-4 h-4"></span></button>' +
                            '<button data-del="' + u.escAttr(rec.id) + '" title="Delete" ' +
                                'class="p-1.5 text-slate-400 hover:text-red-600 rounded">' +
                                '<span data-lucide="trash-2" class="w-4 h-4"></span></button>' +
                        '</div>' +
                        '</div>';
                }).join('');
                refreshIcons(host);
            });
        }

        u.on(m.panel, 'click', function (e) {
            var open = e.target.closest('[data-open]');
            if (open) {
                return loadRecord(open.dataset.open).then(function () {
                    m.close();
                    toast('Opened.', 'ok');
                });
            }

            var rename = e.target.closest('[data-rename]');
            if (rename) return promptRename(rename.dataset.rename, refresh);

            var dupe = e.target.closest('[data-dupe]');
            if (dupe) {
                return store.duplicateResume(dupe.dataset.dupe).then(function () {
                    refresh();
                    toast('Duplicated.', 'ok');
                }).catch(function (err) { toast(err.message, 'error'); });
            }

            var del = e.target.closest('[data-del]');
            if (del) {
                var id = del.dataset.del;
                return confirmModal({
                    title: 'Delete this CV?',
                    message: 'This cannot be undone.',
                    detail: 'Download a backup first if you are not sure.',
                    okLabel: 'Delete',
                    danger: true
                }).then(function (ok) {
                    if (!ok) return;
                    return store.deleteResume(id).then(function () {
                        if (id === state.recordId) {
                            state.recordId = null;
                            return bootstrapRecord().then(refresh);
                        }
                        refresh();
                        toast('Deleted.', 'ok');
                    });
                });
            }

            if (e.target.closest('[data-new-cv]')) {
                return store.createResume('Untitled CV', model.blankResume(), state.template)
                    .then(function (rec) {
                        return loadRecord(rec.id);
                    }).then(function () {
                        m.close();
                        state.activeSection = 'contact';
                        renderAll();
                        toast('New CV created.', 'ok');
                    });
            }

            if (e.target.closest('[data-backup]')) {
                return store.exportBackup().then(function (payload) {
                    if (!payload.resumes.length) {
                        return toast('Nothing to back up yet.', 'info');
                    }
                    return RB.exporters.exportBackupJson(payload,
                        'nene-cv-backup-' + new Date().toISOString().slice(0, 10))
                        .then(function () {
                            toast('Backup downloaded. Keep it somewhere safe.', 'ok');
                        });
                });
            }

            if (e.target.closest('[data-import]')) {
                return pickJsonBackup().then(function (payload) {
                    if (!payload) return;
                    return store.importBackup(payload).then(function (n) {
                        refresh();
                        toast('Restored ' + n + ' CV' + (n === 1 ? '' : 's') + '.', 'ok');
                    });
                }).catch(function (err) { toast(err.message, 'error'); });
            }
        });

        refresh();
    }

    function promptRename(id, done) {
        store.getResume(id).then(function (rec) {
            if (!rec) return;
            var m = openModal({
                title: 'Rename CV',
                size: 'sm',
                body: '<label class="field-label block mb-1">Name</label>' +
                    '<input id="rename-input" data-autofocus class="input-field" ' +
                        'value="' + u.escAttr(rec.name) + '" maxlength="80">' +
                    '<p class="text-xs text-slate-400 mt-2">Name CVs after the role you are ' +
                    'targeting, e.g. "Data Analyst — Naledi".</p>',
                footer:
                    '<button data-close class="px-4 py-2 text-sm rounded-lg border border-slate-300 ' +
                        'text-slate-600 hover:bg-slate-100">Cancel</button>' +
                    '<button data-save class="px-4 py-2 text-sm rounded-lg bg-sky-600 text-white ' +
                        'hover:bg-sky-700">Save</button>'
            });

            function commit() {
                var name = u.trim(u.$('#rename-input', m.panel).value) || 'Untitled CV';
                store.updateResume(id, { name: name }).then(function () {
                    if (id === state.recordId) {
                        state.recordName = name;
                        renderIdentity();
                    }
                    m.close();
                    if (done) done();
                    toast('Renamed.', 'ok');
                });
            }

            u.on(u.$('[data-save]', m.panel), 'click', commit);
            u.on(u.$('#rename-input', m.panel), 'keydown', function (e) {
                if (e.key === 'Enter') commit();
            });
        });
    }

    function pickJsonBackup() {
        return new Promise(function (resolve, reject) {
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            input.onchange = function () {
                var file = input.files && input.files[0];
                if (!file) return resolve(null);
                var fr = new FileReader();
                fr.onload = function () {
                    try {
                        resolve(JSON.parse(String(fr.result)));
                    } catch (e) {
                        reject(new Error('That file is not valid JSON.'));
                    }
                };
                fr.onerror = function () { reject(new Error('Could not read that file.')); };
                fr.readAsText(file);
            };
            input.click();
        });
    }

    function relativeTime(ts) {
        if (!ts) return 'unknown';
        var diff = Date.now() - ts;
        var mins = Math.round(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + ' min ago';
        var hours = Math.round(mins / 60);
        if (hours < 24) return hours + ' hour' + (hours === 1 ? '' : 's') + ' ago';
        var days = Math.round(hours / 24);
        if (days < 30) return days + ' day' + (days === 1 ? '' : 's') + ' ago';
        return new Date(ts).toLocaleDateString();
    }

    function loadRecord(id) {
        return store.getResume(id).then(function (rec) {
            if (!rec) throw new Error('That CV no longer exists.');
            state.recordId = rec.id;
            state.recordName = rec.name;
            state.resume = model.migrate(rec.data);
            state.template = rec.template || 'modern';
            renderAll();
        }).catch(function (err) {
            toast(err.message, 'error');
        });
    }

    /* ============================================================
       PROFILES
       ============================================================ */

    function openProfileModal() {
        if (store.isSignedIn()) return openSignedInProfile();
        return openSignInModal();
    }

    var SECURITY_NOTE = 'These profiles live only in this browser on this device. The PIN keeps ' +
        'other people using this computer out of your CVs — it is not cloud security, and anyone ' +
        'with developer tools on this machine could read the stored data. Download a backup to ' +
        'move your CVs elsewhere, and do not put anything you would not want a colleague to see ' +
        'in a CV field.';

    function openSignInModal() {
        var m = openModal({
            title: 'Profiles on this device',
            subtitle: 'Keep separate sets of CVs for different people sharing this browser.',
            size: 'sm',
            body:
                '<div id="profile-list" class="space-y-2 mb-4"></div>' +
                '<div class="border-t border-slate-200 pt-4">' +
                    '<div class="flex gap-2 mb-3">' +
                        '<button data-tab="signin" class="px-3 py-1.5 text-xs font-medium rounded-lg ' +
                            'bg-sky-600 text-white">Sign in</button>' +
                        '<button data-tab="create" class="px-3 py-1.5 text-xs font-medium rounded-lg ' +
                            'bg-slate-100 text-slate-600 hover:bg-slate-200">Create a profile</button>' +
                    '</div>' +
                    '<div id="profile-form"></div>' +
                '</div>' +
                '<p class="text-[11px] text-slate-400 leading-relaxed mt-4">' + u.esc(SECURITY_NOTE) + '</p>'
        });

        var mode = 'signin';

        function renderForm() {
            var host = u.$('#profile-form', m.panel);
            if (mode === 'signin') {
                host.innerHTML =
                    '<div class="space-y-3">' +
                        '<div><label class="field-label block mb-1">Profile name</label>' +
                        '<input id="pf-name" data-autofocus class="input-field" autocomplete="username"></div>' +
                        '<div><label class="field-label block mb-1">PIN</label>' +
                        '<input id="pf-pin" type="password" inputmode="numeric" class="input-field" ' +
                            'autocomplete="current-password" maxlength="8"></div>' +
                        '<button data-do="signin" class="w-full px-4 py-2 text-sm rounded-lg ' +
                            'bg-sky-600 text-white hover:bg-sky-700">Sign in</button>' +
                    '</div>';
            } else {
                host.innerHTML =
                    '<div class="space-y-3">' +
                        '<div><label class="field-label block mb-1">Your name</label>' +
                        '<input id="pf-name" data-autofocus class="input-field" ' +
                            'placeholder="Kagiso" autocomplete="username"></div>' +
                        '<div><label class="field-label block mb-1">Choose a PIN (4-8 digits)</label>' +
                        '<input id="pf-pin" type="password" inputmode="numeric" class="input-field" ' +
                            'autocomplete="new-password" maxlength="8"></div>' +
                        '<div><label class="field-label block mb-1">Confirm PIN</label>' +
                        '<input id="pf-pin2" type="password" inputmode="numeric" class="input-field" ' +
                            'autocomplete="new-password" maxlength="8"></div>' +
                        '<button data-do="create" class="w-full px-4 py-2 text-sm rounded-lg ' +
                            'bg-sky-600 text-white hover:bg-sky-700">Create profile</button>' +
                    '</div>';
            }

            var pin = u.$('#pf-pin', m.panel);
            u.on(pin, 'keydown', function (e) {
                if (e.key === 'Enter' && mode === 'signin') doSignIn();
            });
        }

        function renderProfiles() {
            store.listProfiles().then(function (profiles) {
                var host = u.$('#profile-list', m.panel);
                if (!profiles.length) {
                    host.innerHTML = '<p class="text-sm text-slate-400">No profiles yet. ' +
                        'You can keep using the app without one.</p>';
                    return;
                }
                host.innerHTML = profiles.map(function (p) {
                    return '<button data-pick="' + u.escAttr(p.displayName) + '" ' +
                        'class="w-full flex items-center gap-2.5 p-2.5 rounded-lg border ' +
                        'border-slate-200 hover:bg-slate-50 text-left">' +
                        '<span class="w-7 h-7 rounded-full bg-sky-100 text-sky-700 text-xs ' +
                            'font-semibold grid place-items-center">' +
                            u.esc(p.displayName.slice(0, 2).toUpperCase()) + '</span>' +
                        '<span class="text-sm text-slate-700">' + u.esc(p.displayName) + '</span>' +
                        '</button>';
                }).join('');
            });
        }

        function doSignIn() {
            var name = u.$('#pf-name', m.panel).value;
            var pin = u.$('#pf-pin', m.panel).value;
            store.signIn(name, pin)
                .then(function (user) {
                    state.user = user;
                    return store.claimGuestResumes();
                })
                .then(function (claimed) {
                    m.close();
                    renderIdentity();
                    if (claimed) {
                        toast('Signed in. ' + claimed + ' CV' + (claimed === 1 ? '' : 's') +
                              ' moved to your profile.', 'ok');
                    } else {
                        toast('Signed in as ' + state.user.displayName + '.', 'ok');
                    }
                    return bootstrapRecord();
                })
                .catch(function (err) { toast(err.message, 'error'); });
        }

        function doCreate() {
            var name = u.$('#pf-name', m.panel).value;
            var pin = u.$('#pf-pin', m.panel).value;
            var pin2 = u.$('#pf-pin2', m.panel).value;
            if (pin !== pin2) return toast('The two PINs do not match.', 'error');

            store.createProfile(name, pin)
                .then(function (user) {
                    state.user = user;
                    if (user.weakHashing) {
                        toast('Profile created. Note: this browser lacks WebCrypto, so the PIN ' +
                              'is only obfuscated, not properly hashed.', 'warn', 7000);
                    }
                    return store.claimGuestResumes();
                })
                .then(function (claimed) {
                    m.close();
                    renderIdentity();
                    toast('Profile created' + (claimed ? ', and your existing CVs moved across' : '') + '.', 'ok');
                    return bootstrapRecord();
                })
                .catch(function (err) { toast(err.message, 'error'); });
        }

        u.on(m.panel, 'click', function (e) {
            var tab = e.target.closest('[data-tab]');
            if (tab) {
                mode = tab.dataset.tab;
                u.$$('[data-tab]', m.panel).forEach(function (b) {
                    var on = b.dataset.tab === mode;
                    b.className = 'px-3 py-1.5 text-xs font-medium rounded-lg ' +
                        (on ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200');
                });
                renderForm();
                return;
            }

            var pick = e.target.closest('[data-pick]');
            if (pick) {
                mode = 'signin';
                u.$$('[data-tab]', m.panel).forEach(function (b) {
                    var on = b.dataset.tab === 'signin';
                    b.className = 'px-3 py-1.5 text-xs font-medium rounded-lg ' +
                        (on ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200');
                });
                renderForm();
                u.$('#pf-name', m.panel).value = pick.dataset.pick;
                u.$('#pf-pin', m.panel).focus();
                return;
            }

            var doBtn = e.target.closest('[data-do]');
            if (doBtn) {
                return doBtn.dataset.do === 'signin' ? doSignIn() : doCreate();
            }
        });

        renderProfiles();
        renderForm();
    }

    function openSignedInProfile() {
        var m = openModal({
            title: state.user.displayName,
            subtitle: 'Profile on this device',
            size: 'sm',
            body:
                '<div class="space-y-2">' +
                    '<button data-do="change-pin" class="w-full text-left p-3 rounded-lg border ' +
                        'border-slate-200 hover:bg-slate-50 text-sm text-slate-700">Change PIN</button>' +
                    '<button data-do="signout" class="w-full text-left p-3 rounded-lg border ' +
                        'border-slate-200 hover:bg-slate-50 text-sm text-slate-700">Sign out</button>' +
                    '<button data-do="delete" class="w-full text-left p-3 rounded-lg border ' +
                        'border-red-200 hover:bg-red-50 text-sm text-red-700">' +
                        'Delete this profile and all its CVs</button>' +
                '</div>' +
                '<p class="text-[11px] text-slate-400 leading-relaxed mt-4">' + u.esc(SECURITY_NOTE) + '</p>'
        });

        u.on(m.panel, 'click', function (e) {
            var btn = e.target.closest('[data-do]');
            if (!btn) return;

            if (btn.dataset.do === 'signout') {
                return store.signOut().then(function () {
                    state.user = null;
                    m.close();
                    renderIdentity();
                    toast('Signed out.', 'ok');
                    return bootstrapRecord();
                });
            }

            if (btn.dataset.do === 'change-pin') {
                m.close();
                return openChangePin();
            }

            if (btn.dataset.do === 'delete') {
                m.close();
                return openDeleteProfile();
            }
        });
    }

    function openChangePin() {
        var m = openModal({
            title: 'Change PIN',
            size: 'sm',
            body:
                '<div class="space-y-3">' +
                    '<div><label class="field-label block mb-1">Current PIN</label>' +
                    '<input id="cp-old" data-autofocus type="password" inputmode="numeric" ' +
                        'class="input-field" maxlength="8"></div>' +
                    '<div><label class="field-label block mb-1">New PIN (4-8 digits)</label>' +
                    '<input id="cp-new" type="password" inputmode="numeric" class="input-field" maxlength="8"></div>' +
                    '<div><label class="field-label block mb-1">Confirm new PIN</label>' +
                    '<input id="cp-new2" type="password" inputmode="numeric" class="input-field" maxlength="8"></div>' +
                '</div>',
            footer:
                '<button data-close class="px-4 py-2 text-sm rounded-lg border border-slate-300 ' +
                    'text-slate-600 hover:bg-slate-100">Cancel</button>' +
                '<button data-save class="px-4 py-2 text-sm rounded-lg bg-sky-600 text-white ' +
                    'hover:bg-sky-700">Change PIN</button>'
        });

        u.on(u.$('[data-save]', m.panel), 'click', function () {
            var oldPin = u.$('#cp-old', m.panel).value;
            var a = u.$('#cp-new', m.panel).value;
            var b = u.$('#cp-new2', m.panel).value;
            if (a !== b) return toast('The new PINs do not match.', 'error');

            store.changePin(oldPin, a).then(function () {
                m.close();
                toast('PIN changed.', 'ok');
            }).catch(function (err) { toast(err.message, 'error'); });
        });
    }

    function openDeleteProfile() {
        var m = openModal({
            title: 'Delete this profile?',
            size: 'sm',
            body:
                '<p class="text-sm text-slate-600 leading-relaxed mb-3">' +
                'This permanently deletes the profile <strong>' + u.esc(state.user.displayName) +
                '</strong> and every CV saved under it. It cannot be undone.</p>' +
                '<p class="text-sm text-slate-600 mb-3">Download a backup first if you might want ' +
                'these CVs later.</p>' +
                '<label class="field-label block mb-1">Enter your PIN to confirm</label>' +
                '<input id="dp-pin" data-autofocus type="password" inputmode="numeric" ' +
                    'class="input-field" maxlength="8">',
            footer:
                '<button data-close class="px-4 py-2 text-sm rounded-lg border border-slate-300 ' +
                    'text-slate-600 hover:bg-slate-100">Cancel</button>' +
                '<button data-del class="px-4 py-2 text-sm rounded-lg bg-red-600 text-white ' +
                    'hover:bg-red-700">Delete everything</button>'
        });

        u.on(u.$('[data-del]', m.panel), 'click', function () {
            store.deleteProfile(u.$('#dp-pin', m.panel).value).then(function () {
                state.user = null;
                state.recordId = null;
                m.close();
                renderIdentity();
                toast('Profile deleted.', 'ok');
                return bootstrapRecord();
            }).catch(function (err) { toast(err.message, 'error'); });
        });
    }

    /* ============================================================
       UPLOAD AND IMPORT
       ============================================================ */

    function openUploadModal() {
        var m = openModal({
            title: 'Upload an existing CV',
            subtitle: 'Read here in your browser. Nothing is uploaded to a server.',
            size: 'md',
            body:
                '<div id="dz" class="dropzone p-8 text-center cursor-pointer">' +
                    '<span data-lucide="upload-cloud" class="w-10 h-10 text-slate-300 mx-auto block mb-3"></span>' +
                    '<p class="text-sm font-medium text-slate-700">Drop your CV here, or click to choose</p>' +
                    '<p class="text-xs text-slate-400 mt-1.5">PDF, .docx or .txt — up to 12 MB</p>' +
                    '<input id="dz-input" type="file" class="hidden" accept=".pdf,.docx,.txt,.md">' +
                '</div>' +
                '<div id="dz-status" class="mt-4"></div>' +
                '<div class="mt-5 rounded-lg bg-slate-50 border border-slate-200 p-3.5">' +
                    '<p class="text-xs font-semibold text-slate-600 mb-1.5">What happens next</p>' +
                    '<ol class="text-xs text-slate-500 space-y-1 list-decimal list-inside leading-relaxed">' +
                        '<li>The text is extracted and split into sections.</li>' +
                        '<li>The rules engine fixes phrasing, ordering, dates and formatting.</li>' +
                        '<li>You get a full report of every change, then land in the editor to check it.</li>' +
                    '</ol>' +
                    '<p class="text-xs text-amber-700 mt-2.5 leading-relaxed">' +
                        'It rewrites wording, never facts. It will not invent numbers, tools or ' +
                        'employers — where a bullet needs a figure, it tells you instead.</p>' +
                '</div>'
        });

        var dz = u.$('#dz', m.panel);
        var input = u.$('#dz-input', m.panel);

        u.on(dz, 'click', function () { input.click(); });
        u.on(input, 'change', function () {
            if (input.files && input.files[0]) handleFile(input.files[0]);
        });

        ['dragenter', 'dragover'].forEach(function (type) {
            u.on(dz, type, function (e) {
                e.preventDefault();
                dz.classList.add('is-dragging');
            });
        });
        ['dragleave', 'drop'].forEach(function (type) {
            u.on(dz, type, function (e) {
                e.preventDefault();
                dz.classList.remove('is-dragging');
            });
        });
        u.on(dz, 'drop', function (e) {
            var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (file) handleFile(file);
        });

        function status(html) {
            u.$('#dz-status', m.panel).innerHTML = html;
            refreshIcons(m.panel);
        }

        function handleFile(file) {
            status('<div class="flex items-center gap-2.5 text-sm text-slate-600">' +
                spinner() + '<span>Reading ' + u.esc(file.name) + '…</span></div>');

            RB.parse.extractText(file)
                .then(function (extract) {
                    status('<div class="flex items-center gap-2.5 text-sm text-slate-600">' +
                        spinner() + '<span>Detecting sections and rebuilding…</span></div>');

                    var imported = RB.parse.toResume(extract);
                    var revamped = RB.revamp.run(imported.resume);

                    m.close();
                    showImportReport(file, imported, revamped);
                })
                .catch(function (err) {
                    status('<div class="rounded-lg bg-red-50 border border-red-200 p-3.5">' +
                        '<p class="text-sm text-red-800 font-medium mb-1">Could not read that file</p>' +
                        '<p class="text-xs text-red-700 leading-relaxed">' + u.esc(err.message) + '</p>' +
                        '</div>');
                });
        }
    }

    function spinner() {
        return '<svg class="animate-spin h-4 w-4 text-sky-600 shrink-0" viewBox="0 0 24 24" fill="none">' +
            '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' +
            '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>' +
            '</svg>';
    }

    function showImportReport(file, imported, revamped) {
        var found = imported.found;
        var beforeAudit = RB.ats.audit(imported.resume);
        var afterAudit = RB.ats.audit(revamped.resume);

        var body = '';

        /* What was read */
        body += '<div class="grid sm:grid-cols-2 gap-3 mb-5">' +
            scoreCard('Your original', beforeAudit.score, beforeAudit.band) +
            scoreCard('After the rebuild', afterAudit.score, afterAudit.band) +
            '</div>';

        body += '<div class="rounded-lg border border-slate-200 p-3.5 mb-4">' +
            '<p class="text-xs font-semibold text-slate-600 mb-2">Read from ' +
                u.esc(file.name) + '</p>' +
            '<div class="flex flex-wrap gap-1.5">' +
                foundChip('Name', found.name) +
                foundChip('Email', found.email) +
                foundChip('Phone', found.phone) +
                foundChip('Summary', found.summary) +
                foundChip(found.roles + ' role' + (found.roles === 1 ? '' : 's'), found.roles > 0) +
                foundChip(found.education + ' qualification' + (found.education === 1 ? '' : 's'), found.education > 0) +
                foundChip(found.skills + ' skills', found.skills > 0) +
                foundChip(found.certifications + ' certs', found.certifications > 0) +
                foundChip(found.projects + ' projects', found.projects > 0) +
            '</div>' +
            '</div>';

        /* Warnings — the honest part */
        if (imported.warnings.length) {
            body += '<div class="rounded-lg bg-amber-50 border border-amber-200 p-3.5 mb-4">' +
                '<p class="text-xs font-semibold text-amber-800 mb-2 flex items-center gap-1.5">' +
                '<span data-lucide="alert-triangle" class="w-3.5 h-3.5"></span>Please check these</p>' +
                '<ul class="text-xs text-amber-800 space-y-1.5 list-disc list-inside leading-relaxed">' +
                imported.warnings.map(function (w) { return '<li>' + u.esc(w) + '</li>'; }).join('') +
                '</ul></div>';
        }

        if (imported.dropped.length) {
            body += '<div class="rounded-lg bg-slate-50 border border-slate-200 p-3.5 mb-4">' +
                '<p class="text-xs font-semibold text-slate-600 mb-2">Deliberately left out</p>' +
                '<ul class="text-xs text-slate-500 space-y-1.5 list-disc list-inside leading-relaxed">' +
                imported.dropped.map(function (d) { return '<li>' + u.esc(d) + '</li>'; }).join('') +
                '</ul></div>';
        }

        body += changeLogHtml(revamped);

        var m = openModal({
            title: 'Import report',
            subtitle: 'Check this over, then open it in the editor.',
            size: 'lg',
            body: body,
            footer:
                '<button data-close class="px-4 py-2 text-sm rounded-lg border border-slate-300 ' +
                    'text-slate-600 hover:bg-slate-100">Discard</button>' +
                '<button data-keep-original class="px-4 py-2 text-sm rounded-lg border ' +
                    'border-slate-300 text-slate-700 hover:bg-slate-100">Import without rewriting</button>' +
                '<button data-accept class="px-4 py-2 text-sm rounded-lg bg-sky-600 text-white ' +
                    'hover:bg-sky-700">Open the rebuilt CV</button>'
        });

        function adopt(resume, label) {
            var name = u.trim(file.name).replace(/\.[^.]+$/, '').slice(0, 60) || 'Imported CV';
            store.createResume(name, resume, state.template)
                .then(function (rec) {
                    return loadRecord(rec.id);
                })
                .then(function () {
                    m.close();
                    state.activeSection = 'contact';
                    renderAll();
                    toast(label, 'ok', 5000);
                })
                .catch(function (err) { toast(err.message, 'error'); });
        }

        u.on(u.$('[data-accept]', m.panel), 'click', function () {
            adopt(revamped.resume, 'Imported and rebuilt. Check every section before you export.');
        });
        u.on(u.$('[data-keep-original]', m.panel), 'click', function () {
            adopt(imported.resume, 'Imported as-is, no rewriting applied.');
        });
    }

    function scoreCard(label, score, band) {
        var tones = {
            green: ['#10b981', 'text-emerald-700'],
            sky:   ['#0ea5e9', 'text-sky-700'],
            amber: ['#f59e0b', 'text-amber-700'],
            red:   ['#ef4444', 'text-red-700']
        };
        var tone = tones[band.tone] || tones.sky;
        return '<div class="rounded-lg border border-slate-200 p-3.5 flex items-center gap-3.5">' +
            '<div class="score-ring shrink-0" style="--pct:' + score + ';--ring:' + tone[0] + ';' +
                'width:4.5rem;height:4.5rem">' +
                '<span class="text-lg font-bold text-slate-800">' + score + '</span>' +
            '</div>' +
            '<div>' +
                '<p class="text-xs text-slate-400 uppercase tracking-wide font-semibold">' +
                    u.esc(label) + '</p>' +
                '<p class="text-sm font-semibold ' + tone[1] + ' mt-0.5">' + u.esc(band.label) + '</p>' +
            '</div>' +
            '</div>';
    }

    function foundChip(label, ok) {
        return '<span class="chip ' + (ok ? 'chip-pass' : 'chip-fail') + '">' +
            '<span data-lucide="' + (ok ? 'check' : 'x') + '" class="w-3 h-3"></span>' +
            u.esc(label) + '</span>';
    }

    function changeLogHtml(revamped) {
        var html = '';

        if (revamped.changes.length) {
            html += '<div class="mb-4">' +
                '<p class="text-xs font-semibold text-slate-600 mb-2">' +
                    revamped.changes.length + ' change' + (revamped.changes.length === 1 ? '' : 's') +
                    ' made</p>' +
                '<div class="space-y-2 max-h-72 overflow-y-auto pr-1">' +
                revamped.changes.map(function (c) {
                    return '<div class="rounded-lg border border-slate-200 p-2.5 text-xs">' +
                        '<p class="font-semibold text-slate-500 mb-1.5">' + u.esc(c.area) + '</p>' +
                        '<p class="text-red-700 line-through decoration-red-300 mb-1 leading-snug">' +
                            u.esc(truncate(c.before, 220)) + '</p>' +
                        '<p class="text-emerald-800 mb-1.5 leading-snug">' +
                            u.esc(truncate(c.after, 220)) + '</p>' +
                        '<p class="text-slate-400 italic leading-snug">' + u.esc(c.why) + '</p>' +
                        '</div>';
                }).join('') +
                '</div></div>';
        } else {
            html += '<p class="text-sm text-slate-500 mb-4">No wording changes were needed.</p>';
        }

        if (revamped.suggestions.length) {
            html += '<div class="rounded-lg bg-sky-50 border border-sky-200 p-3.5">' +
                '<p class="text-xs font-semibold text-sky-900 mb-2">' +
                    'Your turn — ' + revamped.suggestions.length + ' thing' +
                    (revamped.suggestions.length === 1 ? '' : 's') + ' only you can fix</p>' +
                '<div class="space-y-2 max-h-60 overflow-y-auto pr-1">' +
                revamped.suggestions.map(function (s) {
                    return '<div class="text-xs">' +
                        '<p class="font-medium text-sky-900">' + u.esc(s.text) + '</p>' +
                        '<p class="text-sky-700/80 leading-snug mt-0.5">' + u.esc(s.why) + '</p>' +
                        (s.area ? '<p class="text-sky-500/70 mt-0.5">' + u.esc(s.area) + '</p>' : '') +
                        '</div>';
                }).join('') +
                '</div></div>';
        }

        return html;
    }

    function truncate(s, n) {
        var t = u.trim(s);
        return t.length > n ? t.slice(0, n - 1) + '…' : t;
    }

    /* ============================================================
       REVAMP THE CURRENT CV
       ============================================================ */

    function openRevampModal() {
        if (model.isEmptyResume(state.resume)) {
            return toast('Add some content first, or upload an existing CV.', 'info');
        }

        var before = RB.ats.audit(state.resume);
        var revamped = RB.revamp.run(state.resume);
        var after = RB.ats.audit(revamped.resume);

        var body = '<div class="grid sm:grid-cols-2 gap-3 mb-5">' +
            scoreCard('Now', before.score, before.band) +
            scoreCard('After the rewrite', after.score, after.band) +
            '</div>' + changeLogHtml(revamped);

        var m = openModal({
            title: 'Revamp with rules',
            subtitle: 'Form only — it will not invent facts or figures.',
            size: 'lg',
            body: body,
            footer:
                '<button data-close class="px-4 py-2 text-sm rounded-lg border border-slate-300 ' +
                    'text-slate-600 hover:bg-slate-100">Cancel</button>' +
                (revamped.changes.length
                    ? '<button data-apply class="px-4 py-2 text-sm rounded-lg bg-sky-600 ' +
                      'text-white hover:bg-sky-700">Apply these changes</button>'
                    : '')
        });

        var applyBtn = u.$('[data-apply]', m.panel);
        if (applyBtn) {
            u.on(applyBtn, 'click', function () {
                state.resume = revamped.resume;
                renderAll();
                markDirty();
                m.close();
                toast(revamped.changes.length + ' change' +
                    (revamped.changes.length === 1 ? '' : 's') + ' applied.', 'ok');
            });
        }
    }

    /* ============================================================
       ATS REPORT
       ============================================================ */

    function openAtsReport() {
        var audit = RB.ats.audit(state.resume);
        state.lastAudit = audit;

        var tones = {
            green: ['#10b981', 'text-emerald-700'],
            sky:   ['#0ea5e9', 'text-sky-700'],
            amber: ['#f59e0b', 'text-amber-700'],
            red:   ['#ef4444', 'text-red-700']
        };
        var tone = tones[audit.band.tone] || tones.sky;

        var body =
            '<div class="flex flex-col sm:flex-row items-center gap-5 mb-5">' +
                '<div class="score-ring shrink-0" style="--pct:' + audit.score + ';--ring:' + tone[0] + '">' +
                    '<div class="text-center">' +
                        '<div class="text-2xl font-bold text-slate-800 leading-none">' + audit.score + '</div>' +
                        '<div class="text-[10px] text-slate-400 uppercase tracking-wide mt-0.5">of 100</div>' +
                    '</div>' +
                '</div>' +
                '<div>' +
                    '<p class="text-lg font-semibold ' + tone[1] + '">' + u.esc(audit.band.label) + '</p>' +
                    '<p class="text-sm text-slate-600 mt-1 leading-relaxed">' +
                        u.esc(audit.band.note) + '</p>' +
                    '<p class="text-xs text-slate-400 mt-2">' +
                        audit.stats.words + ' words · about ' + audit.stats.estimatedPages + ' page' +
                        (audit.stats.estimatedPages === 1 ? '' : 's') + ' · ' +
                        audit.stats.bulletCount + ' bullets · ' +
                        audit.stats.skillCount + ' skills' +
                    '</p>' +
                '</div>' +
            '</div>';

        /* Category bars */
        body += '<div class="space-y-2 mb-5">' +
            audit.categories.map(function (cat) {
                var pct = cat.weight ? Math.round((cat.earned / cat.weight) * 100) : 0;
                var barColor = pct >= 80 ? 'bg-emerald-500'
                             : pct >= 50 ? 'bg-sky-500'
                             : pct >= 30 ? 'bg-amber-500' : 'bg-red-500';
                return '<div>' +
                    '<div class="flex justify-between text-xs mb-1">' +
                        '<span class="font-medium text-slate-600">' + u.esc(cat.label) + '</span>' +
                        '<span class="text-slate-400">' + cat.earned + '/' + cat.weight + '</span>' +
                    '</div>' +
                    '<div class="h-1.5 rounded-full bg-slate-100 overflow-hidden">' +
                        '<div class="h-full rounded-full ' + barColor + '" style="width:' + pct + '%"></div>' +
                    '</div>' +
                    '</div>';
            }).join('') +
            '</div>';

        /* Failures first — that is the order to fix them in. */
        var order = { fail: 0, warn: 1, pass: 2 };
        var sorted = audit.checks.slice().sort(function (a, b) {
            return order[a.status] - order[b.status];
        });

        body += '<div class="space-y-2">' +
            sorted.map(function (check) {
                var chipClass = check.status === 'pass' ? 'chip-pass'
                              : check.status === 'warn' ? 'chip-warn' : 'chip-fail';
                var icon = check.status === 'pass' ? 'check'
                         : check.status === 'warn' ? 'alert-triangle' : 'x';
                return '<div class="rounded-lg border border-slate-200 p-3">' +
                    '<div class="flex items-start gap-2.5">' +
                        '<span class="chip ' + chipClass + ' mt-0.5 shrink-0">' +
                            '<span data-lucide="' + icon + '" class="w-3 h-3"></span></span>' +
                        '<div class="min-w-0">' +
                            '<p class="text-sm font-medium text-slate-700 leading-snug">' +
                                u.esc(check.label) + '</p>' +
                            (check.detail
                                ? '<p class="text-xs text-slate-500 mt-1 leading-relaxed">' +
                                  u.esc(check.detail) + '</p>'
                                : '') +
                            (check.fix
                                ? '<p class="text-xs text-sky-700 mt-1.5 leading-relaxed">' +
                                  u.esc(check.fix) + '</p>'
                                : '') +
                        '</div>' +
                    '</div>' +
                    '</div>';
            }).join('') +
            '</div>';

        openModal({
            title: 'ATS report',
            subtitle: audit.failCount + ' blocking · ' + audit.warnCount +
                      ' to improve · ' + audit.passCount + ' passing',
            size: 'lg',
            body: body
        });
    }

    /* ============================================================
       JOB MATCH
       ============================================================ */

    function openJobMatchModal() {
        var m = openModal({
            title: 'Match against a job ad',
            subtitle: 'Paste the advert. Everything is compared locally.',
            size: 'md',
            body:
                '<textarea id="jd" data-autofocus class="textarea-field font-mono text-xs" rows="12" ' +
                    'placeholder="Paste the full job advert here, including the requirements section…"></textarea>' +
                '<p class="text-xs text-slate-400 mt-2">Include the requirements or ' +
                    '"must have" section — terms there are weighted more heavily.</p>' +
                '<div id="jd-results" class="mt-4"></div>',
            footer:
                '<button data-close class="px-4 py-2 text-sm rounded-lg border border-slate-300 ' +
                    'text-slate-600 hover:bg-slate-100">Close</button>' +
                '<button data-run class="px-4 py-2 text-sm rounded-lg bg-sky-600 text-white ' +
                    'hover:bg-sky-700">Run the match</button>'
        });

        u.on(u.$('[data-run]', m.panel), 'click', function () {
            var text = u.$('#jd', m.panel).value;
            var result = RB.ats.matchJob(state.resume, text);
            var host = u.$('#jd-results', m.panel);

            if (result.error) {
                host.innerHTML = '<p class="text-sm text-red-600">' + u.esc(result.error) + '</p>';
                return;
            }

            var tones = {
                green: ['#10b981', 'text-emerald-700'],
                sky:   ['#0ea5e9', 'text-sky-700'],
                amber: ['#f59e0b', 'text-amber-700'],
                red:   ['#ef4444', 'text-red-700']
            };
            var tone = tones[result.band.tone] || tones.sky;

            var html =
                '<div class="border-t border-slate-200 pt-4">' +
                '<div class="flex items-center gap-4 mb-4">' +
                    '<div class="score-ring shrink-0" style="--pct:' + result.score +
                        ';--ring:' + tone[0] + ';width:5rem;height:5rem">' +
                        '<span class="text-xl font-bold text-slate-800">' + result.score + '%</span>' +
                    '</div>' +
                    '<div>' +
                        '<p class="text-base font-semibold ' + tone[1] + '">' +
                            u.esc(result.band.label) + '</p>' +
                        '<p class="text-xs text-slate-500 mt-1 leading-relaxed">' +
                            u.esc(result.band.note) + '</p>' +
                    '</div>' +
                '</div>';

            if (result.jobTitle) {
                html += '<div class="rounded-lg ' +
                    (result.titleAligned ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200') +
                    ' border p-3 mb-4">' +
                    '<p class="text-xs ' +
                        (result.titleAligned ? 'text-emerald-800' : 'text-amber-800') +
                        ' leading-relaxed">' +
                    (result.titleAligned
                        ? 'Your title line matches the advert ("' + u.esc(result.jobTitle) + '").'
                        : 'The advert looks like it is for "' + u.esc(result.jobTitle) + '", but your ' +
                          'title line says "' + u.esc(result.resumeTitle || '(empty)') + '". Change it ' +
                          'to match — only if it is honestly what you do.') +
                    '</p></div>';
            }

            if (result.missingRequired.length) {
                html += '<div class="mb-4">' +
                    '<p class="text-xs font-semibold text-red-700 mb-2">' +
                        'Missing, and listed as a requirement (' + result.missingRequired.length + ')</p>' +
                    '<div class="flex flex-wrap gap-1.5">' +
                    result.missingRequired.slice(0, 30).map(function (t) {
                        return '<span class="chip chip-fail">' + u.esc(t.term) + '</span>';
                    }).join('') +
                    '</div></div>';
            }

            var otherMissing = result.missing.filter(function (x) { return !x.required; });
            if (otherMissing.length) {
                html += '<div class="mb-4">' +
                    '<p class="text-xs font-semibold text-amber-700 mb-2">' +
                        'Also mentioned in the advert (' + otherMissing.length + ')</p>' +
                    '<div class="flex flex-wrap gap-1.5">' +
                    otherMissing.slice(0, 40).map(function (t) {
                        return '<span class="chip chip-warn">' + u.esc(t.term) + '</span>';
                    }).join('') +
                    '</div></div>';
            }

            if (result.matched.length) {
                html += '<div class="mb-4">' +
                    '<p class="text-xs font-semibold text-emerald-700 mb-2">' +
                        'Already in your CV (' + result.matched.length + ')</p>' +
                    '<div class="flex flex-wrap gap-1.5">' +
                    result.matched.slice(0, 50).map(function (t) {
                        return '<span class="chip chip-pass">' + u.esc(t.term) + '</span>';
                    }).join('') +
                    '</div></div>';
            }

            html += '<div class="rounded-lg bg-slate-50 border border-slate-200 p-3.5">' +
                '<p class="text-xs text-slate-600 leading-relaxed">' +
                '<strong>How to use this:</strong> add the missing terms only where they are ' +
                'genuinely true of you, and put them where they belong — a tool you have used goes ' +
                'in Skills, something you did goes in the bullet where you did it. Pasting a ' +
                'keyword list you cannot back up gets caught at interview, and some systems flag ' +
                'keyword stuffing outright.</p></div>';

            html += '</div>';
            host.innerHTML = html;
            refreshIcons(host);
        });
    }

    /* ============================================================
       COVER LETTER
       ============================================================ */

    function openCoverLetterModal() {
        var r = state.resume;

        if (u.isBlank(r.contact.name) || u.isBlank(r.summary)) {
            return toast('Fill in your name and summary first — the letter is built from them.', 'info');
        }

        var m = openModal({
            title: 'Cover letter draft',
            subtitle: 'A scaffold built from your CV. The bracketed parts are yours to write.',
            size: 'md',
            body:
                '<div class="grid sm:grid-cols-2 gap-3 mb-4">' +
                    '<div><label class="field-label block mb-1">Role you are applying for</label>' +
                    '<input id="cl-role" class="input-field" value="' +
                        u.escAttr(u.trim(r.contact.title)) + '"></div>' +
                    '<div><label class="field-label block mb-1">Company</label>' +
                    '<input id="cl-company" data-autofocus class="input-field" ' +
                        'placeholder="Company name"></div>' +
                '</div>' +
                '<textarea id="cl-text" class="textarea-field font-serif text-sm leading-relaxed" ' +
                    'rows="16"></textarea>' +
                '<p class="text-xs text-amber-700 mt-2 leading-relaxed">' +
                    'This is a structured starting point, not a finished letter. Recruiters spot a ' +
                    'template instantly — replace the bracketed parts with something specific about ' +
                    'this employer, or it will read worse than no letter at all.</p>',
            footer:
                '<button data-close class="px-4 py-2 text-sm rounded-lg border border-slate-300 ' +
                    'text-slate-600 hover:bg-slate-100">Close</button>' +
                '<button data-regen class="px-4 py-2 text-sm rounded-lg border border-slate-300 ' +
                    'text-slate-700 hover:bg-slate-100">Rebuild</button>' +
                '<button data-copy class="px-4 py-2 text-sm rounded-lg bg-sky-600 text-white ' +
                    'hover:bg-sky-700">Copy</button>'
        });

        function build() {
            var role = u.trim(u.$('#cl-role', m.panel).value) || '[job title]';
            var company = u.trim(u.$('#cl-company', m.panel).value) || '[Company]';
            u.$('#cl-text', m.panel).value = buildCoverLetter(r, role, company);
        }

        u.on(u.$('[data-regen]', m.panel), 'click', build);
        u.on(u.$('#cl-role', m.panel), 'input', build);
        u.on(u.$('#cl-company', m.panel), 'input', build);

        u.on(u.$('[data-copy]', m.panel), 'click', function () {
            u.copyText(u.$('#cl-text', m.panel).value)
                .then(function () { toast('Copied to the clipboard.', 'ok'); })
                .catch(function () { toast('Could not copy — select the text and copy manually.', 'error'); });
        });

        build();
    }

    function buildCoverLetter(r, role, company) {
        var lines = [];
        var today = new Date().toLocaleDateString(undefined, {
            year: 'numeric', month: 'long', day: 'numeric'
        });

        lines.push(u.trim(r.contact.name));
        var contactBits = [];
        ['email', 'phone', 'location'].forEach(function (k) {
            if (u.trim(r.contact[k])) contactBits.push(u.trim(r.contact[k]));
        });
        if (contactBits.length) lines.push(contactBits.join(' | '));
        lines.push('', today, '', 'Hiring Manager', company, '', 'Dear Hiring Manager,', '');

        lines.push('I am applying for the ' + role + ' position at ' + company + '.');
        lines.push('');

        if (u.trim(r.summary)) {
            lines.push(u.trim(r.summary));
            lines.push('');
        }

        /* Lead with the strongest quantified bullet available —
           evidence beats adjectives. Prefer a bullet from a real
           role; fall back to a project one, which is normal for
           early-career applications. */
        var quantified = model.allBullets(r).filter(function (b) {
            return RB.ats.METRIC_RE.test(b.text);
        });
        var pick = quantified
            .filter(function (b) { return b.source === 'experience'; })
            .concat(quantified.filter(function (b) { return b.source === 'project'; }))
            .slice(0, 2);

        if (pick.length) {
            /* A project bullet has no employer, so the sentence has to
               be framed differently — "At Acme I…" would be a fiction. */
            var lead = pick[0].source === 'experience'
                ? 'At ' + (u.trim(pick[0].job.company) || 'my most recent employer') + ' I '
                : 'Working on ' + (u.trim(pick[0].project.name) || 'a recent project') + ' I ';

            lines.push(lead + lowerFirst(stripPeriod(pick[0].text)) +
                (pick[1] ? '. I also ' + lowerFirst(stripPeriod(pick[1].text)) + '.' : '.'));
            lines.push('');
        }

        var topSkills = (r.skills[0] && r.skills[0].items.slice(0, 4)) || [];
        if (topSkills.length) {
            lines.push('The role calls for ' + topSkills.join(', ') +
                ', which is the core of my day-to-day work.');
            lines.push('');
        }

        lines.push('[One or two sentences on why this company specifically — a product you use, ' +
            'a project they published, something in the advert that matches what you want next. ' +
            'This paragraph is what separates a real application from a mass mailing, so do not ' +
            'skip it.]');
        lines.push('');
        lines.push('I would welcome the chance to talk it through. Thank you for your time.');
        lines.push('');
        lines.push('Yours sincerely,');
        lines.push(u.trim(r.contact.name));

        return lines.join('\n');
    }

    function lowerFirst(s) {
        var t = u.trim(s);
        if (!t) return t;
        // Leave acronyms and proper nouns alone.
        if (/^[A-Z]{2,}/.test(t)) return t;
        return t.charAt(0).toLowerCase() + t.slice(1);
    }

    function stripPeriod(s) {
        return u.trim(s).replace(/\.$/, '');
    }

    /* ============================================================
       EXPORT
       ============================================================ */

    function openExportModal() {
        var audit = RB.ats.audit(state.resume);

        var warning = '';
        if (audit.failCount) {
            warning = '<div class="rounded-lg bg-amber-50 border border-amber-200 p-3.5 mb-4">' +
                '<p class="text-xs text-amber-800 leading-relaxed">' +
                '<strong>' + audit.failCount + ' blocking issue' +
                (audit.failCount === 1 ? '' : 's') + '</strong> in the ATS report. You can still ' +
                'export, but fixing those first is worth more than any format choice.</p></div>';
        }

        var m = openModal({
            title: 'Export',
            subtitle: 'Every format below carries real, extractable text.',
            size: 'md',
            body: warning +
                '<div class="space-y-2.5">' +
                    exportRow('pdf', 'file-down', 'PDF',
                        'Typeset with a real text layer — open it and press Ctrl+F to confirm. ' +
                        'The safest default for most applications.') +
                    exportRow('docx', 'file-text', 'Word (.docx)',
                        'Genuine Word XML, not HTML in a .docx wrapper. Use this when the advert ' +
                        'asks for Word, or when the portal is old.') +
                    exportRow('txt', 'file-code', 'Plain text',
                        'For "paste your CV here" boxes. Nothing parses better than this.') +
                    exportRow('html', 'file-code-2', 'HTML',
                        'Self-contained page for sharing as a link or attaching.') +
                    exportRow('print', 'printer', 'Print / Save as PDF',
                        "Your browser's own PDF export. Also real text, and lets you preview pagination.") +
                    exportRow('copy', 'clipboard', 'Copy as plain text',
                        'Straight to the clipboard for an online form.') +
                '</div>' +
                '<p class="text-xs text-slate-400 mt-4 leading-relaxed">' +
                'Avoid re-saving these through a design tool or a PDF compressor — that is how a ' +
                'text layer gets flattened into an image, which is the fastest way to score zero.</p>'
        });

        u.on(m.panel, 'click', function (e) {
            var row = e.target.closest('[data-export]');
            if (!row) return;
            doExport(row.dataset.export, m);
        });
    }

    function exportRow(key, icon, title, description) {
        return '<button data-export="' + u.escAttr(key) + '" ' +
            'class="w-full text-left flex items-start gap-3 p-3 rounded-lg border ' +
            'border-slate-200 hover:border-sky-300 hover:bg-sky-50/50 transition-colors">' +
            '<span data-lucide="' + u.escAttr(icon) + '" class="w-5 h-5 text-sky-600 mt-0.5 shrink-0"></span>' +
            '<span class="min-w-0">' +
                '<span class="block text-sm font-medium text-slate-800">' + u.esc(title) + '</span>' +
                '<span class="block text-xs text-slate-500 mt-0.5 leading-relaxed">' +
                    u.esc(description) + '</span>' +
            '</span>' +
            '</button>';
    }

    function doExport(kind, m) {
        var r = state.resume;
        var base = u.trim(r.contact.name) || state.recordName;

        function done(message) {
            toast(message, 'ok');
            if (m) m.close();
        }
        function fail(err) {
            toast(err.message || 'Export failed.', 'error');
        }

        switch (kind) {
            case 'pdf':
                toast('Building the PDF…', 'info', 1500);
                return RB.exporters.exportPdf(r, state.template, base)
                    .then(function (res) {
                        done('PDF saved (' + res.pages + ' page' + (res.pages === 1 ? '' : 's') + ').');
                    }).catch(fail);

            case 'docx':
                toast('Building the Word file…', 'info', 1500);
                return RB.exporters.exportDocx(r, state.template, base)
                    .then(function () { done('Word file saved.'); }).catch(fail);

            case 'txt':
                return RB.exporters.exportTxt(r, base)
                    .then(function () { done('Text file saved.'); }).catch(fail);

            case 'html':
                return RB.exporters.exportHtml(r, state.template, base)
                    .then(function () { done('HTML file saved.'); }).catch(fail);

            case 'print':
                if (m) m.close();
                return RB.exporters.printResume(r, state.template);

            case 'copy':
                return u.copyText(RB.render.plainText(r))
                    .then(function () { done('Copied as plain text.'); })
                    .catch(function () { toast('Could not copy to the clipboard.', 'error'); });
        }
    }

    /* ============================================================
       BOOT
       ============================================================ */

    /* Pick a record to open: the most recently updated one, or a
       fresh one seeded from the legacy localStorage CV. */
    function bootstrapRecord() {
        return store.importLegacyIfPresent()
            .then(function () { return store.listResumes(); })
            .then(function (list) {
                if (list.length) return loadRecord(list[0].id);
                return store.createResume('Untitled CV', model.blankResume(), 'modern')
                    .then(function (rec) { return loadRecord(rec.id); });
            });
    }

    function boot() {
        wireEditing();

        u.on(u.$('#score-pill'), 'click', openAtsReport);

        // Warn on close only when a save is genuinely still pending.
        window.addEventListener('beforeunload', function (e) {
            if (!state.dirty) return;
            e.preventDefault();
            e.returnValue = '';
        });

        store.init()
            .then(function (info) {
                if (info.driver === 'localstorage') {
                    toast('Using simplified storage — this browser blocks its database on ' +
                          'local files. Everything works; download backups to be safe.', 'warn', 7000);
                }
                return store.currentUser();
            })
            .then(function (user) {
                state.user = user;
                return bootstrapRecord();
            })
            .then(function () {
                renderIdentity();
                refreshIcons();
            })
            .catch(function (err) {
                console.error(err);
                // Storage is unavailable — keep the editor usable in memory.
                renderAll();
                toast('Saving is unavailable in this browser, so your work will not persist. ' +
                      'Export before you close the tab.', 'error', 9000);
            });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    /* Exposed for debugging in the console. */
    RB.app = {
        state: state,
        render: renderAll,
        audit: function () { return RB.ats.audit(state.resume); }
    };
})(window.RB);

/* ============================================================
   model.js — the resume schema, blank/sample documents, and
   migration from the old flat format.

   Schema v2:
   {
     contact:        { name, title, email, phone, linkedin, portfolio, location },
     summary:        "string",
     experience:     [{ id, title, company, location, startDate, endDate, current, bullets:[] }],
     education:      [{ id, degree, institution, location, startDate, endDate, details }],
     skills:         [{ id, category, items:[] }],
     certifications: [{ id, name, issuer, date }],
     projects:       [{ id, name, tech, link, bullets:[] }]
   }

   Projects carry bullets, not a single description blob, for the
   same reason experience does: a project worth listing has several
   distinct things to say about it, and each one can be graded for
   an action verb and a metric. Flattening them into one paragraph
   produced unreadable walls of text on portfolio-heavy CVs.

   Dates are "YYYY-MM" strings (or a bare "YYYY"). Experience
   descriptions are arrays of bullets, not one blob of text —
   that is what lets the ATS engine grade them individually.
   ============================================================ */

(function (RB) {
    'use strict';

    var u = RB.util;

    var SCHEMA_VERSION = 2;

    /* Section order is fixed and deliberate: it is the order
       every major ATS expects, and reordering hurts parsing. */
    var SECTIONS = [
        { key: 'contact',        label: 'Contact',       icon: 'user' },
        { key: 'summary',        label: 'Summary',       icon: 'file-text' },
        { key: 'experience',     label: 'Experience',    icon: 'briefcase' },
        { key: 'education',      label: 'Education',     icon: 'graduation-cap' },
        { key: 'skills',         label: 'Skills',        icon: 'wrench' },
        { key: 'certifications', label: 'Certifications', icon: 'award' },
        { key: 'projects',       label: 'Projects',      icon: 'folder-git-2' }
    ];

    var TEMPLATES = [
        { key: 'professional', label: 'Professional', hint: 'Centred header, plain bold headings' },
        { key: 'modern',       label: 'Modern',       hint: 'Sans-serif, one accent colour' },
        { key: 'classic',      label: 'Classic',      hint: 'Times, pure black & white' },
        { key: 'executive',    label: 'Executive',    hint: 'Serif body, sans headings' },
        { key: 'compact',      label: 'Compact',      hint: 'Tighter spacing for long CVs' }
    ];

    function blankResume() {
        return {
            _v: SCHEMA_VERSION,
            contact: {
                name: '',
                title: '',
                email: '',
                phone: '',
                linkedin: '',
                portfolio: '',
                location: ''
            },
            summary: '',
            experience: [newExperience()],
            education: [newEducation()],
            skills: [newSkillGroup('Core Skills')],
            certifications: [],
            projects: []
        };
    }

    /* A filled-in example so a first-time user sees the shape of a
       strong, ATS-friendly CV rather than an empty page. */
    function sampleResume() {
        return {
            _v: SCHEMA_VERSION,
            contact: {
                name: 'Thandi Mokoena',
                title: 'Data Analyst',
                email: 'thandi.mokoena@example.com',
                phone: '+27 82 555 0134',
                linkedin: 'linkedin.com/in/thandimokoena',
                portfolio: 'github.com/thandimokoena',
                location: 'Johannesburg, South Africa'
            },
            summary: 'Data analyst with four years of experience turning operational data into ' +
                'decisions for retail and logistics teams. Builds SQL pipelines and Power BI ' +
                'reporting that shortened month-end close from nine days to three. Strongest in ' +
                'demand forecasting, pricing analysis and stakeholder reporting.',
            experience: [
                {
                    id: u.uid(),
                    title: 'Data Analyst',
                    company: 'Naledi Retail Group',
                    location: 'Johannesburg, ZA',
                    startDate: '2023-03',
                    endDate: '',
                    current: true,
                    bullets: [
                        'Rebuilt the demand forecasting model in Python, cutting stockouts by 22% across 140 stores.',
                        'Automated 14 manual Excel reports into a single Power BI workspace, saving the team roughly 30 hours a month.',
                        'Partnered with pricing and category managers to run 9 A/B tests, lifting gross margin by 1.8 percentage points.',
                        'Documented and standardised 60+ SQL models, reducing new-analyst onboarding from three weeks to five days.'
                    ]
                },
                {
                    id: u.uid(),
                    title: 'Junior Business Analyst',
                    company: 'Kgosi Logistics',
                    location: 'Pretoria, ZA',
                    startDate: '2021-01',
                    endDate: '2023-02',
                    current: false,
                    bullets: [
                        'Analysed 2.4 million delivery records to identify route inefficiencies, informing a re-plan that cut fuel spend by 11%.',
                        'Built the operations scorecard used weekly by the executive team, replacing three separate spreadsheets.',
                        'Trained 18 depot supervisors on the new reporting tool, reaching 95% weekly active use within two months.'
                    ]
                }
            ],
            education: [
                {
                    id: u.uid(),
                    degree: 'BCom Honours, Information Systems',
                    institution: 'University of Cape Town',
                    location: 'Cape Town, ZA',
                    startDate: '2017-02',
                    endDate: '2020-12',
                    details: 'Graduated cum laude. Final-year project on retail demand forecasting.'
                }
            ],
            skills: [
                { id: u.uid(), category: 'Technical', items: ['SQL', 'Python', 'pandas', 'Power BI', 'Excel (advanced)', 'dbt', 'Git'] },
                { id: u.uid(), category: 'Analytics', items: ['Demand forecasting', 'A/B testing', 'Cohort analysis', 'Pricing analysis', 'Data modelling'] },
                { id: u.uid(), category: 'Professional', items: ['Stakeholder reporting', 'Requirements gathering', 'Agile delivery'] }
            ],
            certifications: [
                { id: u.uid(), name: 'Microsoft Certified: Power BI Data Analyst Associate', issuer: 'Microsoft', date: '2024-06' },
                { id: u.uid(), name: 'AWS Certified Cloud Practitioner', issuer: 'Amazon Web Services', date: '2023-09' }
            ],
            projects: [
                {
                    id: u.uid(),
                    name: 'Township Retail Price Index',
                    tech: 'Python, Streamlit, PostgreSQL',
                    link: 'github.com/thandimokoena/tr-price-index',
                    bullets: [
                        'Built an open dataset tracking weekly basket prices across 40 informal retailers in Gauteng.',
                        'Automated collection and cleaning of roughly 1,200 price points a month with a Python scraper and validation rules.',
                        'Published a Streamlit dashboard now cited by two university research groups.'
                    ]
                }
            ]
        };
    }

    function newExperience() {
        return {
            id: u.uid(),
            title: '',
            company: '',
            location: '',
            startDate: '',
            endDate: '',
            current: false,
            bullets: ['']
        };
    }

    function newEducation() {
        return {
            id: u.uid(),
            degree: '',
            institution: '',
            location: '',
            startDate: '',
            endDate: '',
            details: ''
        };
    }

    function newSkillGroup(category) {
        return { id: u.uid(), category: category || '', items: [] };
    }

    function newCertification() {
        return { id: u.uid(), name: '', issuer: '', date: '' };
    }

    function newProject() {
        return { id: u.uid(), name: '', tech: '', link: '', bullets: [''] };
    }

    /* ------------------------------------------------------------
       migrate() — accepts anything previously stored (v1 flat
       format, a partial object, or already-v2) and returns a
       complete, valid v2 document. Never throws: a malformed
       field is replaced rather than propagated.
       ------------------------------------------------------------ */
    function migrate(raw) {
        var base = blankResume();
        if (!raw || typeof raw !== 'object') return base;

        var out = blankResume();

        /* contact */
        var c = raw.contact && typeof raw.contact === 'object' ? raw.contact : {};
        Object.keys(out.contact).forEach(function (k) {
            out.contact[k] = typeof c[k] === 'string' ? stripPlaceholder(c[k], k) : '';
        });

        /* summary */
        out.summary = typeof raw.summary === 'string'
            ? stripPlaceholder(raw.summary, 'summary')
            : '';

        /* experience — v1 stored one "description" string */
        if (Array.isArray(raw.experience)) {
            var exps = raw.experience.map(function (job) {
                if (!job || typeof job !== 'object') return newExperience();
                var bullets;
                if (Array.isArray(job.bullets)) {
                    bullets = job.bullets.filter(function (b) { return typeof b === 'string'; });
                } else {
                    bullets = splitBullets(job.description);
                }
                if (!bullets.length) bullets = [''];

                return {
                    id: job.id || u.uid(),
                    title: stripPlaceholder(job.title, 'jobTitle'),
                    company: stripPlaceholder(job.company, 'company'),
                    location: u.trim(job.location),
                    startDate: normaliseStoredDate(job.startDate),
                    endDate: normaliseStoredDate(job.endDate),
                    current: !!job.current ||
                        /^(present|current|now)$/i.test(u.trim(job.endDate)),
                    bullets: bullets
                };
            });
            if (exps.length) out.experience = exps;
        }

        /* education */
        if (Array.isArray(raw.education)) {
            var edus = raw.education.map(function (ed) {
                if (!ed || typeof ed !== 'object') return newEducation();
                return {
                    id: ed.id || u.uid(),
                    degree: stripPlaceholder(ed.degree, 'degree'),
                    institution: stripPlaceholder(ed.institution, 'institution'),
                    location: u.trim(ed.location),
                    startDate: normaliseStoredDate(ed.startDate),
                    // v1 had a single "year" field
                    endDate: normaliseStoredDate(ed.endDate || ed.year),
                    details: u.trim(ed.details)
                };
            });
            if (edus.length) out.education = edus;
        }

        /* skills — v1 was a flat string array */
        if (Array.isArray(raw.skills)) {
            if (raw.skills.length && typeof raw.skills[0] === 'string') {
                var flat = raw.skills
                    .map(u.trim)
                    .filter(function (s) { return s && !/^skill\s*\d+$/i.test(s); });
                out.skills = [{ id: u.uid(), category: 'Core Skills', items: flat }];
            } else {
                var groups = raw.skills.map(function (g) {
                    if (!g || typeof g !== 'object') return newSkillGroup();
                    return {
                        id: g.id || u.uid(),
                        category: u.trim(g.category),
                        items: Array.isArray(g.items) ? g.items.map(u.trim).filter(Boolean) : []
                    };
                });
                if (groups.length) out.skills = groups;
            }
        }
        if (!out.skills.length) out.skills = [newSkillGroup('Core Skills')];

        /* certifications & projects — new in v2 */
        if (Array.isArray(raw.certifications)) {
            out.certifications = raw.certifications
                .filter(function (x) { return x && typeof x === 'object'; })
                .map(function (x) {
                    return {
                        id: x.id || u.uid(),
                        name: u.trim(x.name),
                        issuer: u.trim(x.issuer),
                        date: normaliseStoredDate(x.date)
                    };
                });
        }

        if (Array.isArray(raw.projects)) {
            out.projects = raw.projects
                .filter(function (x) { return x && typeof x === 'object'; })
                .map(function (x) {
                    // Accept either shape: bullets (current) or a single
                    // description string (earlier saves and imports).
                    var bullets;
                    if (Array.isArray(x.bullets)) {
                        bullets = x.bullets.filter(function (b) { return typeof b === 'string'; });
                    } else {
                        bullets = splitBullets(x.description);
                    }
                    if (!bullets.length) bullets = [''];

                    return {
                        id: x.id || u.uid(),
                        name: u.trim(x.name),
                        tech: u.trim(x.tech),
                        link: u.trim(x.link),
                        bullets: bullets
                    };
                });
        }

        out._v = SCHEMA_VERSION;
        return out;
    }

    /* The v1 defaults were literal placeholder strings that got
       saved to storage and then exported into real CVs. Drop them. */
    var PLACEHOLDERS = {
        name: ['your name'],
        title: ['your job title'],
        email: ['your.email@example.com'],
        phone: ['(123) 456-7890'],
        linkedin: ['linkedin.com/in/yourprofile'],
        location: ['city, state'],
        jobTitle: ['job title'],
        company: ['company name'],
        degree: ['degree / field of study'],
        institution: ['university / institution name'],
        summary: ['a brief, impactful summary of your professional experience, skills, and goals. mention key accomplishments and what you bring to the table.']
    };

    function stripPlaceholder(value, kind) {
        var s = u.trim(value);
        if (!s) return '';
        var list = PLACEHOLDERS[kind];
        if (list && list.indexOf(s.toLowerCase()) !== -1) return '';
        if (/^(start|end|graduation)\s*year$/i.test(s)) return '';
        if (/^describe your key responsibilities/i.test(s)) return '';
        return s;
    }

    function normaliseStoredDate(value) {
        var s = u.trim(value);
        if (!s) return '';
        if (/^(present|current|now)$/i.test(s)) return '';
        if (/^\d{4}-\d{2}$/.test(s)) return s;
        // v1 used <input type="date"> → "2020-01-15"
        var full = /^(\d{4})-(\d{2})-\d{2}$/.exec(s);
        if (full) return full[1] + '-' + full[2];
        return u.parseToMonthValue(s) || s;
    }

    /* Split a v1 description blob (or any pasted text) into bullets. */
    function splitBullets(text) {
        if (typeof text !== 'string') return [];
        return text
            .split(/\r?\n/)
            .map(function (line) {
                return line.replace(/^\s*[•▪◦‣·*\-–—]+\s*/, '').trim();
            })
            .filter(function (line) {
                if (!line) return false;
                return !/^describe your key responsibilities/i.test(line);
            });
    }

    /* Sort experience/education newest-first, which is what
       reverse-chronological parsing expects. */
    function sortByRecency(list) {
        return list.slice().sort(function (a, b) {
            var ka = Math.max(u.monthSortKey(a.endDate, a.current), u.monthSortKey(a.startDate));
            var kb = Math.max(u.monthSortKey(b.endDate, b.current), u.monthSortKey(b.startDate));
            return kb - ka;
        });
    }

    /* Flatten to one plain-text blob — used for keyword matching. */
    function toPlainText(r) {
        var parts = [];
        parts.push(r.contact.name, r.contact.title, r.contact.location);
        parts.push(r.summary);
        r.experience.forEach(function (j) {
            parts.push(j.title, j.company, j.location);
            parts.push(j.bullets.join(' '));
        });
        r.education.forEach(function (e) {
            parts.push(e.degree, e.institution, e.details);
        });
        r.skills.forEach(function (g) {
            parts.push(g.category, g.items.join(' '));
        });
        r.certifications.forEach(function (c) { parts.push(c.name, c.issuer); });
        r.projects.forEach(function (p) {
            parts.push(p.name, p.tech, p.bullets.join(' '));
        });
        return parts.filter(Boolean).join('\n');
    }

    /* Every achievement bullet in the document, tagged with where it
       came from. Project bullets are graded alongside experience ones:
       they are the same kind of claim and deserve the same scrutiny
       for action verbs and numbers. Callers that only care about roles
       filter on `source`. */
    function allBullets(r) {
        var out = [];
        r.experience.forEach(function (j, ji) {
            j.bullets.forEach(function (b, bi) {
                if (u.trim(b)) {
                    out.push({
                        text: b, source: 'experience',
                        jobIndex: ji, bulletIndex: bi, job: j
                    });
                }
            });
        });
        r.projects.forEach(function (p, pi) {
            p.bullets.forEach(function (b, bi) {
                if (u.trim(b)) {
                    out.push({
                        text: b, source: 'project',
                        projectIndex: pi, bulletIndex: bi, project: p
                    });
                }
            });
        });
        return out;
    }

    function experienceBullets(r) {
        return allBullets(r).filter(function (b) { return b.source === 'experience'; });
    }

    function isEmptyResume(r) {
        if (!r) return true;
        return !u.trim(r.contact.name) &&
               !u.trim(r.summary) &&
               !r.experience.some(function (j) { return u.trim(j.title) || u.trim(j.company); });
    }

    RB.model = {
        SCHEMA_VERSION: SCHEMA_VERSION,
        SECTIONS: SECTIONS,
        TEMPLATES: TEMPLATES,
        blankResume: blankResume,
        sampleResume: sampleResume,
        newExperience: newExperience,
        newEducation: newEducation,
        newSkillGroup: newSkillGroup,
        newCertification: newCertification,
        newProject: newProject,
        migrate: migrate,
        splitBullets: splitBullets,
        sortByRecency: sortByRecency,
        toPlainText: toPlainText,
        allBullets: allBullets,
        experienceBullets: experienceBullets,
        isEmptyResume: isEmptyResume
    };
})(window.RB);

/* ============================================================
   revamp.js — the rules engine that rewrites a CV

   RB.revamp.run(resume) -> { resume, changes, suggestions }

   ── The line this engine will not cross ───────────────────────
   It rewrites FORM, never FACT. It will restructure a sentence,
   strip a pronoun, swap a weak verb for a strong one, fix a date
   format and dedupe a skills list. It will never invent a number,
   a tool, an employer or an outcome — a CV is a document someone
   signs their name to, and a fabricated metric is a fireable
   offence at best and fraud at worst.

   Where a bullet needs a number, the engine says so in
   `suggestions` and leaves the writing to the user.
   ── ───────────────────────────────────────────────────────────

   Every edit is recorded in `changes` so the user can see exactly
   what happened rather than trusting a black box.
   ============================================================ */

(function (RB) {
    'use strict';

    var u = RB.util;

    /* ---------- verb repair ----------
       Ordered: the first pattern that matches wins, so put the
       specific phrasings before the general ones. */

    var OPENER_REWRITES = [
        [/^responsible for (?:the )?(?:overall )?(?:management|managing|running|oversight|supervision|supervising) of\s+/i, 'Managed '],
        [/^responsible for (?:the )?(?:development|developing|creation|creating|building|design|designing) of\s+/i, 'Developed '],
        [/^responsible for (?:the )?(?:co-?ordination|co-?ordinating|coordination|coordinating) of\s+/i, 'Coordinated '],
        [/^responsible for (?:the )?(?:implementation|implementing|rollout|roll-out|delivery|delivering) of\s+/i, 'Delivered '],
        [/^responsible for (?:the )?(?:maintenance|maintaining|upkeep) of\s+/i, 'Maintained '],
        [/^responsible for (?:the )?(?:preparation|preparing|compilation|compiling) of\s+/i, 'Prepared '],
        [/^responsible for (?:the )?(?:reporting|analysis|analysing|analyzing) (?:of|on)\s+/i, 'Analysed '],
        [/^responsible for (?:the )?(?:training|mentoring|coaching) of\s+/i, 'Trained '],
        [/^responsible for ensuring\s+/i, 'Ensured '],
        [/^responsible for\s+(?=\w+ing\b)/i, ''],           // gerund handled below
        [/^responsible for\s+/i, 'Managed '],

        [/^(?:my )?duties (?:included|were|involved)\s*:?\s*/i, ''],
        [/^(?:key )?responsibilities (?:included|were)\s*:?\s*/i, ''],
        [/^tasked with\s+/i, ''],
        // Leaves a base-form verb, which baseToPast() then tenses.
        [/^was\s+able\s+to\s+/i, ''],
        [/^had\s+to\s+/i, ''],
        [/^was\s+required\s+to\s+/i, ''],
        [/^in charge of\s+/i, 'Led '],
        [/^accountable for\s+/i, 'Owned '],
        [/^involved in\s+/i, 'Contributed to '],
        [/^part of (?:a |the )?team (?:that|which)\s+/i, 'Collaborated to '],
        [/^worked (?:closely )?(?:together )?with\s+/i, 'Partnered with '],
        [/^worked (?:on|in|at|as)\s+/i, ''],
        [/^helped (?:to |with |in )?/i, 'Supported '],
        [/^assisted (?:in|with)\s+/i, 'Supported '],
        [/^assisted\s+/i, 'Supported '],
        [/^participated in\s+/i, 'Contributed to '],
        [/^successfully\s+/i, ''],                            // says nothing
        [/^effectively\s+/i, ''],
        [/^handled\s+/i, 'Managed '],
        [/^dealt with\s+/i, 'Resolved '],
        [/^took care of\s+/i, 'Managed '],
        [/^looked after\s+/i, 'Managed '],
        [/^made sure (?:that )?/i, 'Ensured '],
        [/^set up\s+/i, 'Established '],
        [/^liaised? with\s+/i, 'Liaised with '],
        [/^doing\s+/i, ''],
        [/^to\s+(?=\w+\s)/i, '']
    ];

    /* Gerund → past tense. Handles the doubling and -e rules that
       cover the overwhelming majority of English verbs. */
    var IRREGULAR_GERUND = {
        being: 'Served as', having: 'Held', doing: 'Delivered', making: 'Produced',
        running: 'Ran', leading: 'Led', building: 'Built', writing: 'Wrote',
        keeping: 'Kept', holding: 'Held', selling: 'Sold', buying: 'Bought',
        teaching: 'Taught', speaking: 'Presented', taking: 'Took', giving: 'Delivered',
        finding: 'Identified', meeting: 'Met', sending: 'Sent', dealing: 'Resolved',
        setting: 'Established', getting: 'Secured', bringing: 'Brought',
        thinking: 'Assessed', seeing: 'Reviewed', growing: 'Grew', drawing: 'Produced',
        overseeing: 'Oversaw', undertaking: 'Undertook', beginning: 'Initiated',
        winning: 'Won', cutting: 'Reduced', driving: 'Drove', choosing: 'Selected',
        rewriting: 'Rewrote', rebuilding: 'Rebuilt', troubleshooting: 'Troubleshot'
    };

    function gerundToPast(word) {
        var w = String(word).toLowerCase();
        if (IRREGULAR_GERUND[w]) return IRREGULAR_GERUND[w];
        if (!/ing$/.test(w)) return null;

        var stem = w.slice(0, -3);
        if (!stem || stem.length < 2) return null;

        // "planning" -> "plan" -> "planned"
        if (/([bdgklmnprtvz])\1$/.test(stem)) {
            return cap(stem.slice(0, -1) + 'ned'.slice(1) === '' ? stem : stem.slice(0, -1)) &&
                   cap(stem.slice(0, -1) + 'ed');
        }
        // "managing" -> "manag" -> "managed"
        if (/[^aeiou][aeiou][^aeiouwxy]$/.test(stem) === false && /[bcdfghjklmnpqrstvz]$/.test(stem)) {
            return cap(stem + 'ed');
        }
        // "creating" -> "creat" -> "created"
        return cap(stem + (/e$/.test(stem) ? 'd' : 'ed'));
    }

    function cap(s) {
        if (!s) return s;
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    /* Base form -> past tense, validated against the action-verb
       vocabulary so we only ever produce a word we know is real.
       "assist" -> "assisted", "manage" -> "managed", "identify" ->
       "identified". Returns null when nothing checks out, and the
       bullet is then left as the user wrote it. */
    var ACTION_VERB_SET = null;

    function baseToPast(word) {
        if (!ACTION_VERB_SET) {
            ACTION_VERB_SET = Object.create(null);
            RB.ats.ACTION_VERBS.forEach(function (v) { ACTION_VERB_SET[v] = true; });
        }

        var w = String(word).toLowerCase().replace(/[^a-z]/g, '');
        if (w.length < 3) return null;

        var candidates = [];
        if (/e$/.test(w)) candidates.push(w + 'd');
        if (/y$/.test(w) && !/[aeiou]y$/.test(w)) candidates.push(w.slice(0, -1) + 'ied');
        candidates.push(w + 'ed');
        // "plan" -> "planned"
        if (/[^aeiou][aeiou][bdglmnprt]$/.test(w)) candidates.push(w + w.slice(-1) + 'ed');

        for (var i = 0; i < candidates.length; i++) {
            if (ACTION_VERB_SET[candidates[i]]) return cap(candidates[i]);
        }
        return null;
    }

    /* Vague verbs that survive as sentence openers but say little. */
    var VERB_UPGRADES = [
        [/^Did\b/, 'Completed'],
        [/^Got\b/, 'Secured'],
        [/^Gave\b/, 'Delivered'],
        [/^Put\b/, 'Implemented'],
        [/^Went\b/, 'Progressed'],
        [/^Used\b/, 'Applied'],
        [/^Utilised\b/, 'Used'],
        [/^Utilized\b/, 'Used'],
        [/^Spoke\b/, 'Presented'],
        [/^Talked\b/, 'Presented'],
        [/^Made\b/, 'Produced'],
        [/^Helped\b/, 'Supported'],
        [/^Attended\b/, 'Contributed to']
    ];

    /* Wordy constructions that cost space without adding meaning. */
    var TIGHTEN = [
        [/\bin order to\b/gi, 'to'],
        [/\bfor the purpose of\b/gi, 'to'],
        [/\bwith the aim of\b/gi, 'to'],
        [/\bwith a view to\b/gi, 'to'],
        [/\bdue to the fact that\b/gi, 'because'],
        [/\bin the event that\b/gi, 'if'],
        [/\bat this point in time\b/gi, 'now'],
        [/\ba (?:large |significant |wide )?(?:number|variety|range) of\b/gi, 'many'],
        [/\bon a (daily|weekly|monthly|regular) basis\b/gi, function (_m, p1) {
            return p1.toLowerCase() === 'regular' ? 'regularly' : p1.toLowerCase();
        }],
        [/\bin conjunction with\b/gi, 'with'],
        [/\bin collaboration with\b/gi, 'with'],
        [/\bas well as\b/gi, 'and'],
        [/\bvarious different\b/gi, 'various'],
        [/\bcompletely eliminated\b/gi, 'eliminated'],
        [/\bpast (?:work )?experience\b/gi, 'experience'],
        [/\bend result\b/gi, 'result'],
        [/\bfuture plans\b/gi, 'plans'],
        [/\bclose proximity\b/gi, 'proximity'],
        [/\bexact same\b/gi, 'same'],
        [/\beach and every\b/gi, 'every'],
        [/\bfirst and foremost\b/gi, 'first'],
        [/\bin spite of the fact that\b/gi, 'although'],
        [/\bhas the ability to\b/gi, 'can'],
        /* "was able to" is handled by the opener rules instead, so the
           verb it leaves behind gets put into the past tense. Removing
           it here would strand a present-tense verb mid-bullet. */
        [/\bam able to\b/gi, 'can'],
        [/\bmyself and\b/gi, 'and'],
        [/\bthe team and I\b/gi, 'the team']
    ];

    /* Skill grouping. First match wins, so specific before general. */
    var SKILL_BUCKETS = [
        { category: 'Programming & Data', re: /^(python|r|java|javascript|typescript|c\+\+|c#|c\b|go|golang|rust|ruby|php|swift|kotlin|scala|perl|matlab|sas|stata|spss|sql|t-sql|pl\/sql|mysql|postgres(ql)?|oracle|sqlite|mongodb|cassandra|redis|dynamodb|snowflake|bigquery|redshift|databricks|spark|pyspark|hadoop|hive|kafka|airflow|dbt|pandas|numpy|scipy|scikit[\s-]?learn|tensorflow|pytorch|keras|xgboost|nltk|opencv|dax|m\s?query|vba|bash|shell|powershell)$/i },
        { category: 'Tools & Platforms', re: /^(aws|amazon web services|azure|gcp|google cloud|docker|kubernetes|k8s|terraform|ansible|jenkins|github( actions)?|gitlab( ci)?|bitbucket|git|ci\/cd|linux|unix|windows server|nginx|apache|power ?bi|tableau|looker|qlik(view|sense)?|excel.*|google (sheets|analytics|data studio)|looker studio|jira|confluence|asana|trello|monday\.com|notion|slack|figma|sketch|adobe.*|photoshop|illustrator|indesign|premiere|after effects|canva|autocad|solidworks|revit|sap|oracle (erp|ebs)|salesforce|hubspot|zendesk|freshdesk|dynamics|netsuite|xero|quickbooks|sage( pastel| \d+| evolution)?|pastel|vip( payroll)?|payspace|wordpress|shopify|webflow|postman|selenium|cypress|jest|pytest)$/i },
        { category: 'Frameworks & Libraries', re: /^(react|react native|next\.?js|vue|nuxt|angular|svelte|node\.?js|express|nest\.?js|django|flask|fastapi|spring( boot)?|laravel|symfony|rails|ruby on rails|\.net( core)?|asp\.net|blazor|flutter|xamarin|jquery|bootstrap|tailwind( ?css)?|material ui|redux|graphql|rest(ful)? api|grpc|soap|streamlit|dash)$/i },
        { category: 'Methods & Practice', re: /(agile|scrum|kanban|waterfall|safe|lean|six sigma|prince2|pmp|itil|devops|tdd|test driven|bdd|ci\/cd|design thinking|user research|usability testing|a\/b testing|root cause|process (improvement|mapping)|business process|requirements gathering|user stor(y|ies)|sprint planning|backlog|stakeholder|change management|risk management|project management|programme management|product management|okrs?|kpis?)/i },
        { category: 'Analysis & Reporting', re: /(data (analysis|analytics|modelling|modeling|visualisation|visualization|cleaning|wrangling|governance|quality)|statistical analysis|statistics|regression|forecasting|demand planning|predictive model|machine learning|deep learning|nlp|natural language|time series|cohort analysis|segmentation|attribution|financial (model|analysis|reporting)|budgeting|variance analysis|management accounts|reconciliation|dashboard|reporting|etl|elt|data pipeline|business intelligence)/i },
        { category: 'Compliance & Standards', re: /(gdpr|popia|hipaa|sox|ifrs|gaap|king iv|b-?bbee|iso ?\d+|ohs|occupational health|health (and|&) safety|saica|saipa|cima|acca|fais|fica|kyc|aml|basel|solvency|nqf|seta|audit|internal controls?)/i },
        /* All eleven official South African languages plus the common
           regional and international ones. Sepedi, Setswana and
           Xitsonga were missing, so they fell through to the generic
           bucket and were listed as professional skills. */
        { category: 'Languages', re: /^(english|afrikaans|zulu|isizulu|xhosa|isixhosa|sepedi|pedi|northern\s+sotho|sotho|sesotho|southern\s+sotho|setswana|tswana|tsonga|xitsonga|venda|tshivenda|swati|siswati|swazi|ndebele|isindebele|shangaan|french|german|spanish|portuguese|mandarin|cantonese|chinese|arabic|hindi|gujarati|tamil|urdu|swahili|kiswahili|dutch|flemish|italian|russian|polish|japanese|korean|shona|ndau|chichewa|nyanja|bemba|lingala|somali|amharic|oromo|tigrinya|yoruba|igbo|hausa|twi|akan|wolof|malagasy|greek|turkish|hebrew|farsi|persian|thai|vietnamese|indonesian|malay|tagalog|filipino)(\s*[-–]?\s*\(?(native|fluent|conversational|basic|intermediate|advanced|beginner|home\s+language|first\s+language|second\s+language|mother\s+tongue|business|professional|working\s+knowledge|read|write|speak)\)?)?$/i }
    ];

    var PROFESSIONAL_FALLBACK = 'Professional Skills';

    /* ============================================================
       RUN
       ============================================================ */

    function run(resume) {
        var out = u.deepClone(resume);
        var changes = [];
        var suggestions = [];

        function logChange(area, before, after, why) {
            changes.push({ area: area, before: before, after: after, why: why });
        }
        function suggest(area, text, why) {
            suggestions.push({ area: area, text: text, why: why });
        }

        cleanContact(out, logChange, suggest);
        cleanSummary(out, logChange, suggest);
        cleanExperience(out, logChange, suggest);
        cleanEducation(out, logChange);
        cleanSkills(out, logChange, suggest);
        cleanCertifications(out, logChange);
        cleanProjects(out, logChange, suggest);

        return { resume: out, changes: changes, suggestions: suggestions };
    }

    /* ---------- contact ---------- */

    function cleanContact(r, logChange, suggest) {
        var c = r.contact;

        var beforeName = c.name;
        if (c.name && /^[A-Z\s'’.-]{4,}$/.test(c.name)) {
            // forceTitleCase, not titleCase: the latter's acronym
            // exemption treats "SIPHO NKOSI" as two acronyms.
            c.name = u.forceTitleCase(c.name);
            logChange('Contact', beforeName, c.name,
                'ALL-CAPS names are harder to read and some parsers mis-split them.');
        }

        // Strip labels the header zone often carries in.
        ['email', 'phone', 'linkedin', 'portfolio', 'location'].forEach(function (k) {
            var before = c[k];
            if (!before) return;
            var after = u.trim(String(before)
                .replace(/^(e-?mail|email|tel(ephone)?|phone|mobile|cell(phone)?|contact|address|location|linkedin|portfolio|website|web)\s*[:：]?\s*/i, '')
                .replace(/^[|•·,-]\s*/, ''));
            if (after !== before) {
                c[k] = after;
                logChange('Contact', before, after, 'Removed the field label — the section already says what it is.');
            }
        });

        // "LinkedIn: https://www.linkedin.com/in/x/" -> "linkedin.com/in/x"
        if (c.linkedin) {
            var beforeLi = c.linkedin;
            c.linkedin = c.linkedin.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
            if (c.linkedin !== beforeLi) {
                logChange('Contact', beforeLi, c.linkedin, 'Shortened the URL so it fits on one line.');
            }
        }
        if (c.portfolio) {
            var beforeP = c.portfolio;
            c.portfolio = c.portfolio.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
            if (c.portfolio !== beforeP) {
                logChange('Contact', beforeP, c.portfolio, 'Shortened the URL so it fits on one line.');
            }
        }

        /* Personal details that should not be on a CV. These are
           protected characteristics: including them invites bias
           and, in the EU and UK, employers ask candidates not to. */
        if (!c.title) {
            suggest('Contact', 'Add the exact job title you are applying for under your name.',
                'The title line is weighted heavily in keyword matching, and it tells a recruiter in one second what you are.');
        }
        if (!u.isValidEmail(c.email)) {
            suggest('Contact', 'Add a valid, professional email address.',
                'An invalid email can stop the application record from being created at all.');
        }
        if (c.email && /@(hotmail|yahoo|aol|live|webmail)\./i.test(c.email)) {
            suggest('Contact', 'Consider a plainer email address, e.g. firstname.lastname@gmail.com.',
                'Legacy providers read as dated to some recruiters. Minor, but free to fix.');
        }
        if (c.email && /\d{4,}|sexy|babe|cool|xx|420|69/i.test(c.email.split('@')[0])) {
            suggest('Contact', 'Use a professional email address built from your name.',
                'Nicknames and long digit strings in an address undermine an otherwise strong CV.');
        }
    }

    /* ---------- summary ---------- */

    function cleanSummary(r, logChange, suggest) {
        var before = u.trim(r.summary);
        if (!before) {
            suggest('Summary', 'Write a 3-to-4-line professional summary.',
                'It is the densest keyword real estate on the page and the first thing a human reads. ' +
                'Formula: role + years of experience + two specialisms + one headline result.');
            return;
        }

        var text = before;

        /* ── Deliberately conservative ──────────────────────────────
           A summary is free-flowing prose, and prose cannot be safely
           edited with regular expressions. An earlier version of this
           function stripped clichés and pronouns mid-sentence and
           turned

             "I am a hard-working and highly motivated individual with
              excellent communication skills."

           into "And highly motivated individual with." — worse than
           leaving it alone, and dangerous because the user might not
           reread it before sending.

           So only transformations anchored at the very start of the
           text happen here, where the result is predictable. Every
           other problem is reported for the user to rewrite.
           ── ─────────────────────────────────────────────────────── */

        text = text
            // "I am a data analyst with…" -> "Data analyst with…"
            .replace(/^(?:i\s+am|i'?m)\s+(?:a|an)\s+/i, '')
            .replace(/^(?:i\s+am|i'?m)\s+/i, '');

        text = text.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
        text = cap(text);
        if (text && !/[.!?]$/.test(text)) text += '.';

        if (text !== before) {
            r.summary = text;
            logChange('Summary', before, text,
                'Dropped the "I am a…" opening — CV summaries are written without the first person.');
        }

        /* Flag, don't touch. */
        if (/\b(i|me|my|mine|myself|we|our|ours|us)\b/i.test(r.summary)) {
            suggest('Summary', 'Rewrite the summary without "I", "my" or "we".',
                'CV convention drops the first person: "Data analyst with four years of experience", ' +
                'not "I am a data analyst with four years of experience". This one is left to you — ' +
                'stripping pronouns out of the middle of a sentence by machine produces broken English.');
        }

        var cliches = RB.ats.CLICHES.filter(function (phrase) {
            return r.summary.toLowerCase().indexOf(phrase) !== -1;
        });
        if (cliches.length) {
            suggest('Summary', 'Replace ' + cliches.length + ' filler phrase' +
                (cliches.length === 1 ? '' : 's') + ': ' + cliches.slice(0, 4).join(', ') + '.',
                'These score nothing with a parser and read as padding to a recruiter. Swap each for ' +
                'evidence — instead of "hard-working", say what you delivered and how much of it.');
        }

        var words = u.wordCount(r.summary);
        if (words < 30) {
            suggest('Summary', 'Expand the summary to 40-110 words.',
                'At ' + words + ' words you are leaving the most valuable space on the page empty.');
        } else if (words > 140) {
            suggest('Summary', 'Cut the summary to 40-110 words.',
                'At ' + words + ' words it will be skimmed rather than read.');
        }
        if (!RB.ats.METRIC_RE.test(r.summary)) {
            suggest('Summary', 'Put one concrete number in your summary.',
                'A single figure — years of experience, team size, budget owned, a headline result — ' +
                'separates you from every candidate claiming the same adjectives.');
        }
    }

    /* ---------- experience ---------- */

    function cleanExperience(r, logChange, suggest) {
        r.experience.forEach(function (job, jobIndex) {
            var label = u.trim(job.title) || u.trim(job.company) || ('Role ' + (jobIndex + 1));

            /* Title casing */
            if (job.title && /^[A-Z\s'’&./-]{5,}$/.test(job.title)) {
                var beforeT = job.title;
                job.title = u.titleCase(job.title);
                logChange('Experience — ' + label, beforeT, job.title,
                    'ALL-CAPS job titles match keyword filters less reliably.');
            }

            /* Strip a trailing date that got glued into the company */
            if (job.company) {
                var beforeC = job.company;
                var after = u.trim(job.company.replace(/[,|(]?\s*(?:19|20)\d{2}\s*(?:-|–|to)?\s*(?:(?:19|20)\d{2}|present|current)?\s*\)?$/i, ''));
                if (after && after !== beforeC) {
                    job.company = after;
                    logChange('Experience — ' + label, beforeC, after,
                        'Moved the dates out of the employer name into the date fields.');
                }
            }

            /* Bullets */
            var cleaned = [];
            job.bullets.forEach(function (bullet) {
                var beforeB = u.trim(bullet);
                if (!beforeB) return;

                var afterB = rewriteBullet(beforeB);

                if (afterB && afterB !== beforeB) {
                    logChange('Experience — ' + label, beforeB, afterB, bulletReason(beforeB, afterB));
                }
                if (afterB) cleaned.push(afterB);
            });

            /* Dedupe near-identical bullets within a role. */
            var seen = Object.create(null);
            var deduped = [];
            cleaned.forEach(function (b) {
                var key = b.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
                if (seen[key]) {
                    logChange('Experience — ' + label, b, '(removed)',
                        'Duplicate of an earlier bullet in the same role.');
                    return;
                }
                seen[key] = true;
                deduped.push(b);
            });

            job.bullets = deduped.length ? deduped : [''];

            /* Suggestions, not silent edits. */
            var real = job.bullets.filter(function (b) { return u.trim(b); });

            if (real.length && real.length < 3 && (job.current || jobIndex < 2)) {
                suggest('Experience — ' + label,
                    'Add ' + (3 - real.length) + ' more bullet' + (3 - real.length === 1 ? '' : 's') + ' to this role.',
                    'Your most recent roles carry the most weight. Three to six bullets each is the target.');
            }

            var unquantified = real.filter(function (b) { return !RB.ats.METRIC_RE.test(b); });
            if (unquantified.length) {
                suggest('Experience — ' + label,
                    unquantified.length + ' of ' + real.length + ' bullets have no number in them.',
                    'The engine will not invent figures for you. Reach for: how many, how much, how ' +
                    'often, how fast, how big the team, how much saved or earned. Even a fair estimate beats none.');
            }

            var over = real.filter(function (b) { return b.length > 240; });
            if (over.length) {
                suggest('Experience — ' + label,
                    over.length + ' bullet' + (over.length === 1 ? ' runs' : 's run') + ' past three printed lines.',
                    'Split each into two, or cut the setup and keep the outcome.');
            }

            if (!job.startDate || (!job.endDate && !job.current)) {
                suggest('Experience — ' + label, 'Fill in the start and end dates for this role.',
                    'Missing dates stop a parser from computing your years of experience, and many ' +
                    'systems discard a role that has none.');
            }
            if (!job.location) {
                suggest('Experience — ' + label, 'Add the city for this role.',
                    'Location is a common filter and a common required field.');
            }
        });

        /* Reverse-chronological order. */
        var sorted = RB.model.sortByRecency(r.experience);
        var wasOutOfOrder = sorted.some(function (job, i) { return job.id !== r.experience[i].id; });
        if (wasOutOfOrder) {
            r.experience = sorted;
            logChange('Experience', 'Roles in original order', 'Roles newest-first',
                'Every ATS assumes reverse-chronological order; out-of-order roles produce a garbled career history.');
        }
    }

    function bulletReason(before, after) {
        var reasons = [];
        var b = before.toLowerCase();

        if (/^(responsible for|duties includ|tasked with|in charge of|involved in|worked on|helped|assisted|handled|my )/i.test(before)) {
            reasons.push('replaced a filler opener with an action verb');
        }
        if (RB.ats.BAD_GLYPHS.test(before) && !RB.ats.BAD_GLYPHS.test(after)) {
            reasons.push('removed a decorative character that parsers mangle');
        }
        if (/\b(i|my|we|our)\b/i.test(before) && !/\b(i|my|we|our)\b/i.test(after)) {
            reasons.push('removed first-person pronouns');
        }
        if (after.length < before.length - 8) {
            reasons.push('tightened wordy phrasing');
        }
        if (/[.]$/.test(before) === false && /[.]$/.test(after)) {
            reasons.push('added consistent end punctuation');
        }
        if (!reasons.length) reasons.push('normalised spacing, capitalisation and punctuation');

        return cap(reasons.join('; ')) + '.';
    }

    function rewriteBullet(text) {
        var s = u.trim(text);
        if (!s) return '';

        /* Strip leftover markers and decoration. */
        s = s.replace(RB.parse.BULLET_PREFIX, '');
        s = s.replace(new RegExp(RB.ats.BAD_GLYPHS.source, 'g'), ' ');
        s = s.replace(/\s{2,}/g, ' ').trim();

        /* First person out — but only where it is safe.
           Leading pronouns can go: the rest of the clause still
           stands. Mid-sentence ones cannot: deleting the "I" from
           "reports which I produced" leaves "reports which produced".
           Those are reported by the ATS audit instead. */
        s = s
            .replace(/^i\s+(?:was\s+)?(?:also\s+)?/i, '')
            .replace(/^we\s+(?:also\s+)?/i, '')
            .replace(/\bmy\s+/gi, '')        // "my team" -> "team"
            .replace(/\bour\s+/gi, 'the ');  // "our team" -> "the team"

        /* Opener repair. */
        for (var i = 0; i < OPENER_REWRITES.length; i++) {
            var pattern = OPENER_REWRITES[i][0];
            var replacement = OPENER_REWRITES[i][1];
            if (pattern.test(s)) {
                s = s.replace(pattern, replacement);
                break;
            }
        }
        s = s.trim();

        /* Put the opening verb into the past tense. Two cases:
           a gerund left behind by an opener rewrite ("Managing" ->
           "Managed"), and a base form left behind by one that
           removed an auxiliary ("was able to assist" -> "Assisted",
           not the present-tense "Assist"). */
        var firstWord = s.split(/\s+/)[0] || '';
        if (firstWord && !RB.ats.startsWithActionVerb(firstWord)) {
            var past = /ing$/i.test(firstWord)
                ? gerundToPast(firstWord)
                : baseToPast(firstWord);
            if (past) s = past + s.slice(firstWord.length);
        }

        /* Upgrade limp verbs. */
        s = cap(s.trim());
        for (var j = 0; j < VERB_UPGRADES.length; j++) {
            if (VERB_UPGRADES[j][0].test(s)) {
                s = s.replace(VERB_UPGRADES[j][0], VERB_UPGRADES[j][1]);
                break;
            }
        }

        /* Tightening only — no cliché surgery. Same reason as the
           summary: removing a phrase from the middle of a clause
           leaves ungrammatical text, and a bullet the user does not
           reread is a bullet that ships broken. The ATS audit lists
           the clichés it finds so they can be rewritten by hand. */
        s = applyTighten(s);

        /* Punctuation and spacing. */
        s = s
            .replace(/\s+([,.;:!?])/g, '$1')
            .replace(/([,;:])(?=\S)/g, '$1 ')
            .replace(/\s{2,}/g, ' ')
            .replace(/^[,;:.\s-]+/, '')
            .trim();

        s = cap(s);
        if (s && !/[.!?]$/.test(s)) s += '.';

        // A bullet reduced to nothing meaningful is dropped.
        if (u.wordCount(s) < 2) return '';

        return s;
    }

    function applyTighten(text) {
        var s = text;
        TIGHTEN.forEach(function (pair) {
            s = s.replace(pair[0], pair[1]);
        });
        return s.replace(/\s{2,}/g, ' ').trim();
    }

    /* ---------- education ---------- */

    function cleanEducation(r, logChange) {
        r.education.forEach(function (edu) {
            var label = u.trim(edu.degree) || u.trim(edu.institution) || 'Education entry';

            ['degree', 'institution'].forEach(function (field) {
                var before = edu[field];
                if (before && /^[A-Z\s'’&(),./-]{6,}$/.test(before)) {
                    edu[field] = u.titleCase(before);
                    logChange('Education — ' + label, before, edu[field],
                        'ALL-CAPS text is harder to read and matches less reliably.');
                }
            });

            /* Drop the grade/symbol noise that ZA and UK CVs often
               carry into the institution field. */
            var beforeI = edu.institution;
            if (beforeI) {
                var afterI = u.trim(beforeI.replace(/[,(]?\s*(?:currently\s+)?(?:studying|in\s+progress|incomplete)\s*\)?$/i, ''));
                if (afterI && afterI !== beforeI) {
                    edu.institution = afterI;
                    logChange('Education — ' + label, beforeI, afterI,
                        'Moved study status out of the institution name — use the date fields instead.');
                }
            }
        });

        var sorted = RB.model.sortByRecency(r.education);
        var changed = sorted.some(function (e, i) { return e.id !== r.education[i].id; });
        if (changed) {
            r.education = sorted;
            logChange('Education', 'Original order', 'Newest first',
                'Education is also read newest-first.');
        }
    }

    /* ---------- skills ---------- */

    function cleanSkills(r, logChange, suggest) {
        /* Flatten, clean, dedupe, then regroup by category. */
        var flat = [];
        r.skills.forEach(function (group) {
            group.items.forEach(function (item) {
                var s = u.trim(item)
                    .replace(RB.parse.BULLET_PREFIX, '')
                    .replace(new RegExp(RB.ats.BAD_GLYPHS.source, 'g'), '')
                    .replace(/[.,;:]+$/, '')
                    // Strip self-assessed ratings: nobody believes them
                    // and they add no keyword value.
                    .replace(/\s*[-–(]\s*(?:\d{1,3}\s*%|\d\s*\/\s*\d|[*★☆●○]{1,5}|advanced|intermediate|beginner|basic|expert|proficient|competent|working knowledge|excellent|good|fair)\s*\)?$/i, '')
                    /* Parenthesised self-ratings: "SQL (Basic - Learning)"
                       -> "SQL", "English (Fluent)" -> "English". Only when
                       the brackets contain a proficiency word, so genuinely
                       informative ones like "Python (Pandas)" survive. */
                    .replace(/\s*\([^)]*\b(?:basic|advanced|intermediate|beginner|expert|proficient|competent|learning|fluent|native|conversational|working\s+knowledge|in\s+progress)\b[^)]*\)\s*$/i, '')
                    .trim();

                /* A stray proficiency label on its own is not a skill.
                   Source CVs write "MS Excel - Advanced", and the
                   importer splits on " - ", so "Advanced" arrives here
                   as its own entry and would otherwise be listed as a
                   skill in its own right. */
                if (/^(advanced|intermediate|beginner|basic|expert|proficient|competent|excellent|good|fair|fluent|native|conversational|working knowledge|n\/?a)$/i.test(s)) {
                    return;
                }

                if (s && s.length <= 45) flat.push(s);
            });
        });

        var beforeCount = flat.length;

        /* Case-insensitive dedupe, keeping the best-cased variant. */
        var byKey = Object.create(null);
        flat.forEach(function (s) {
            var key = s.toLowerCase().replace(/[\s.\-_]/g, '');
            if (!byKey[key]) {
                byKey[key] = s;
            } else if (/[A-Z]/.test(s) && !/[A-Z]/.test(byKey[key])) {
                byKey[key] = s;   // prefer "SQL" over "sql"
            }
        });

        var unique = Object.keys(byKey).map(function (k) { return byKey[k]; });

        if (unique.length < beforeCount) {
            logChange('Skills', beforeCount + ' entries', unique.length + ' entries',
                'Removed ' + (beforeCount - unique.length) + ' duplicate or empty skill' +
                (beforeCount - unique.length === 1 ? '' : 's') + ', and stripped self-rated proficiency labels.');
        }

        /* Normalise the casing of well-known technologies. */
        var CANON = {
            'sql': 'SQL', 'html': 'HTML', 'css': 'CSS', 'php': 'PHP', 'aws': 'AWS',
            'gcp': 'GCP', 'api': 'API', 'apis': 'APIs', 'rest api': 'REST API',
            'etl': 'ETL', 'crm': 'CRM', 'erp': 'ERP', 'seo': 'SEO', 'sem': 'SEM',
            'kpi': 'KPIs', 'kpis': 'KPIs', 'ui': 'UI', 'ux': 'UX', 'ui/ux': 'UI/UX',
            'ci/cd': 'CI/CD', 'javascript': 'JavaScript', 'typescript': 'TypeScript',
            'nodejs': 'Node.js', 'node js': 'Node.js', 'node.js': 'Node.js',
            'reactjs': 'React', 'react js': 'React', 'vuejs': 'Vue.js',
            'nextjs': 'Next.js', 'power bi': 'Power BI', 'powerbi': 'Power BI',
            'github': 'GitHub', 'gitlab': 'GitLab', 'mysql': 'MySQL',
            'postgresql': 'PostgreSQL', 'postgres': 'PostgreSQL', 'mongodb': 'MongoDB',
            'ms excel': 'Microsoft Excel', 'msexcel': 'Microsoft Excel',
            'ms office': 'Microsoft Office', 'ms word': 'Microsoft Word',
            'powerpoint': 'PowerPoint', 'ms powerpoint': 'Microsoft PowerPoint',
            'saas': 'SaaS', 'b2b': 'B2B', 'b2c': 'B2C', 'popia': 'POPIA',
            'gdpr': 'GDPR', 'ifrs': 'IFRS', 'sars': 'SARS', 'b-bbee': 'B-BBEE',
            'bbbee': 'B-BBEE', 'a/b testing': 'A/B testing', 'devops': 'DevOps',
            'ios': 'iOS', 'macos': 'macOS', 'nlp': 'NLP', 'ml': 'Machine learning',
            'ai': 'AI', 'vba': 'VBA', 'sap': 'SAP', 'jira': 'Jira'
        };

        var canonicalised = 0;
        unique = unique.map(function (s) {
            var hit = CANON[s.toLowerCase()];
            if (hit && hit !== s) { canonicalised++; return hit; }
            return s;
        });
        if (canonicalised) {
            logChange('Skills', 'Mixed capitalisation', 'Standard capitalisation',
                'Corrected the casing of ' + canonicalised + ' well-known technolog' +
                (canonicalised === 1 ? 'y' : 'ies') + ' — exact-match filters are sometimes case-sensitive.');
        }

        /* Regroup. */
        var buckets = Object.create(null);
        var order = [];

        unique.forEach(function (skill) {
            var category = PROFESSIONAL_FALLBACK;
            for (var i = 0; i < SKILL_BUCKETS.length; i++) {
                if (SKILL_BUCKETS[i].re.test(skill)) {
                    category = SKILL_BUCKETS[i].category;
                    break;
                }
            }
            if (!buckets[category]) { buckets[category] = []; order.push(category); }
            buckets[category].push(skill);
        });

        /* Don't leave a category holding a single item — it looks
           thin. Fold singletons into the general bucket. */
        var finalOrder = order.filter(function (cat) {
            if (cat === PROFESSIONAL_FALLBACK) return true;
            if (buckets[cat].length >= 2) return true;
            if (!buckets[PROFESSIONAL_FALLBACK]) {
                buckets[PROFESSIONAL_FALLBACK] = [];
                order.push(PROFESSIONAL_FALLBACK);
            }
            buckets[PROFESSIONAL_FALLBACK] = buckets[PROFESSIONAL_FALLBACK].concat(buckets[cat]);
            return false;
        });
        if (finalOrder.indexOf(PROFESSIONAL_FALLBACK) === -1 && buckets[PROFESSIONAL_FALLBACK]) {
            finalOrder.push(PROFESSIONAL_FALLBACK);
        }

        var grouped = finalOrder
            .filter(function (cat) { return buckets[cat] && buckets[cat].length; })
            .map(function (cat) {
                return { id: u.uid(), category: cat, items: buckets[cat] };
            });

        var hadGroups = r.skills.filter(function (g) { return u.trim(g.category); }).length;
        if (grouped.length) {
            r.skills = grouped;
            if (grouped.length > 1 && hadGroups < 2) {
                logChange('Skills', 'One flat list', grouped.length + ' labelled categories',
                    'Grouped skills scan faster for a recruiter and parse into cleaner keyword sets.');
            }
        }

        var total = unique.length;
        if (total === 0) {
            suggest('Skills', 'Add 10 to 20 skills.',
                'The skills section is where keyword matching scores hardest.');
        } else if (total < 8) {
            suggest('Skills', 'Add ' + (10 - total) + ' more skills to reach at least 10.',
                'Include tools, methods and domain knowledge — not just software names.');
        } else if (total > 35) {
            suggest('Skills', 'Cut the list to your best 20 to 25.',
                'At ' + total + ' skills your strongest keywords are diluted, and long lists read as padding.');
        }
    }

    /* ---------- certifications ---------- */

    function cleanCertifications(r, logChange) {
        r.certifications.forEach(function (cert) {
            var before = cert.name;
            if (!before) return;
            var after = u.trim(before.replace(RB.parse.BULLET_PREFIX, '').replace(/[.,;]+$/, ''));
            if (/^[A-Z\s'’&(),./-]{8,}$/.test(after)) after = u.titleCase(after);
            if (after !== before) {
                cert.name = after;
                logChange('Certifications', before, after, 'Cleaned up formatting.');
            }
        });

        r.certifications = r.certifications.filter(function (c) {
            return u.trim(c.name).length > 2;
        });
    }

    /* ---------- projects ---------- */

    function cleanProjects(r, logChange, suggest) {
        r.projects.forEach(function (p) {
            var label = 'Projects — ' + (u.trim(p.name) || 'project');

            var cleaned = [];
            p.bullets.forEach(function (bullet) {
                var before = u.trim(bullet);
                if (!before) return;
                var after = rewriteBullet(before);
                if (after && after !== before) {
                    logChange(label, before, after, bulletReason(before, after));
                }
                if (after) cleaned.push(after);
            });
            p.bullets = cleaned.length ? cleaned : [''];

            if (p.link) {
                p.link = p.link.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
            }

            /* "Click here" tells a reader nothing and tells a parser
               less. The URL itself is the useful text. */
            if (/^(click here|link|here|view|see more|demo)$/i.test(u.trim(p.name))) {
                suggest(label, 'Give this project a real name instead of "' + u.trim(p.name) + '".',
                    'A link labelled "Click here" is invisible to keyword matching and meaningless ' +
                    'on a printed CV.');
            }

            var real = p.bullets.filter(function (b) { return u.trim(b); });
            var unquantified = real.filter(function (b) { return !RB.ats.METRIC_RE.test(b); });
            if (real.length && unquantified.length === real.length) {
                suggest(label, 'None of this project\'s bullets carry a number.',
                    'Projects are where you prove skills nobody has paid you for yet, so the ' +
                    'evidence matters more, not less: how many records, users, hours saved, or ' +
                    'sources consolidated.');
            }
            if (real.length > 6) {
                suggest(label, 'This project has ' + real.length + ' bullets — trim to your best 3 or 4.',
                    'A project described in more detail than your actual jobs looks out of proportion ' +
                    'to a recruiter.');
            }
        });
    }

    RB.revamp = {
        run: run,
        rewriteBullet: rewriteBullet,
        gerundToPast: gerundToPast
    };
})(window.RB);

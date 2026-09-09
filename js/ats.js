/* ============================================================
   ats.js — ATS scoring and job-description matching

   Two entry points:
     RB.ats.audit(resume)                 -> full 100-point report
     RB.ats.matchJob(resume, jobText)     -> keyword gap analysis

   The audit grades seven weighted categories. Each check returns
   a status (pass / warn / fail), the points earned, and a fix the
   user can actually act on. Nothing here is random or cosmetic:
   every rule maps to a documented behaviour of the major parsers
   (Workday, Greenhouse, Taleo, iCIMS, Lever, SuccessFactors) or
   to what recruiters filter on once a CV is in the system.
   ============================================================ */

(function (RB) {
    'use strict';

    var u = RB.util;

    /* ---------- vocabularies ---------- */

    /* Strong past-tense openers. A bullet that starts with one of
       these reads as an accomplishment; one that starts with
       "Responsible for" reads as a job description. */
    var ACTION_VERBS = ['accelerated','achieved','acquired','adapted','addressed','administered','advanced','advised','advocated','allocated','analysed','analyzed','answered','anticipated','applied','appointed','appraised','approved','arbitrated','arranged','assembled','assessed','assigned','assisted','audited','authored','automated','awarded','balanced','budgeted','built','calculated','captured','centralised','centralized','chaired','championed','changed','clarified','classified','coached','collaborated','collected','commissioned','communicated','compiled','completed','composed','computed','conceptualised','conceptualized','condensed','conducted','configured','consolidated','constructed','consulted','contracted','contributed','converted','convinced','coordinated','corrected','counselled','counseled','created','critiqued','cultivated','curated','cut','debugged','decentralised','decided','decreased','defined','delegated','delivered','demonstrated','deployed','designed','detected','determined','developed','devised','diagnosed','directed','discovered','dispatched','distributed','diversified','documented','doubled','drafted','drove','earned','edited','educated','eliminated','enabled','encouraged','endorsed','enforced','engineered','enhanced','enlisted','ensured','established','estimated','evaluated','examined','exceeded','executed','expanded','expedited','experimented','explained','extended','extracted','facilitated','filed','finalised','finalized','financed','forecast','forecasted','formalised','formed','formulated','fostered','founded','fulfilled','gained','gathered','generated','governed','grew','guided','halved','handled','headed','identified','illustrated','implemented','improved','improvised','increased','indexed','influenced','informed','initiated','innovated','inspected','inspired','installed','instituted','instructed','integrated','interpreted','interviewed','introduced','invented','inventoried','investigated','launched','lectured','led','leveraged','liaised','localised','logged','maintained','managed','mapped','marketed','maximised','maximized','measured','mediated','mentored','merged','migrated','minimised','minimized','mobilised','moderated','modelled','modeled','modernised','modified','monitored','motivated','navigated','negotiated','observed','obtained','onboarded','operated','optimised','optimized','orchestrated','ordered','organised','organized','originated','outlined','overhauled','oversaw','participated','partnered','performed','persuaded','photographed','pioneered','piloted','planned','predicted','prepared','presented','presided','prevented','prioritised','prioritized','processed','procured','produced','programmed','projected','promoted','proofread','proposed','prototyped','provided','publicised','published','purchased','pursued','quantified','queried','raised','ranked','rated','realigned','rebuilt','recommended','reconciled','recorded','recovered','recruited','redesigned','reduced','re-engineered','referred','refined','refocused','regulated','rehabilitated','reinforced','rejected','related','released','remodelled','rendered','reorganised','reorganized','repaired','replaced','reported','represented','researched','resolved','responded','restored','restructured','retrieved','reversed','reviewed','revised','revitalised','revitalized','rewrote','routed','safeguarded','salvaged','satisfied','saved','scheduled','screened','secured','segmented','selected','separated','served','serviced','set','shaped','shortened','showcased','simplified','simulated','solved','sorted','sourced','spearheaded','specialised','specified','sponsored','staffed','standardised','standardized','steered','stimulated','streamlined','strengthened','structured','studied','submitted','substituted','succeeded','summarised','summarized','superseded','supervised','supplied','supported','surpassed','surveyed','sustained','synthesised','synthesized','systematised','tabulated','tailored','targeted','taught','tested','tightened','tracked','traded','trained','transcribed','transferred','transformed','translated','transmitted','trimmed','tripled','troubleshot','tutored','uncovered','unified','updated','upgraded','used','utilised','utilized','validated','valued','verified','vetted','visualised','visualized','won','wrote'];

    var ACTION_VERB_SET = new Set(ACTION_VERBS);

    /* Openers that waste the most valuable words on the page. */
    var WEAK_OPENERS = [
        { re: /^responsible for\b/i,        fix: 'Start with the verb instead: "Managed…", "Owned…", "Ran…"' },
        { re: /^duties (included|were)\b/i, fix: 'Drop "Duties included" and lead with the achievement.' },
        { re: /^tasked with\b/i,            fix: 'Replace with the action you took.' },
        { re: /^helped (to |with )?\b/i,    fix: '"Helped" understates your role — try "Supported", "Contributed to", or name what you did.' },
        { re: /^worked (on|with|as)\b/i,    fix: '"Worked on" is vague — say what you produced or changed.' },
        { re: /^involved in\b/i,            fix: 'Name your specific contribution instead.' },
        { re: /^assisted (in|with)\b/i,     fix: 'Fine occasionally, but state the outcome you enabled.' },
        { re: /^in charge of\b/i,           fix: 'Use "Led", "Managed" or "Directed".' },
        { re: /^my (job|role|duties)\b/i,   fix: 'Remove the first person and lead with a verb.' },
        { re: /^handled\b/i,                fix: '"Handled" is weak — be specific about the action.' }
    ];

    /* Filler that recruiters and parsers both discount. */
    var CLICHES = ['hard-working','hard working','team player','go-getter','self-starter',
        'think outside the box','thinking outside the box','results-oriented','detail-oriented',
        'go the extra mile','dynamic professional','proven track record','synergy','synergies',
        'wear many hats','hit the ground running','best of breed','value add','win-win',
        'passionate about','highly motivated','excellent communication skills','fast learner',
        'people person','multitasker','guru','ninja','rockstar','wizard'];

    /* Bullet glyphs that survive in pasted text and confuse parsers. */
    var BAD_GLYPHS = /[▪▫◦‣⁃●○◆◇■□★☆✓✔✦➤➔→»·]/;

    /* Anything a parser will either drop or mangle. */
    var EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F2FF}]/u;

    var FIRST_PERSON = /\b(i|me|my|mine|myself|we|our|ours|us)\b/i;

    /* A metric is a number, percentage, currency amount, or a
       multiple. This is the single strongest signal of a good CV. */
    var METRIC_RE = /(\d+(\.\d+)?\s*%)|([$€£R]\s?\d)|(\b\d{1,3}(,\d{3})+\b)|(\b\d+(\.\d+)?\s*(k|m|bn|million|billion|thousand)\b)|(\b\d+(\.\d+)?\s*(x|times|fold)\b)|(\b\d+\b)/i;

    var STOP_WORDS = new Set(('a,an,the,and,or,but,if,then,else,so,as,of,to,in,on,at,by,for,with,from,into,onto,upon,about,above,below,under,over,between,among,through,during,before,after,while,without,within,across,against,per,via,is,am,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,will,would,shall,should,can,could,may,might,must,i,me,my,we,us,our,you,your,he,him,his,she,her,it,its,they,them,their,this,that,these,those,who,whom,which,what,when,where,why,how,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,than,too,very,just,also,etc,e.g,i.e,you,ll,re,ve,s,t,d,m,o,y,ability,able,across,including,include,includes,included,using,use,used,uses,work,working,works,role,job,position,candidate,applicant,team,teams,company,business,new,strong,good,great,well,plus,years,year,experience,experiences,required,requirement,requirements,preferred,desirable,responsibilities,responsibility,duties,skills,skill,knowledge,understanding,willing,must,ideal,ideally,looking,join,opportunity,environment,help,support,ensure,ensuring,provide,providing,manage,managing,deliver,delivering,develop,developing').split(','));

    /* Multi-word skills that must be matched as phrases, not split
       into meaningless single tokens. */
    var KNOWN_PHRASES = ['machine learning','deep learning','data science','data analysis','data analytics','data engineering','data modelling','data modeling','data visualisation','data visualization','business intelligence','power bi','microsoft excel','ms excel','google analytics','google cloud','amazon web services','project management','product management','change management','stakeholder management','risk management','account management','supply chain','customer service','customer success','quality assurance','quality control','continuous integration','continuous delivery','continuous deployment','version control','unit testing','integration testing','test automation','user experience','user interface','user research','graphic design','social media','content marketing','digital marketing','email marketing','search engine optimisation','search engine optimization','financial modelling','financial modeling','financial reporting','management accounting','accounts payable','accounts receivable','internal audit','due diligence','human resources','talent acquisition','performance management','payroll administration','occupational health','health and safety','standard operating procedures','key performance indicators','service level agreement','root cause analysis','process improvement','business process','requirements gathering','business analysis','systems analysis','solution architecture','cloud computing','network security','information security','cyber security','penetration testing','incident response','disaster recovery','technical support','customer support','stock control','inventory management','demand forecasting','pricing analysis','market research','public relations','event management','bid management','contract negotiation','vendor management','agile methodologies','scrum master','node js','node.js','react native','ruby on rails','spring boot','rest api','restful api','graph ql','graphql','ci cd','ci/cd','a b testing','a/b testing','object oriented','test driven development','microsoft office','office suite','sage pastel','vip payroll','b bbee','b-bbee'];

    /* ============================================================
       AUDIT
       ============================================================ */

    function audit(resume) {
        var checks = [];
        var categories = [];

        categories.push(auditContact(resume, checks));
        categories.push(auditSections(resume, checks));
        categories.push(auditDepth(resume, checks));
        categories.push(auditMetrics(resume, checks));
        categories.push(auditVerbs(resume, checks));
        categories.push(auditFormatting(resume, checks));
        categories.push(auditSkills(resume, checks));

        var earned = categories.reduce(function (sum, c) { return sum + c.earned; }, 0);
        var possible = categories.reduce(function (sum, c) { return sum + c.weight; }, 0);
        var score = possible ? Math.round((earned / possible) * 100) : 0;

        return {
            score: score,
            band: band(score),
            categories: categories,
            checks: checks,
            failCount: checks.filter(function (c) { return c.status === 'fail'; }).length,
            warnCount: checks.filter(function (c) { return c.status === 'warn'; }).length,
            passCount: checks.filter(function (c) { return c.status === 'pass'; }).length,
            stats: describe(resume)
        };
    }

    function band(score) {
        if (score >= 85) return { label: 'Strong', tone: 'green',
            note: 'This should parse cleanly and read well to a recruiter.' };
        if (score >= 70) return { label: 'Good', tone: 'sky',
            note: 'Solid foundation. Clear the warnings below to compete for senior roles.' };
        if (score >= 50) return { label: 'Needs work', tone: 'amber',
            note: 'It will parse, but weak content will cost you callbacks.' };
        return { label: 'At risk', tone: 'red',
            note: 'Likely to be filtered out. Start with the red items below.' };
    }

    function describe(resume) {
        var bullets = RB.model.allBullets(resume);
        return {
            words: u.wordCount(RB.model.toPlainText(resume)),
            bulletCount: bullets.length,
            roleCount: resume.experience.filter(function (j) {
                return u.trim(j.title) || u.trim(j.company);
            }).length,
            skillCount: countSkills(resume),
            estimatedPages: estimatePages(resume)
        };
    }

    function countSkills(resume) {
        return resume.skills.reduce(function (n, g) { return n + g.items.length; }, 0);
    }

    /* Rough page estimate: ~500 words of resume content per A4
       page at 10.5pt, plus overhead per entry. */
    function estimatePages(resume) {
        var words = u.wordCount(RB.model.toPlainText(resume));
        var entries = resume.experience.length + resume.education.length +
                      resume.projects.length + resume.certifications.length;
        var units = words + entries * 12;
        return Math.max(1, Math.round((units / 520) * 10) / 10);
    }

    function push(checks, id, label, status, points, weight, detail, fix) {
        checks.push({
            id: id, label: label, status: status,
            points: points, weight: weight,
            detail: detail, fix: fix || ''
        });
        return points;
    }

    /* ---------- 1. Contact block (15) ---------- */

    function auditContact(resume, checks) {
        var c = resume.contact;
        var weight = 15, earned = 0;

        earned += !u.isBlank(c.name)
            ? push(checks, 'name', 'Full name present', 'pass', 3, 3, u.trim(c.name))
            : push(checks, 'name', 'Full name missing', 'fail', 0, 3,
                'Every parser keys the candidate record off the name.',
                'Add your full name as it appears on your ID.');

        if (u.isBlank(c.email)) {
            earned += push(checks, 'email', 'Email address missing', 'fail', 0, 4,
                'Without an email the record often cannot be created at all.',
                'Add a professional email address.');
        } else if (!u.isValidEmail(c.email)) {
            earned += push(checks, 'email', 'Email address looks invalid', 'fail', 1, 4,
                '"' + u.trim(c.email) + '" will not validate.',
                'Use the form name@domain.com, with no spaces or extra text.');
        } else {
            earned += push(checks, 'email', 'Valid email address', 'pass', 4, 4, u.trim(c.email));
        }

        if (u.isBlank(c.phone)) {
            earned += push(checks, 'phone', 'Phone number missing', 'fail', 0, 3,
                'Recruiters filter on reachable candidates.',
                'Add a mobile number in international format, e.g. +27 82 555 0134.');
        } else if (!u.isValidPhone(c.phone)) {
            earned += push(checks, 'phone', 'Phone number looks incomplete', 'warn', 1, 3,
                '"' + u.trim(c.phone) + '" has an unusual number of digits.',
                'Include the country code and full number.');
        } else {
            earned += push(checks, 'phone', 'Phone number present', 'pass', 3, 3, u.trim(c.phone));
        }

        earned += !u.isBlank(c.location)
            ? push(checks, 'location', 'Location present', 'pass', 2, 2, u.trim(c.location))
            : push(checks, 'location', 'Location missing', 'warn', 0, 2,
                'Many systems rank or filter by proximity to the role.',
                'Add "City, Country" — a street address is not needed.');

        earned += !u.isBlank(c.linkedin)
            ? push(checks, 'linkedin', 'LinkedIn or portfolio link present', 'pass', 2, 2, u.trim(c.linkedin))
            : push(checks, 'linkedin', 'No LinkedIn or portfolio link', 'warn', 0, 2,
                'Recruiters routinely cross-check a profile before shortlisting.',
                'Add your LinkedIn URL, or a portfolio/GitHub link.');

        earned += !u.isBlank(c.title)
            ? push(checks, 'target-title', 'Target job title present', 'pass', 1, 1, u.trim(c.title))
            : push(checks, 'target-title', 'No target job title', 'warn', 0, 1,
                'The title line is heavily weighted in keyword matching.',
                'Put the exact title of the role you are applying for under your name.');

        return { key: 'contact', label: 'Contact details', weight: weight, earned: Math.min(earned, weight) };
    }

    /* ---------- 2. Required sections (15) ---------- */

    function auditSections(resume, checks) {
        var weight = 15, earned = 0;

        earned += !u.isBlank(resume.summary)
            ? push(checks, 'has-summary', 'Professional summary present', 'pass', 4, 4)
            : push(checks, 'has-summary', 'No professional summary', 'fail', 0, 4,
                'The summary is the first thing a human reads and a dense source of keywords.',
                'Write 3 to 4 lines: your role, years of experience, two specialisms, one headline result.');

        var realRoles = resume.experience.filter(function (j) {
            return u.trim(j.title) && u.trim(j.company);
        });
        if (!realRoles.length) {
            earned += push(checks, 'has-experience', 'No work experience entries', 'fail', 0, 6,
                'Experience is the section every parser looks for first.',
                'Add at least one role with a job title and employer.');
        } else {
            earned += push(checks, 'has-experience', realRoles.length + ' role' +
                (realRoles.length === 1 ? '' : 's') + ' listed', 'pass', 6, 6);
        }

        var realEdu = resume.education.filter(function (e) {
            return u.trim(e.degree) || u.trim(e.institution);
        });
        earned += realEdu.length
            ? push(checks, 'has-education', 'Education present', 'pass', 3, 3)
            : push(checks, 'has-education', 'No education entries', 'warn', 0, 3,
                'Many systems require an education record before an application can submit.',
                'Add your highest qualification — Matric or NSC counts.');

        earned += countSkills(resume) > 0
            ? push(checks, 'has-skills', 'Skills section present', 'pass', 2, 2)
            : push(checks, 'has-skills', 'No skills listed', 'fail', 0, 2,
                'Skills is where keyword matching scores hardest.',
                'List 10 to 20 concrete skills, grouped by type.');

        return { key: 'sections', label: 'Required sections', weight: weight, earned: Math.min(earned, weight) };
    }

    /* ---------- 3. Content depth (20) ---------- */

    function auditDepth(resume, checks) {
        var weight = 20, earned = 0;

        /* Summary length: 40-120 words is the useful window. */
        var sw = u.wordCount(resume.summary);
        if (sw === 0) {
            earned += push(checks, 'summary-length', 'Summary is empty', 'fail', 0, 4, '',
                'Aim for 40 to 110 words.');
        } else if (sw < 30) {
            earned += push(checks, 'summary-length', 'Summary is too short', 'warn', 2, 4,
                sw + ' words. Under 30 wastes prime keyword space.',
                'Expand to 40 to 110 words.');
        } else if (sw > 140) {
            earned += push(checks, 'summary-length', 'Summary is too long', 'warn', 2, 4,
                sw + ' words. Long summaries get skimmed past.',
                'Cut to 40 to 110 words.');
        } else {
            earned += push(checks, 'summary-length', 'Summary is a good length', 'pass', 4, 4, sw + ' words');
        }

        /* Bullets per role: 3-6 is the target. */
        var roles = resume.experience.filter(function (j) { return u.trim(j.title) || u.trim(j.company); });
        var thin = roles.filter(function (j) {
            return j.bullets.filter(function (b) { return u.trim(b); }).length < 3;
        });
        if (!roles.length) {
            earned += push(checks, 'bullets-per-role', 'No roles to evaluate', 'fail', 0, 6);
        } else if (thin.length) {
            earned += push(checks, 'bullets-per-role', thin.length + ' role' +
                (thin.length === 1 ? '' : 's') + ' with fewer than 3 bullets', 'warn',
                Math.max(2, 6 - thin.length * 2), 6,
                thin.map(function (j) { return u.trim(j.title) || u.trim(j.company); }).join(', '),
                'Give each recent role 3 to 6 bullets. Older roles can be shorter.');
        } else {
            earned += push(checks, 'bullets-per-role', 'Every role has 3+ bullets', 'pass', 6, 6);
        }

        /* Overall length. */
        var words = u.wordCount(RB.model.toPlainText(resume));
        var pages = estimatePages(resume);
        if (words < 250) {
            earned += push(checks, 'total-length', 'CV is very short', 'fail', 1, 5,
                '~' + words + ' words (about ' + pages + ' page' + (pages === 1 ? '' : 's') + ').',
                'Most shortlisted CVs run 450 to 800 words.');
        } else if (words < 400) {
            earned += push(checks, 'total-length', 'CV is on the thin side', 'warn', 3, 5,
                '~' + words + ' words.',
                'Add detail and results to your two most recent roles.');
        } else if (pages > 3) {
            earned += push(checks, 'total-length', 'CV is likely too long', 'warn', 3, 5,
                '~' + words + ' words (about ' + pages + ' pages).',
                'Trim to 2 pages, or 3 for 15+ years of experience. Cut detail from roles older than 10 years.');
        } else {
            earned += push(checks, 'total-length', 'Length is appropriate', 'pass', 5, 5,
                '~' + words + ' words (about ' + pages + ' page' + (pages === 1 ? '' : 's') + ').');
        }

        /* Bullets that run past two printed lines get skimmed. */
        var bullets = RB.model.allBullets(resume);
        var longOnes = bullets.filter(function (b) { return u.trim(b.text).length > 240; });
        if (!bullets.length) {
            earned += push(checks, 'bullet-length', 'No bullets to evaluate', 'fail', 0, 5);
        } else if (longOnes.length) {
            earned += push(checks, 'bullet-length', longOnes.length + ' over-long bullet' +
                (longOnes.length === 1 ? '' : 's'), 'warn', 3, 5,
                'Bullets past roughly 240 characters wrap to three lines and lose the reader.',
                'Split each into two bullets, or cut the setup and keep the result.');
        } else {
            earned += push(checks, 'bullet-length', 'Bullet lengths are readable', 'pass', 5, 5);
        }

        return { key: 'depth', label: 'Content depth', weight: weight, earned: Math.min(earned, weight) };
    }

    /* ---------- 4. Quantified results (15) ---------- */

    function auditMetrics(resume, checks) {
        var weight = 15;
        var bullets = RB.model.allBullets(resume);

        if (!bullets.length) {
            push(checks, 'metrics', 'No bullets to measure', 'fail', 0, 15, '',
                'Add achievement bullets to your roles.');
            return { key: 'metrics', label: 'Quantified results', weight: weight, earned: 0 };
        }

        var withMetric = bullets.filter(function (b) { return METRIC_RE.test(b.text); });
        var pct = Math.round((withMetric.length / bullets.length) * 100);
        var earned;

        if (pct >= 50) {
            earned = push(checks, 'metrics', pct + '% of bullets carry a number', 'pass', 15, 15,
                withMetric.length + ' of ' + bullets.length + ' bullets are quantified.');
        } else if (pct >= 30) {
            earned = push(checks, 'metrics', pct + '% of bullets carry a number', 'warn', 10, 15,
                withMetric.length + ' of ' + bullets.length + ' bullets are quantified.',
                'Push past 50%. Numbers to reach for: volume handled, time saved, money saved or earned, team size, error rate, satisfaction score.');
        } else if (pct >= 10) {
            earned = push(checks, 'metrics', 'Only ' + pct + '% of bullets carry a number', 'warn', 5, 15,
                withMetric.length + ' of ' + bullets.length + ' bullets are quantified.',
                'This is the highest-value fix available to you. Add a figure to at least half your bullets.');
        } else {
            earned = push(checks, 'metrics', 'Almost no quantified results', 'fail', 0, 15,
                'Only ' + withMetric.length + ' of ' + bullets.length + ' bullets contain a number.',
                'Recruiters shortlist on evidence. Even estimates help: "roughly 40 tickets a week", "a team of 6", "cut the process from 5 days to 2".');
        }

        return { key: 'metrics', label: 'Quantified results', weight: weight, earned: earned };
    }

    /* ---------- 5. Action verbs and phrasing (15) ---------- */

    function auditVerbs(resume, checks) {
        var weight = 15, earned = 0;
        var bullets = RB.model.allBullets(resume);

        if (!bullets.length) {
            push(checks, 'action-verbs', 'No bullets to evaluate', 'fail', 0, 15);
            return { key: 'verbs', label: 'Phrasing', weight: weight, earned: 0 };
        }

        /* Strong openers */
        var strong = bullets.filter(function (b) { return startsWithActionVerb(b.text); });
        var pct = Math.round((strong.length / bullets.length) * 100);
        if (pct >= 80) {
            earned += push(checks, 'action-verbs', pct + '% of bullets open with an action verb', 'pass', 7, 7);
        } else if (pct >= 55) {
            earned += push(checks, 'action-verbs', pct + '% of bullets open with an action verb', 'warn', 4, 7,
                strong.length + ' of ' + bullets.length + '.',
                'Rewrite the rest to open with a past-tense verb: Led, Built, Delivered, Reduced, Negotiated.');
        } else {
            earned += push(checks, 'action-verbs', 'Only ' + pct + '% of bullets open with an action verb', 'fail', 1, 7,
                strong.length + ' of ' + bullets.length + '.',
                'Start every bullet with a past-tense action verb. Run "Revamp with rules" to fix most of these automatically.');
        }

        /* Weak openers */
        var weak = [];
        bullets.forEach(function (b) {
            for (var i = 0; i < WEAK_OPENERS.length; i++) {
                if (WEAK_OPENERS[i].re.test(u.trim(b.text))) {
                    weak.push({ text: b.text, fix: WEAK_OPENERS[i].fix });
                    break;
                }
            }
        });
        earned += !weak.length
            ? push(checks, 'weak-openers', 'No filler openers', 'pass', 4, 4)
            : push(checks, 'weak-openers', weak.length + ' bullet' + (weak.length === 1 ? '' : 's') +
                ' start with filler', 'warn', 1, 4,
                weak.slice(0, 3).map(function (w) { return '"' + truncate(w.text, 60) + '"'; }).join('  ·  '),
                'Phrases like "Responsible for" and "Worked on" describe a job, not an achievement.');

        /* First person */
        var firstPerson = bullets.filter(function (b) { return FIRST_PERSON.test(b.text); });
        var summaryFirstPerson = FIRST_PERSON.test(resume.summary || '');
        if (!firstPerson.length && !summaryFirstPerson) {
            earned += push(checks, 'first-person', 'No first-person pronouns', 'pass', 2, 2);
        } else {
            earned += push(checks, 'first-person', 'First-person pronouns found', 'warn', 0, 2,
                (summaryFirstPerson ? 'In the summary. ' : '') +
                (firstPerson.length ? firstPerson.length + ' bullet(s).' : ''),
                'CV convention drops "I", "my" and "we". Write "Managed a team of 6", not "I managed a team of 6".');
        }

        /* Clichés */
        var text = RB.model.toPlainText(resume).toLowerCase();
        var found = CLICHES.filter(function (c) { return text.indexOf(c) !== -1; });
        earned += !found.length
            ? push(checks, 'cliches', 'No filler phrases', 'pass', 2, 2)
            : push(checks, 'cliches', found.length + ' filler phrase' + (found.length === 1 ? '' : 's'),
                'warn', 0, 2, found.slice(0, 5).join(', '),
                'These score nothing with a parser and read as padding to a recruiter. Replace each with evidence.');

        return { key: 'verbs', label: 'Phrasing', weight: weight, earned: Math.min(earned, weight) };
    }

    function startsWithActionVerb(text) {
        var first = u.trim(text).replace(/^[^A-Za-z]+/, '').split(/\s+/)[0] || '';
        return ACTION_VERB_SET.has(first.toLowerCase());
    }

    /* ---------- 6. Format hygiene (10) ---------- */

    function auditFormatting(resume, checks) {
        var weight = 10, earned = 0;
        var text = RB.model.toPlainText(resume);

        /* Glyphs and emoji */
        var hasGlyph = BAD_GLYPHS.test(text);
        var hasEmoji = false;
        try { hasEmoji = EMOJI.test(text); } catch (e) { hasEmoji = false; }

        if (!hasGlyph && !hasEmoji) {
            earned += push(checks, 'glyphs', 'No decorative characters', 'pass', 3, 3);
        } else {
            earned += push(checks, 'glyphs', 'Decorative characters found', 'warn', 0, 3,
                (hasGlyph ? 'Non-standard bullet or symbol characters. ' : '') +
                (hasEmoji ? 'Emoji present.' : ''),
                'Parsers drop these or turn them into mojibake. The app renders standard bullets for you — remove them from your text.');
        }

        /* Date completeness and consistency */
        var roles = resume.experience.filter(function (j) { return u.trim(j.title) || u.trim(j.company); });
        var missingDates = roles.filter(function (j) {
            return u.isBlank(j.startDate) || (!j.current && u.isBlank(j.endDate));
        });
        if (!roles.length) {
            earned += push(checks, 'dates', 'No roles to check dates on', 'fail', 0, 4);
        } else if (missingDates.length) {
            earned += push(checks, 'dates', missingDates.length + ' role' +
                (missingDates.length === 1 ? '' : 's') + ' missing dates', 'fail', 1, 4,
                missingDates.map(function (j) { return u.trim(j.title) || u.trim(j.company); }).join(', '),
                'Incomplete dates are a top cause of rejected applications — parsers cannot compute your years of experience and often discard the role.');
        } else {
            earned += push(checks, 'dates', 'All roles have complete dates', 'pass', 4, 4);
        }

        /* Reverse-chronological order */
        var ordered = isReverseChronological(roles);
        earned += ordered
            ? push(checks, 'chronology', 'Experience is in reverse-chronological order', 'pass', 2, 2)
            : push(checks, 'chronology', 'Experience is out of order', 'warn', 0, 2,
                'Your most recent role should be first.',
                'Use "Sort newest first" in the Experience section.');

        /* Employment gaps over a year */
        var gaps = findGaps(roles);
        earned += !gaps.length
            ? push(checks, 'gaps', 'No unexplained multi-year gaps', 'pass', 1, 1)
            : push(checks, 'gaps', gaps.length + ' gap' + (gaps.length === 1 ? '' : 's') +
                ' over 12 months', 'warn', 0, 1, gaps.join('; '),
                'Gaps are not disqualifying, but unexplained ones invite questions. Consider an entry for study, caregiving, contracting or a career break.');

        return { key: 'formatting', label: 'Format hygiene', weight: weight, earned: Math.min(earned, weight) };
    }

    function isReverseChronological(roles) {
        var keys = roles.map(function (j) {
            return Math.max(u.monthSortKey(j.endDate, j.current), u.monthSortKey(j.startDate));
        }).filter(function (k) { return k >= 0; });
        for (var i = 1; i < keys.length; i++) {
            if (keys[i] > keys[i - 1]) return false;
        }
        return true;
    }

    function findGaps(roles) {
        var spans = roles.map(function (j) {
            return {
                start: u.monthSortKey(j.startDate),
                end: j.current ? 999999 : u.monthSortKey(j.endDate),
                label: u.trim(j.title) || u.trim(j.company)
            };
        }).filter(function (s) { return s.start > 0 && s.end > 0; })
          .sort(function (a, b) { return a.start - b.start; });

        var gaps = [];
        for (var i = 1; i < spans.length; i++) {
            var prevEnd = Math.max.apply(null, spans.slice(0, i).map(function (s) { return s.end; }));
            if (prevEnd === 999999) continue;
            var months = spans[i].start - prevEnd;
            if (months > 12) {
                gaps.push(Math.round(months / 12 * 10) / 10 + ' years before ' + spans[i].label);
            }
        }
        return gaps;
    }

    /* ---------- 7. Skills breadth (10) ---------- */

    function auditSkills(resume, checks) {
        var weight = 10, earned = 0;
        var total = countSkills(resume);

        if (total === 0) {
            earned += push(checks, 'skill-count', 'No skills listed', 'fail', 0, 6, '',
                'List 10 to 20 skills using the exact words job ads use.');
        } else if (total < 8) {
            earned += push(checks, 'skill-count', 'Only ' + total + ' skills listed', 'warn', 3, 6, '',
                'Aim for 10 to 20. Include tools, methods and domain knowledge — not just software.');
        } else if (total > 40) {
            earned += push(checks, 'skill-count', total + ' skills listed', 'warn', 4, 6,
                'Very long lists dilute your strongest keywords and read as padding.',
                'Cut to your best 20 to 25, grouped by category.');
        } else {
            earned += push(checks, 'skill-count', total + ' skills listed', 'pass', 6, 6);
        }

        /* Grouped skills parse better and read faster. */
        var grouped = resume.skills.filter(function (g) {
            return u.trim(g.category) && g.items.length;
        }).length;
        earned += grouped >= 2
            ? push(checks, 'skill-groups', 'Skills are grouped by category', 'pass', 2, 2)
            : push(checks, 'skill-groups', 'Skills are not grouped', 'warn', 0, 2, '',
                'Group into 2 to 4 labelled categories, e.g. Technical, Tools, Professional.');

        /* Duplicates across groups waste space and look careless. */
        var seen = Object.create(null), dupes = [];
        resume.skills.forEach(function (g) {
            g.items.forEach(function (item) {
                var k = u.trim(item).toLowerCase();
                if (!k) return;
                if (seen[k]) { if (dupes.indexOf(k) === -1) dupes.push(k); }
                seen[k] = true;
            });
        });
        earned += !dupes.length
            ? push(checks, 'skill-dupes', 'No duplicate skills', 'pass', 2, 2)
            : push(checks, 'skill-dupes', dupes.length + ' duplicate skill' +
                (dupes.length === 1 ? '' : 's'), 'warn', 0, 2, dupes.slice(0, 6).join(', '),
                'Remove the repeats — "Revamp with rules" does this for you.');

        return { key: 'skills', label: 'Skills breadth', weight: weight, earned: Math.min(earned, weight) };
    }

    function truncate(s, n) {
        var t = u.trim(s);
        return t.length > n ? t.slice(0, n - 1) + '…' : t;
    }

    /* ============================================================
       JOB DESCRIPTION MATCH
       ============================================================ */

    /* Pull single terms and known multi-word phrases out of text. */
    function extractTerms(text) {
        var lower = ' ' + String(text || '').toLowerCase()
            .replace(/[^\w\s+#./-]/g, ' ')
            .replace(/\s+/g, ' ') + ' ';

        var terms = new Map();

        // Phrases first, so their words aren't double-counted.
        KNOWN_PHRASES.forEach(function (phrase) {
            var needle = ' ' + phrase + ' ';
            var count = 0, from = 0, at;
            while ((at = lower.indexOf(needle, from)) !== -1) { count++; from = at + 1; }
            if (count) {
                terms.set(phrase, (terms.get(phrase) || 0) + count);
                lower = lower.split(needle).join(' ');
            }
        });

        // Then single tokens.
        lower.split(' ').forEach(function (word) {
            var w = word.replace(/^[-.+#/]+|[-.+#/]+$/g, '');
            if (w.length < 3) return;
            if (STOP_WORDS.has(w)) return;
            if (/^\d+$/.test(w)) return;
            terms.set(w, (terms.get(w) || 0) + 1);
        });

        return terms;
    }

    /* A term appearing under a "requirements" heading, in a bullet,
       or alongside "must have" matters more than one in the boilerplate
       about company culture. */
    function weightTerms(jobText) {
        var terms = extractTerms(jobText);
        var lines = String(jobText || '').split(/\r?\n/);
        var requiredZone = false;
        var boosted = new Set();

        lines.forEach(function (line) {
            var l = line.toLowerCase();
            if (/(requirement|required|qualification|must have|essential|you will need|what you.ll need|minimum)/.test(l)) {
                requiredZone = true;
            } else if (/(nice to have|preferred|desirable|bonus|benefit|about (us|the company)|we offer|package|culture)/.test(l)) {
                requiredZone = false;
            }
            if (requiredZone) {
                extractTerms(line).forEach(function (_n, term) { boosted.add(term); });
            }
        });

        var out = [];
        terms.forEach(function (count, term) {
            var weight = 1 + Math.min(count - 1, 2) * 0.5;   // repetition matters, with a cap
            if (boosted.has(term)) weight += 1.5;            // stated requirement
            if (term.indexOf(' ') !== -1) weight += 0.5;     // phrases are more specific
            out.push({ term: term, count: count, weight: weight, required: boosted.has(term) });
        });

        return out.sort(function (a, b) { return b.weight - a.weight; });
    }

    function matchJob(resume, jobText) {
        if (u.isBlank(jobText)) {
            return { error: 'Paste the job description first.' };
        }

        var resumeTerms = extractTerms(RB.model.toPlainText(resume));
        var resumeSkillTerms = extractTerms(
            resume.skills.map(function (g) { return g.items.join(' '); }).join(' ')
        );

        var weighted = weightTerms(jobText);

        /* Only the meaningful head of the distribution — a job ad has
           a long tail of words nobody is screening on. */
        var considered = weighted.filter(function (t) { return t.weight >= 1.5 || t.required; });
        if (considered.length < 12) considered = weighted.slice(0, 30);

        var matched = [], missing = [];
        var gotWeight = 0, totalWeight = 0;

        considered.forEach(function (t) {
            totalWeight += t.weight;
            var hit = resumeTerms.has(t.term) || stemHit(resumeTerms, t.term);
            if (hit) {
                gotWeight += t.weight;
                matched.push({
                    term: t.term,
                    required: t.required,
                    inSkills: resumeSkillTerms.has(t.term) || stemHit(resumeSkillTerms, t.term)
                });
            } else {
                missing.push({ term: t.term, required: t.required, weight: t.weight });
            }
        });

        var score = totalWeight ? Math.round((gotWeight / totalWeight) * 100) : 0;

        /* Title alignment is scored separately because it is
           disproportionately weighted by real systems. */
        var jobTitle = guessJobTitle(jobText);
        var titleAligned = false;
        if (jobTitle && !u.isBlank(resume.contact.title)) {
            var a = extractTerms(jobTitle), b = extractTerms(resume.contact.title);
            var shared = 0;
            a.forEach(function (_n, term) { if (b.has(term)) shared++; });
            titleAligned = shared > 0;
        }

        return {
            score: score,
            band: matchBand(score),
            matched: matched.sort(function (x, y) { return (y.required ? 1 : 0) - (x.required ? 1 : 0); }),
            missing: missing.sort(function (x, y) { return y.weight - x.weight; }),
            missingRequired: missing.filter(function (m) { return m.required; }),
            consideredCount: considered.length,
            jobTitle: jobTitle,
            titleAligned: titleAligned,
            resumeTitle: u.trim(resume.contact.title)
        };
    }

    /* Cheap suffix tolerance: "manage" should hit "managed"/"managing",
       "analyst" should hit "analysts". Not a real stemmer — a real one
       is not worth the payload for this. */
    function stemHit(termMap, term) {
        if (term.indexOf(' ') !== -1) return false;
        var variants = [term + 's', term + 'es', term + 'd', term + 'ed', term + 'ing'];
        if (term.length > 4) {
            var base = term.replace(/(ing|ed|es|s)$/, '');
            if (base !== term && base.length > 2) {
                variants.push(base, base + 'e', base + 'ed', base + 'ing', base + 's');
            }
        }
        for (var i = 0; i < variants.length; i++) {
            if (termMap.has(variants[i])) return true;
        }
        return false;
    }

    function guessJobTitle(jobText) {
        var lines = String(jobText || '').split(/\r?\n/)
            .map(u.trim).filter(Boolean);

        for (var i = 0; i < Math.min(lines.length, 8); i++) {
            var l = lines[i];
            if (l.length > 70) continue;
            if (/^(job title|position|role|vacancy|title)\s*[:\-–]\s*(.+)$/i.test(l)) {
                return u.trim(RegExp.$2);
            }
        }
        // Otherwise the first short line is usually the title.
        for (var j = 0; j < Math.min(lines.length, 4); j++) {
            if (lines[j].length >= 4 && lines[j].length <= 60 && !/[.!?]$/.test(lines[j])) {
                return lines[j];
            }
        }
        return '';
    }

    function matchBand(score) {
        if (score >= 75) return { label: 'Strong match', tone: 'green',
            note: 'You clear most keyword filters for this role. Apply.' };
        if (score >= 55) return { label: 'Reasonable match', tone: 'sky',
            note: 'Worth applying. Add the missing required terms first — honestly.' };
        if (score >= 35) return { label: 'Partial match', tone: 'amber',
            note: 'You may be filtered out. Rework your summary and skills around this ad.' };
        return { label: 'Weak match', tone: 'red',
            note: 'Either this role is a stretch, or your CV is not using its language.' };
    }

    RB.ats = {
        audit: audit,
        matchJob: matchJob,
        extractTerms: extractTerms,
        startsWithActionVerb: startsWithActionVerb,
        estimatePages: estimatePages,
        ACTION_VERBS: ACTION_VERBS,
        WEAK_OPENERS: WEAK_OPENERS,
        CLICHES: CLICHES,
        METRIC_RE: METRIC_RE,
        BAD_GLYPHS: BAD_GLYPHS
    };
})(window.RB);

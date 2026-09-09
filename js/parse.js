/* ============================================================
   parse.js — read an uploaded CV and turn it into a resume object

   RB.parse.extractText(file)  -> Promise<{ text, lines, warnings, meta }>
   RB.parse.toResume(extract)  -> { resume, warnings, dropped }

   Everything happens in the browser. No file is uploaded anywhere.

   Two honest limits, surfaced to the user rather than hidden:
     - A CV laid out in two columns cannot be recovered reliably.
       Text extraction reads by vertical position, so a sidebar
       interleaves with the main column. We detect the likely case
       and say so.
     - Section detection is heuristic. It is right most of the
       time on conventional CVs and wrong on creative ones, so the
       importer always drops the user into the editor to check,
       never straight to an export.
   ============================================================ */

(function (RB) {
    'use strict';

    var u = RB.util;
    var m = RB.model;

    /* CDN builds, loaded on demand rather than on page load. */
    var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    var PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    var MAMMOTH_URL = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';

    var MAX_BYTES = 12 * 1024 * 1024; // 12 MB

    var scriptCache = {};

    function loadScript(src) {
        if (scriptCache[src]) return scriptCache[src];
        scriptCache[src] = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.onload = function () { resolve(); };
            s.onerror = function () {
                delete scriptCache[src];
                reject(new Error('Could not load a required library. Check your internet connection.'));
            };
            document.head.appendChild(s);
        });
        return scriptCache[src];
    }

    /* ============================================================
       TEXT EXTRACTION
       ============================================================ */

    function extractText(file) {
        if (!file) return Promise.reject(new Error('No file selected.'));
        if (file.size > MAX_BYTES) {
            return Promise.reject(new Error('That file is larger than 12 MB. Please use a smaller file.'));
        }

        var name = (file.name || '').toLowerCase();
        var ext = name.slice(name.lastIndexOf('.') + 1);

        if (ext === 'pdf' || file.type === 'application/pdf') return extractPdf(file);
        if (ext === 'docx') return extractDocx(file);
        if (ext === 'txt' || ext === 'md' || ext === 'text') return extractPlain(file);

        if (ext === 'doc') {
            return Promise.reject(new Error(
                'Old .doc files cannot be read in the browser. Open it in Word or Google Docs ' +
                'and save it as .docx or PDF, then upload that.'
            ));
        }
        if (ext === 'pages' || ext === 'odt' || ext === 'rtf') {
            return Promise.reject(new Error(
                'This format is not supported. Export your CV as PDF or .docx and upload that instead.'
            ));
        }
        return Promise.reject(new Error('Unsupported file type. Upload a PDF, .docx or .txt file.'));
    }

    function readAsArrayBuffer(file) {
        return new Promise(function (resolve, reject) {
            var fr = new FileReader();
            fr.onload = function () { resolve(fr.result); };
            fr.onerror = function () { reject(new Error('Could not read that file.')); };
            fr.readAsArrayBuffer(file);
        });
    }

    function extractPlain(file) {
        return new Promise(function (resolve, reject) {
            var fr = new FileReader();
            fr.onload = function () {
                var text = String(fr.result || '');
                resolve(finishExtract(text.split(/\r?\n/), [], { source: 'txt' }));
            };
            fr.onerror = function () { reject(new Error('Could not read that file.')); };
            fr.readAsText(file);
        });
    }

    function extractDocx(file) {
        return loadScript(MAMMOTH_URL)
            .then(function () { return readAsArrayBuffer(file); })
            .then(function (buffer) {
                if (!window.mammoth) throw new Error('The .docx reader failed to load.');
                return window.mammoth.extractRawText({ arrayBuffer: buffer });
            })
            .then(function (result) {
                var lines = String(result.value || '').split(/\r?\n/);
                var warnings = [];
                if (result.messages && result.messages.length) {
                    var tableNote = result.messages.some(function (msg) {
                        return /table/i.test(msg.message || '');
                    });
                    if (tableNote) {
                        warnings.push('Your .docx uses tables. Tables are a common cause of ATS ' +
                            'parsing failures — the rebuilt version removes them.');
                    }
                }
                return finishExtract(lines, warnings, { source: 'docx' });
            });
    }

    function extractPdf(file) {
        return loadScript(PDFJS_URL)
            .then(function () { return readAsArrayBuffer(file); })
            .then(function (buffer) {
                var lib = window.pdfjsLib;
                if (!lib) throw new Error('The PDF reader failed to load.');
                if (lib.GlobalWorkerOptions) {
                    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
                }
                return lib.getDocument({
                    data: buffer,
                    // Fonts and images are irrelevant here; skip the work.
                    disableFontFace: true,
                    isEvalSupported: false
                }).promise;
            })
            .then(function (pdf) {
                var pageJobs = [];
                for (var p = 1; p <= pdf.numPages; p++) {
                    pageJobs.push(readPdfPage(pdf, p));
                }
                return Promise.all(pageJobs).then(function (pages) {
                    var lines = [];
                    var columnSuspicion = 0;
                    var totalLines = 0;
                    var glyphCount = 0;

                    pages.forEach(function (page) {
                        lines = lines.concat(page.lines);
                        columnSuspicion += page.wideGapLines;
                        totalLines += page.lines.length;
                        glyphCount += page.glyphCount;
                    });

                    var warnings = [];

                    if (glyphCount === 0) {
                        warnings.push('This PDF contains no extractable text — it is a scan or an ' +
                            'image. An ATS reads nothing from it either, which means it currently ' +
                            'scores zero. Rebuilding it here will fix that, but you will need to ' +
                            'type the content in.');
                    }

                    // A fifth of lines with a big internal gap suggests columns.
                    if (totalLines > 10 && columnSuspicion / totalLines > 0.2) {
                        warnings.push('Your CV looks like it uses two columns or a sidebar. Text ' +
                            'extraction reads across the page, so some lines may be interleaved — ' +
                            'please check the imported sections carefully. (Two-column CVs scramble ' +
                            'in real ATS parsers for exactly this reason, so rebuilding as a single ' +
                            'column is a genuine improvement.)');
                    }

                    if (pdf.numPages > 4) {
                        warnings.push('That is a ' + pdf.numPages + '-page CV. Most roles expect ' +
                            'two pages, three at most for very senior candidates.');
                    }

                    return finishExtract(lines, warnings, {
                        source: 'pdf',
                        pages: pdf.numPages,
                        hasTextLayer: glyphCount > 0
                    });
                });
            });
    }

    /* Rebuild visual lines from positioned glyph runs. pdf.js gives
       items in content-stream order, which is not reading order, so
       we bucket by baseline y and then sort by x. */
    function readPdfPage(pdf, pageNumber) {
        return pdf.getPage(pageNumber).then(function (page) {
            return page.getTextContent().then(function (content) {
                var viewport = page.getViewport({ scale: 1 });
                var pageWidth = viewport.width || 612;

                var buckets = [];   // { y, items: [{x, str, width}] }
                var glyphCount = 0;

                content.items.forEach(function (item) {
                    var str = item.str;
                    if (str === undefined || str === null) return;
                    if (!String(str).trim()) return;
                    glyphCount += String(str).trim().length;

                    var x = item.transform[4];
                    var y = item.transform[5];

                    // 2.5pt tolerance keeps superscripts on their own line
                    var bucket = null;
                    for (var i = 0; i < buckets.length; i++) {
                        if (Math.abs(buckets[i].y - y) <= 2.5) { bucket = buckets[i]; break; }
                    }
                    if (!bucket) {
                        bucket = { y: y, items: [] };
                        buckets.push(bucket);
                    }
                    bucket.items.push({ x: x, str: String(str), width: item.width || 0 });
                });

                buckets.sort(function (a, b) { return b.y - a.y; });   // top to bottom

                var lines = [];
                var wideGapLines = 0;

                buckets.forEach(function (bucket) {
                    bucket.items.sort(function (a, b) { return a.x - b.x; });

                    var text = '';
                    var maxGap = 0;
                    var prevEnd = null;

                    bucket.items.forEach(function (item) {
                        if (prevEnd !== null) {
                            var gap = item.x - prevEnd;
                            if (gap > maxGap) maxGap = gap;
                            // Insert a space only where the glyph runs
                            // are actually separated.
                            if (gap > 1) text += ' ';
                        }
                        text += item.str;
                        prevEnd = item.x + item.width;
                    });

                    if (maxGap > pageWidth * 0.18) wideGapLines++;

                    var clean = text.replace(/\s+/g, ' ').trim();
                    if (clean) lines.push(clean);
                });

                return { lines: lines, wideGapLines: wideGapLines, glyphCount: glyphCount };
            });
        });
    }

    function finishExtract(rawLines, warnings, meta) {
        var lines = rawLines
            .map(function (l) {
                return String(l == null ? '' : l)
                    // Normalise the punctuation that word processors insert
                    .replace(/[‘’‛]/g, "'")
                    .replace(/[“”]/g, '"')
                    .replace(/[–—]/g, '-')
                    .replace(/ /g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
            })
            .filter(function (l) { return l.length > 0; })
            .filter(function (l) {
                // Drop page furniture: "Page 2 of 3", bare page numbers
                if (/^page\s+\d+(\s+of\s+\d+)?$/i.test(l)) return false;
                if (/^\d{1,2}$/.test(l)) return false;
                return true;
            });

        return {
            lines: lines,
            text: lines.join('\n'),
            warnings: warnings || [],
            meta: meta || {}
        };
    }

    /* ============================================================
       SECTION DETECTION
       ============================================================ */

    var SECTION_PATTERNS = [
        { key: 'summary', re: /^(professional\s+)?(summary|profile|synopsis)$|^career\s+(summary|profile|objective|overview)$|^(personal\s+)?(statement|objective)$|^about\s*(me)?$|^executive\s+summary$|^professional\s+overview$/ },
        { key: 'experience', re: /^(work|professional|employment|relevant|career|industry)?\s*(experience|history|background)$|^employment(\s+history)?$|^work\s+history$|^career\s+history$|^professional\s+background$|^experience\s*&?\s*achievements?$/ },
        { key: 'education', re: /^(education|academics?|qualifications?)$|^education(al)?\s+(background|qualifications?|history|and\s+training)$|^academic\s+(background|qualifications?|history|record)$|^tertiary\s+education$|^schooling$/ },
        { key: 'skills', re: /^(technical\s+|core\s+|key\s+|professional\s+|other\s+|additional\s+|relevant\s+)?(skills?|competenc(y|ies)|proficienc(y|ies)|expertise|strengths?)$|^areas?\s+of\s+expertise$|^skills?\s*&?\s*(competenc|abilit)|^technical\s+proficienc/ },
        { key: 'certifications', re: /^(certifications?|certificates?|licen[cs]es?|accreditations?|credentials?)$|^professional\s+(development|certifications?|memberships?|affiliations?|registrations?)$|^(courses?|training|short\s+courses?)$|^continuing\s+education$/ },
        { key: 'projects', re: /^(key\s+|personal\s+|selected\s+|notable\s+|academic\s+|side\s+)?projects?$|^portfolio$|^project\s+experience$/ },
        { key: 'awards', re: /^(awards?|honou?rs?|achievements?|accomplishments?|recognitions?)$|^awards?\s*&?\s*(honou?rs?|recognition)$|^key\s+achievements?$/ },
        { key: 'languages', re: /^languages?$|^language\s+(skills?|proficienc)/ },
        { key: 'publications', re: /^publications?$|^papers?\s*&?\s*publications?$|^research$/ },
        { key: 'volunteer', re: /^(volunteer|community)(\s+(work|experience|involvement|service))?$|^extra[\s-]?curricular(\s+activities)?$/ },
        { key: 'references', re: /^references?$|^referees?$|^references?\s+available/ },
        { key: 'interests', re: /^(interests?|hobb(y|ies))$|^(personal\s+)?interests?\s*&?\s*hobb|^activities\s*&?\s*interests?$/ },
        { key: 'personal', re: /^personal\s+(details?|information|particulars)$|^bio\s?data$|^contact\s+(details?|information)$/ }
    ];

    function headingKey(line) {
        var raw = u.trim(line);
        if (!raw || raw.length > 48) return null;

        // Headings don't end in a full stop and rarely contain one.
        if (/[.!?]$/.test(raw)) return null;

        var norm = raw
            .replace(/^[^A-Za-z]+/, '')
            .replace(/[:：\-–—_|]+$/, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();

        if (!norm || norm.length > 44) return null;
        // A heading is at most a handful of words.
        if (norm.split(' ').length > 5) return null;

        for (var i = 0; i < SECTION_PATTERNS.length; i++) {
            if (SECTION_PATTERNS[i].re.test(norm)) return SECTION_PATTERNS[i].key;
        }

        /* Compound headings: "Education & Certifications", "Awards and
           Honours", "Skills / Competencies". Very common, and missing
           one is expensive — an unrecognised heading means every line
           beneath it is swallowed by whichever section came before,
           which can silently relocate an entire CV. The first half
           wins, since that names the primary section. */
        if (/\s(?:&|and|\/)\s/.test(norm)) {
            var halves = norm.split(/\s*(?:&|and|\/)\s*/);
            for (var h = 0; h < halves.length; h++) {
                var half = u.trim(halves[h]);
                if (!half) continue;
                for (var p = 0; p < SECTION_PATTERNS.length; p++) {
                    if (SECTION_PATTERNS[p].re.test(half)) return SECTION_PATTERNS[p].key;
                }
            }
        }

        return null;
    }

    /* Slice the document into { key, lines } blocks. Anything
       before the first recognised heading is the header zone. */
    function splitSections(lines) {
        var blocks = [{ key: '__header__', lines: [] }];

        lines.forEach(function (line) {
            var key = headingKey(line);
            if (key) {
                blocks.push({ key: key, lines: [], heading: line });
            } else {
                blocks[blocks.length - 1].lines.push(line);
            }
        });

        return blocks;
    }

    /* ============================================================
       FIELD-LEVEL EXTRACTION
       ============================================================ */

    var EMAIL_FIND = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
    var LINKEDIN_FIND = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|pub)\/[A-Za-z0-9_%-]+\/?/i;
    var URL_FIND = /(?:https?:\/\/)?(?:www\.)?(?:github\.com|gitlab\.com|behance\.net|dribbble\.com|medium\.com|[A-Za-z0-9-]+\.(?:com|co\.za|io|dev|me|net|org|app|design|portfolio))(?:\/[A-Za-z0-9._~:\/?#@!$&'()*+,;=%-]*)?/i;
    var PHONE_FIND = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d[\d\s().-]{7,16}\d/;

    var BULLET_PREFIX = /^\s*(?:[•▪▫◦‣⁃·●○◆◇■□★☆✓✔✦➤➔→»]|[-–—*+]|o\s|\d{1,2}[.)])\s+/;

    var TITLE_WORDS = /\b(manager|engineer|developer|analyst|consultant|officer|director|coordinator|specialist|administrator|assistant|associate|supervisor|technician|designer|architect|accountant|auditor|clerk|intern|trainee|lead|head|chief|president|founder|partner|advisor|adviser|representative|agent|nurse|teacher|lecturer|tutor|researcher|scientist|attorney|paralegal|bookkeeper|cashier|driver|receptionist|secretary|planner|buyer|controller|strategist|editor|writer|copywriter|marketer|recruiter|trader|broker|surveyor|electrician|plumber|artisan|foreman|operator|dispatcher|picker|packer|waiter|waitress|barista|chef|cook|guard|paramedic|pharmacist|physiotherapist|radiographer|optometrist|dentist|doctor|registrar|principal|deputy|vice|senior|junior|graduate|apprentice|volunteer|steward|agronomist|geologist|actuary|underwriter|claims|payroll|logistics|procurement|warehouse|sales|support|scrum\s?master|product\s+owner|business\s+partner)\b/i;

    var COMPANY_WORDS = /\b(inc\.?|ltd\.?|limited|llc|llp|plc|pty|\(pty\)|cc\b|corp\.?|corporation|company|co\.|group|holdings|holding|distribution|trading|wholesalers?|suppliers?|manufacturing|traders?|enterprises?|solutions?|technolog(y|ies)|systems?|services?|consulting|consultancy|partners?|associates?|agency|studio|labs?|works|industries|international|global|africa|bank|insurance|university|college|school|hospital|clinic|municipality|department|ministry|foundation|trust|institute|centre|center|academy|media|logistics|retail|stores?|motors?|mining|construction|engineering|properties|capital|investments?|financial|telecoms?|communications?)\b/i;

    var DEGREE_WORDS = /\b(bachelor|bachelors?|master|masters?|mba|mcom|msc|m\.sc|ma\b|bsc|b\.sc|bcom|b\.com|beng|b\.eng|btech|b\.tech|ba\b|bed|b\.ed|llb|llm|phd|ph\.d|doctorate|doctoral|honou?rs|postgraduate|post[\s-]?graduate|diploma|higher\s+certificate|national\s+(diploma|certificate|senior\s+certificate)|advanced\s+diploma|associate\s+degree|matric|matriculation|nsc\b|grade\s*12|a[\s-]?levels?|gcse|nqf|certificate\s+in|degree\s+in)\b/i;

    var INSTITUTION_WORDS = /\b(university|universiteit|college|institute|academy|school|polytechnic|tvet|technikon|unisa|wits|uct|ukzn|tuks|nwu|cput|dut|tut|vut|cti|varsity|seminary|conservatoire)\b/i;

    /* Common location tails, weighted toward South Africa since the
       app is built for that market, plus the usual global hubs. */
    var LOCATION_WORDS = /\b(south\s+africa|johannesburg|joburg|jhb|pretoria|tshwane|cape\s+town|kaapstad|durban|ethekwini|port\s+elizabeth|gqeberha|east\s+london|bloemfontein|polokwane|nelspruit|mbombela|kimberley|rustenburg|witbank|emalahleni|vereeniging|vanderbijlpark|soweto|sandton|midrand|centurion|randburg|roodepoort|benoni|boksburg|germiston|springs|krugersdorp|kempton\s+park|edenvale|alberton|bedfordview|stellenbosch|paarl|george|knysna|mthatha|pietermaritzburg|newcastle|richards\s+bay|upington|gauteng|western\s+cape|eastern\s+cape|kwazulu[\s-]?natal|free\s+state|limpopo|mpumalanga|north\s+west|northern\s+cape|namibia|botswana|zimbabwe|zambia|mozambique|lesotho|eswatini|swaziland|kenya|nigeria|ghana|egypt|uae|dubai|abu\s+dhabi|qatar|saudi|london|manchester|birmingham|leeds|glasgow|edinburgh|dublin|united\s+kingdom|england|scotland|wales|ireland|new\s+york|san\s+francisco|los\s+angeles|chicago|boston|seattle|austin|toronto|vancouver|sydney|melbourne|brisbane|perth|auckland|wellington|amsterdam|rotterdam|utrecht|netherlands|berlin|munich|hamburg|germany|paris|france|madrid|barcelona|spain|lisbon|portugal|rome|milan|italy|dublin|stockholm|oslo|copenhagen|helsinki|zurich|geneva|switzerland|vienna|austria|brussels|belgium|warsaw|poland|prague|budapest|athens|istanbul|tel\s+aviv|singapore|hong\s+kong|tokyo|seoul|shanghai|beijing|bangalore|bengaluru|mumbai|delhi|hyderabad|chennai|pune|india|remote|hybrid)\b/i;

    /* Date ranges: "Jan 2020 - Present", "03/2019 – 12/2021", "2018-2020" */
    var MONTH_NAME = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
    var ONE_DATE = '(?:' + MONTH_NAME + '\\.?\\s*,?\\s*(?:19|20)\\d{2}|(?:0?[1-9]|1[0-2])[\\/\\-.](?:19|20)\\d{2}|(?:19|20)\\d{2}[\\/\\-.](?:0?[1-9]|1[0-2])|(?:19|20)\\d{2})';
    var NOW = '(?:present|current(?:ly)?|now|to\\s?date|ongoing|date)';
    var RANGE_RE = new RegExp('(' + ONE_DATE + ')\\s*(?:-|–|—|to|until|till|through|[|])\\s*(' + ONE_DATE + '|' + NOW + ')', 'i');
    var SINGLE_DATE_RE = new RegExp('(?:^|[\\s(|,])(' + ONE_DATE + ')(?:$|[\\s)|,.])', 'i');

    function findDateRange(line) {
        var mm = RANGE_RE.exec(line);
        if (!mm) return null;
        var endRaw = mm[2];
        var isNow = new RegExp('^' + NOW + '$', 'i').test(u.trim(endRaw));
        return {
            raw: mm[0],
            start: u.parseToMonthValue(mm[1]) || u.trim(mm[1]),
            end: isNow ? '' : (u.parseToMonthValue(endRaw) || u.trim(endRaw)),
            current: isNow
        };
    }

    /* ---------- contact ---------- */

    function extractContact(headerLines, allText) {
        var contact = {
            name: '', title: '', email: '', phone: '',
            linkedin: '', portfolio: '', location: ''
        };

        var emailMatch = EMAIL_FIND.exec(allText);
        if (emailMatch) contact.email = emailMatch[0];

        var liMatch = LINKEDIN_FIND.exec(allText);
        if (liMatch) contact.linkedin = liMatch[0].replace(/^https?:\/\//, '').replace(/\/$/, '');

        /* Portfolio URL. Strip email addresses out first: the domain
           of "name@example.com" is itself a valid-looking URL, and
           matching it turns the email's host into a bogus portfolio
           link. Search the header zone before the whole document so
           an employer's website deep in the experience section
           doesn't get picked up either. */
        var headerText = headerLines.join('\n');
        var withoutEmails = function (s) {
            return String(s).replace(new RegExp(EMAIL_FIND.source, 'gi'), ' ');
        };

        /* Walk every URL rather than testing only the first. The
           LinkedIn URL usually appears before the portfolio one, and
           checking a single match meant rejecting LinkedIn and then
           giving up instead of moving on to the next candidate. */
        contact.portfolio = firstPortfolioUrl(withoutEmails(headerText)) ||
                            firstPortfolioUrl(withoutEmails(allText));

        var phoneSource = headerText + '\n' + allText;
        var phoneMatch = PHONE_FIND.exec(phoneSource.replace(EMAIL_FIND, ' '));
        if (phoneMatch && u.isValidPhone(phoneMatch[0])) {
            contact.phone = u.trim(phoneMatch[0]);
        }

        /* Name: the first header line that reads like a person's
           name — 2 to 5 words, letters only, no contact markers. */
        for (var i = 0; i < Math.min(headerLines.length, 8); i++) {
            var line = u.trim(headerLines[i]);
            if (!line || line.length > 60) continue;
            if (looksLikeContactLine(line)) continue;
            if (/\d/.test(line)) continue;
            if (headingKey(line)) continue;

            var words = line.replace(/[,|]/g, ' ').split(/\s+/).filter(Boolean);
            if (words.length < 2 || words.length > 5) continue;
            if (!words.every(function (w) { return /^[A-Za-z][A-Za-z'’.-]*$/.test(w); })) continue;
            if (TITLE_WORDS.test(line) && !/^[A-Z\s'’.-]+$/.test(line)) continue;

            contact.name = /^[A-Z\s'’.-]+$/.test(line) ? u.forceTitleCase(line) : line;
            contact.title = guessTitleNear(headerLines, i);
            break;
        }

        /* Location. The place is usually buried inside a long
           pipe-separated contact line — "email | phone | Johannesburg,
           South Africa | linkedin" — so split every header line into
           segments and keep the ones that name a place. Note there is
           no length limit on the line itself: that contact line is
           routinely over 100 characters, and gating on length here is
           what previously made this return nothing. */
        for (var j = 0; j < headerLines.length; j++) {
            var l = u.trim(headerLines[j]);
            if (!l || l === contact.name) continue;
            if (!LOCATION_WORDS.test(l)) continue;

            var segments = l.split(/\s*[|•·]\s*|\s{2,}/)
                .reduce(function (acc, seg) {
                    // Also break "Johannesburg, South Africa" apart so
                    // each half can be tested independently.
                    return acc.concat(seg.split(/\s*,\s*/));
                }, [])
                .map(u.trim)
                .filter(Boolean);

            var best = segments.filter(function (s) {
                return LOCATION_WORDS.test(s) &&
                       !looksLikeContactLine(s) &&
                       s.length <= 40;
            });

            if (best.length) {
                contact.location = best.join(', ');
                break;
            }
            // The whole line is the location (e.g. a bare address line).
            if (!looksLikeContactLine(l) && l.length <= 60) {
                contact.location = l;
                break;
            }
        }

        return contact;
    }

    function firstPortfolioUrl(text) {
        var re = new RegExp(URL_FIND.source, 'gi');
        var match;
        while ((match = re.exec(text)) !== null) {
            var url = match[0].replace(/^https?:\/\//i, '').replace(/\/+$/, '');
            if (/linkedin\.com/i.test(url)) continue;
            if (url.indexOf('@') !== -1) continue;
            // A bare "example.com" with no path is usually the tail of
            // something else rather than a real portfolio link.
            if (url.indexOf('/') === -1 && !/^(github|gitlab|behance|dribbble|medium)\./i.test(url)) {
                continue;
            }
            return url;
        }
        return '';
    }

    function looksLikeContactLine(line) {
        if (EMAIL_FIND.test(line)) return true;
        if (LINKEDIN_FIND.test(line)) return true;
        if (/https?:\/\//i.test(line)) return true;
        if (/\b(tel|phone|mobile|cell|email|e-mail|address|nationality|id\s*number|date\s+of\s+birth|dob|gender|marital)\b/i.test(line)) return true;
        var digits = line.replace(/\D/g, '');
        if (digits.length >= 9) return true;
        return false;
    }

    /* The target title is normally the line directly under the name. */
    function guessTitleNear(headerLines, nameIndex) {
        for (var k = nameIndex + 1; k < Math.min(headerLines.length, nameIndex + 4); k++) {
            var l = u.trim(headerLines[k]);
            if (!l || l.length > 70) continue;
            if (looksLikeContactLine(l)) continue;
            if (headingKey(l)) continue;
            if (LOCATION_WORDS.test(l) && !TITLE_WORDS.test(l)) continue;
            if (l.split(/\s+/).length > 8) continue;
            return l;
        }
        return '';
    }

    /* ---------- experience ---------- */

    function extractExperience(lines) {
        if (!lines.length) return [];

        /* Anchor on lines carrying a date range: on a conventional
           CV, each role has exactly one. */
        var anchors = [];
        lines.forEach(function (line, i) {
            var range = findDateRange(line);
            if (range) anchors.push({ index: i, range: range });
        });

        if (!anchors.length) return extractExperienceWithoutDates(lines);

        /* The most common CV layout puts the job title on its own
           line ABOVE the employer/date line:

               Data Analyst
               Naledi Retail Group | Johannesburg, ZA | Mar 2023 - Present
               • bullet…

           So the line above an anchor is always a title candidate —
           not only when the anchor itself is sparse. Claim it first,
           then compute bullet ranges around what was claimed, so one
           role's title never lands in the previous role's bullets. */
        anchors.forEach(function (anchor, ai) {
            var i = anchor.index;
            var above = i > 0 ? u.trim(lines[i - 1]) : '';
            var prevAnchor = ai > 0 ? anchors[ai - 1].index : -1;

            anchor.claimsAbove = !!above &&
                i - 1 > prevAnchor &&              // not the previous anchor line itself
                !BULLET_PREFIX.test(above) &&
                !findDateRange(above) &&
                !headingKey(above) &&
                above.length < 90;
        });

        var jobs = [];

        anchors.forEach(function (anchor, ai) {
            var range = anchor.range;
            var i = anchor.index;

            var onAnchor = u.trim(lines[i]
                .replace(range.raw, ' ')
                .replace(/[|•·,\-–]\s*$/, ''));

            var candidates = [];
            if (anchor.claimsAbove) {
                splitMeta(lines[i - 1]).forEach(function (p) { candidates.push(p); });
            }
            splitMeta(onAnchor).forEach(function (p) { candidates.push(p); });

            /* Fall back to the line below only when we still have
               nothing to work with. */
            var below = i + 1 < lines.length ? u.trim(lines[i + 1]) : '';
            var usedBelow = false;
            if (candidates.length < 2 && below &&
                !BULLET_PREFIX.test(below) && !findDateRange(below) && !headingKey(below)) {
                splitMeta(below).forEach(function (p) { candidates.push(p); });
                usedBelow = true;
            }

            var picked = pickTitleAndCompany(candidates);

            /* Bullets run to the next anchor, minus that anchor's
               claimed title line. */
            var stop = ai + 1 < anchors.length
                ? anchors[ai + 1].index - (anchors[ai + 1].claimsAbove ? 1 : 0)
                : lines.length;

            var bodyStart = i + (usedBelow ? 2 : 1);
            var body = bodyStart < stop ? lines.slice(bodyStart, stop) : [];
            var bullets = linesToBullets(body);

            if (!picked.title && !picked.company && !bullets.length) return;

            jobs.push({
                id: u.uid(),
                title: picked.title,
                company: picked.company,
                location: picked.location,
                startDate: range.start,
                endDate: range.end,
                current: range.current,
                bullets: bullets.length ? bullets : ['']
            });
        });

        return jobs;
    }

    /* Split "Senior Analyst | Acme Ltd | Cape Town, ZA" into parts.

       Deliberately does NOT split on commas. A comma inside one of
       these fragments almost always belongs there — "Johannesburg,
       ZA" and "BCom Honours, Information Systems" are single values,
       and splitting them shreds both the location and the degree.
       The one case worth splitting, "Job Title, Employer Ltd", is
       handled explicitly below. */
    function splitMeta(line) {
        if (!u.trim(line)) return [];

        var parts = line.split(/\s*(?:[|•·]|\s[-–—]\s|\sat\s)\s*/)
            .map(u.trim)
            .filter(function (p) { return p && p.length > 1; });

        var out = [];
        parts.forEach(function (part) {
            var commaCount = (part.match(/,/g) || []).length;

            /* Two or more commas is a list: "Stock Clerk, Ubuntu
               Trading CC, Pinetown" is title/employer/place. A single
               comma is left alone, because one-comma fragments are
               usually a single value — "Johannesburg, South Africa",
               "BCom Honours, Information Systems". */
            if (commaCount >= 2) {
                part.split(/\s*,\s*/).forEach(function (piece) {
                    var p = u.trim(piece);
                    if (p && p.length > 1) out.push(p);
                });
                return;
            }

            // "Senior Analyst, Acme Ltd" -> two values, but only when
            // one side reads as a role and the other as an employer.
            var comma = /^(.{3,60}?),\s+(.{3,60})$/.exec(part);
            if (comma) {
                var left = u.trim(comma[1]);
                var right = u.trim(comma[2]);
                var leftIsTitle = TITLE_WORDS.test(left) && !COMPANY_WORDS.test(left);
                var rightIsCompany = COMPANY_WORDS.test(right) && !TITLE_WORDS.test(right);
                if (leftIsTitle && rightIsCompany) {
                    out.push(left, right);
                    return;
                }
            }
            out.push(part);
        });

        return out;
    }

    /* A fragment is a place if it names one and carries no role or
       employer vocabulary — "University of Cape Town" contains a
       city but is an institution, so it must not match here. */
    function looksLikeLocation(part) {
        if (!LOCATION_WORDS.test(part)) return false;
        if (TITLE_WORDS.test(part)) return false;
        if (COMPANY_WORDS.test(part)) return false;
        return u.trim(part).length <= 45;
    }

    /* Decide which fragment is the job title, which the employer,
       and which the location, by scoring vocabulary. */
    function pickTitleAndCompany(parts) {
        var result = { title: '', company: '', location: '', usedBelow: false };
        if (!parts.length) return result;

        var scored = parts.map(function (p) {
            return {
                text: p,
                titleScore: (TITLE_WORDS.test(p) ? 2 : 0) + (p.split(/\s+/).length <= 6 ? 0.5 : 0),
                companyScore: (COMPANY_WORDS.test(p) ? 2 : 0) + (/^[A-Z]/.test(p) ? 0.3 : 0),
                isLocation: looksLikeLocation(p)
            };
        });

        // Location first — it's the least ambiguous signal.
        var locIdx = -1;
        for (var li = 0; li < scored.length; li++) {
            if (scored[li].isLocation) { locIdx = li; break; }
        }
        if (locIdx !== -1) {
            result.location = scored[locIdx].text;
            scored.splice(locIdx, 1);
        }

        if (!scored.length) return result;
        if (scored.length === 1) {
            // One fragment: call it the title unless it's clearly a company.
            if (scored[0].companyScore >= 2 && scored[0].titleScore < 2) {
                result.company = scored[0].text;
            } else {
                result.title = scored[0].text;
            }
            return result;
        }

        var titleIdx = 0, best = -Infinity;
        scored.forEach(function (s, i) {
            var score = s.titleScore - s.companyScore;
            if (score > best) { best = score; titleIdx = i; }
        });
        result.title = scored[titleIdx].text;

        var rest = scored.filter(function (_s, i) { return i !== titleIdx; });
        var companyIdx = 0, cbest = -Infinity;
        rest.forEach(function (s, i) {
            var score = s.companyScore - s.titleScore;
            if (score > cbest) { cbest = score; companyIdx = i; }
        });
        result.company = rest[companyIdx].text;

        /* Whatever is left over once the title and employer are taken
           is almost always the place. This catches towns too small to
           be worth listing in LOCATION_WORDS — the alternative is an
           endlessly growing gazetteer that still misses somewhere. */
        if (!result.location) {
            var leftover = rest.filter(function (_s, i) { return i !== companyIdx; });
            for (var k = 0; k < leftover.length; k++) {
                var candidate = leftover[k];
                if (candidate.text.length <= 40 &&
                    candidate.titleScore < 2 &&
                    candidate.companyScore < 2 &&
                    candidate.text.split(/\s+/).length <= 4) {
                    result.location = candidate.text;
                    break;
                }
            }
        }

        return result;
    }

    function looksLikeEntryHeader(line) {
        return TITLE_WORDS.test(line) || COMPANY_WORDS.test(line);
    }

    /* Fall back to structure when a CV has no parseable dates at all. */
    function extractExperienceWithoutDates(lines) {
        var jobs = [];
        var current = null;

        lines.forEach(function (line) {
            if (BULLET_PREFIX.test(line)) {
                if (!current) {
                    current = { id: u.uid(), title: '', company: '', location: '',
                                startDate: '', endDate: '', current: false, bullets: [] };
                }
                current.bullets.push(stripBullet(line));
            } else if (looksLikeEntryHeader(line) && line.length < 90) {
                if (current) jobs.push(current);
                var picked = pickTitleAndCompany(splitMeta(line));
                current = {
                    id: u.uid(),
                    title: picked.title,
                    company: picked.company,
                    location: picked.location,
                    startDate: '', endDate: '', current: false,
                    bullets: []
                };
            } else if (current) {
                current.bullets.push(u.trim(line));
            }
        });

        if (current) jobs.push(current);

        return jobs.map(function (j) {
            if (!j.bullets.length) j.bullets = [''];
            return j;
        });
    }

    function stripBullet(line) {
        return u.trim(String(line).replace(BULLET_PREFIX, ''));
    }

    /* Turn a block of lines into bullets, rejoining sentences that
       PDF extraction split across visual lines. */
    function linesToBullets(bodyLines) {
        var bullets = [];
        var anyMarked = bodyLines.some(function (l) { return BULLET_PREFIX.test(l); });

        bodyLines.forEach(function (line) {
            var text = u.trim(line);
            if (!text) return;

            if (BULLET_PREFIX.test(line)) {
                bullets.push(stripBullet(line));
                return;
            }

            if (anyMarked && bullets.length) {
                // A continuation of the previous bullet: it didn't
                // start a new marker and the last one looks unfinished.
                var prev = bullets[bullets.length - 1];
                if (!/[.;:!?]$/.test(prev) || /^[a-z]/.test(text)) {
                    bullets[bullets.length - 1] = prev + ' ' + text;
                    return;
                }
            }

            if (!anyMarked) {
                // No markers anywhere: split on sentence ends instead.
                if (bullets.length && /^[a-z(]/.test(text)) {
                    bullets[bullets.length - 1] += ' ' + text;
                } else {
                    bullets.push(text);
                }
                return;
            }

            bullets.push(text);
        });

        return bullets
            .map(u.trim)
            .filter(function (b) { return b.length > 2; })
            .map(function (b) { return b.replace(/\s+/g, ' '); });
    }

    /* ---------- education ---------- */

    /* Like splitMeta, but without the " - " separator: qualification
       names routinely contain a dash — "NQF Level 5 - Systems
       Development", "BSc - Computer Science" — and splitting there
       truncated the qualification and dumped the subject into notes. */
    function splitEducationMeta(line) {
        if (!u.trim(line)) return [];

        var out = [];
        line.split(/\s*(?:[|•·]|\sat\s)\s*/).forEach(function (part) {
            var p = u.trim(part);
            if (!p || p.length < 2) return;
            if ((p.match(/,/g) || []).length >= 2) {
                p.split(/\s*,\s*/).forEach(function (piece) {
                    var q = u.trim(piece);
                    if (q && q.length > 1) out.push(q);
                });
                return;
            }
            out.push(p);
        });
        return out;
    }

    function extractEducation(lines) {
        if (!lines.length) return [];

        var entries = [];
        var current = null;

        function flush() {
            if (current && (current.degree || current.institution)) entries.push(current);
            current = null;
        }

        lines.forEach(function (line) {
            var text = u.trim(line);
            if (!text) return;

            var range = findDateRange(text);
            var single = !range ? SINGLE_DATE_RE.exec(text) : null;
            /* Keep the pipes: splitEducationMeta needs them to separate
               the institution from its city. Stripping them here made
               "University of Cape Town | Cape Town, ZA" collapse into
               one unsplittable string.

               Remove whichever date form matched — including a lone
               year, which was previously left in place and ended up
               glued to the institution ("Somewhere High School
               - 2022"). */
            var dateText = range ? range.raw : (single ? single[1] : '');
            var stripped = u.trim(text
                .replace(dateText, ' ')
                .replace(/\s+/g, ' ')
                .replace(/[\s,;|]*[-–—][\s,;|]*$/, '')
                .replace(/[\s,;|]+$/, ''));

            var isDegree = DEGREE_WORDS.test(stripped);
            var isInstitution = INSTITUTION_WORDS.test(stripped);

            if (isDegree && (!current || current.degree)) {
                flush();
                current = {
                    id: u.uid(), degree: '', institution: '', location: '',
                    startDate: '', endDate: '', details: ''
                };
            }
            if (!current) {
                current = {
                    id: u.uid(), degree: '', institution: '', location: '',
                    startDate: '', endDate: '', details: ''
                };
            }

            // A single line often holds both: "BCom, University of X"
            var parts = splitEducationMeta(stripped);
            parts.forEach(function (part) {
                // A fragment that is only a date is already captured
                // in the date fields; don't also dump it into notes.
                if (/^\(?(19|20)\d{2}\)?$/.test(u.trim(part))) return;

                if (DEGREE_WORDS.test(part) && !current.degree) {
                    current.degree = part;
                } else if (INSTITUTION_WORDS.test(part) && !current.institution) {
                    current.institution = part;
                } else if (LOCATION_WORDS.test(part) && !current.location) {
                    current.location = part;
                } else if (!current.degree && isDegree) {
                    current.degree = part;
                } else if (!current.institution && isInstitution) {
                    current.institution = part;
                } else if (part.length > 3) {
                    current.details = u.trim((current.details + ' ' + stripBullet(part)).trim());
                }
            });

            if (range) {
                current.startDate = current.startDate || range.start;
                current.endDate = range.current ? '' : (range.end || current.endDate);
            } else if (single && !current.endDate) {
                current.endDate = u.parseToMonthValue(single[1]) || u.trim(single[1]);
            }
        });

        flush();
        return entries;
    }

    /* ---------- skills ---------- */

    function extractSkills(lines) {
        var groups = [];
        var loose = [];
        var pendingLabel = '';   // a sub-heading awaiting its items

        function addTo(category, items) {
            if (!items.length) return;
            var existing = null;
            groups.forEach(function (g) {
                if (g.category.toLowerCase() === category.toLowerCase()) existing = g;
            });
            if (existing) {
                existing.items = dedupe(existing.items.concat(items));
            } else {
                groups.push({ id: u.uid(), category: category, items: dedupe(items) });
            }
        }

        /* Rejoin a comma list whose final item was split by a page
           wrap: "…, Information Organization, Time" / "Management".
           Deliberately narrow — the previous line must be a comma
           list whose last item is a lone word, and the next must be
           one or two words with no separators of its own. A looser
           rule would fuse genuinely separate skill lines together. */
        var merged = [];
        lines.forEach(function (line) {
            var text = u.trim(line);
            if (!text) return;

            var prev = merged.length ? merged[merged.length - 1] : null;
            if (prev &&
                !BULLET_PREFIX.test(line) &&
                !BULLET_PREFIX.test(prev) &&
                !/[:：]\s*$/.test(prev) &&
                prev.indexOf(',') !== -1 &&
                !/[,;|]$/.test(prev) &&
                u.wordCount(prev.slice(prev.lastIndexOf(',') + 1)) === 1 &&
                u.wordCount(text) <= 2 &&
                !/[,;|:]/.test(text)) {
                merged[merged.length - 1] = prev + ' ' + text;
                return;
            }
            merged.push(line);
        });

        merged.forEach(function (line) {
            var text = stripBullet(line);
            if (!text) return;

            // "Technical: Python, SQL, Excel" — label and items together.
            var labelled = /^([A-Za-z][A-Za-z&/\s-]{2,32}?)\s*[:：]\s*(.+)$/.exec(text);
            if (labelled && labelled[2].length > 2) {
                var items = splitSkillList(labelled[2]);
                if (items.length) {
                    pendingLabel = '';
                    addTo(u.titleCase(u.trim(labelled[1])), items);
                    return;
                }
            }

            /* A label alone on its line, with the items beneath it:

                   Data Analysis & Tools:
                   Power BI, Excel, Python

               Without this the label itself was listed as a skill —
               real CVs group this way constantly. */
            if (/[:：]\s*$/.test(text) && u.wordCount(text) <= 6) {
                pendingLabel = u.titleCase(u.trim(text.replace(/[:：]\s*$/, '')));
                return;
            }

            var parsed = splitSkillList(text);
            if (!parsed.length) return;

            if (pendingLabel) {
                addTo(pendingLabel, parsed);
                return;
            }
            parsed.forEach(function (s) { loose.push(s); });
        });

        if (loose.length) {
            addTo('Core Skills', loose);
        }

        return groups.filter(function (g) { return g.items.length; });
    }

    function splitSkillList(text) {
        /* Note the absence of "/" and " - " as separators. Real skills
           contain both: "A/B testing", "CI/CD" and "UI/UX" were being
           cut in half, and " - " split "SQL (Basic - Learning)" into
           "SQL (Basic" and "Learning)". Proficiency suffixes like
           "MS Excel - Advanced" are better handled whole, by the
           revamp engine, which strips the rating and keeps the skill. */
        return String(text)
            .split(/\s*(?:[,;|•·]|\s•\s)\s*/)
            .map(u.trim)
            .filter(function (s) {
                if (s.length < 2 || s.length > 45) return false;
                // A whole sentence is prose, not a skill.
                if (s.split(/\s+/).length > 5) return false;
                if (/[.!?]$/.test(s)) return false;
                return true;
            });
    }

    function dedupe(list) {
        var seen = Object.create(null);
        var out = [];
        list.forEach(function (item) {
            var k = u.trim(item).toLowerCase();
            if (!k || seen[k]) return;
            seen[k] = true;
            out.push(u.trim(item));
        });
        return out;
    }

    /* ---------- certifications & projects ---------- */

    function extractCertifications(lines) {
        return lines.map(function (line) {
            var text = stripBullet(line);
            if (text.length < 3) return null;

            var range = findDateRange(text);
            var single = !range ? SINGLE_DATE_RE.exec(text) : null;
            var date = range ? (range.end || range.start)
                     : (single ? (u.parseToMonthValue(single[1]) || u.trim(single[1])) : '');

            var stripped = u.trim(text.replace(range ? range.raw : (single ? single[1] : ''), ' ')
                .replace(/[(),]\s*$/, '').replace(/\s+/g, ' '));

            var parts = splitMeta(stripped);
            return {
                id: u.uid(),
                name: parts[0] || stripped,
                issuer: parts.length > 1 ? parts[1] : '',
                date: date
            };
        }).filter(function (c) { return c && c.name && c.name.length > 2; });
    }

    /* Rejoin lines that a PDF split mid-sentence, returning
       { text, bulleted } items. Without this, the tail of a wrapped
       bullet — "consolidating programme priorities, financials, and"
       — looks exactly like a short, capitalised, period-free heading
       and gets promoted to a section entry of its own. */
    function mergeWrappedLines(lines) {
        var items = [];

        lines.forEach(function (line) {
            var text = u.trim(line);
            if (!text) return;

            if (BULLET_PREFIX.test(line)) {
                items.push({ text: stripBullet(line), bulleted: true });
                return;
            }

            var prev = items[items.length - 1];
            if (prev) {
                var unfinished = !/[.!?:;]$/.test(prev.text);
                var continues = /^[a-z(]/.test(text) ||
                                /,$/.test(prev.text) ||
                                /\b(and|or|to|of|for|with|the|a|an|in|on|at|by|from)$/i.test(prev.text);
                if (unfinished && continues) {
                    prev.text = u.trim(prev.text + ' ' + text);
                    return;
                }
            }

            items.push({ text: text, bulleted: false });
        });

        return items;
    }

    /* Projects normally come in three lines:
           Township Retail Price Index
           Python, Streamlit, PostgreSQL | github.com/you/project
           Open dataset tracking basket prices across 40 retailers.
       So a line that follows a name and carries a URL or a pipe is
       the tools/link line, not prose — regardless of its length. */
    function extractProjects(lines) {
        var projects = [];
        var current = null;
        var expectMeta = false;

        function flush() {
            if (current && current.name && current.name.length > 2) projects.push(current);
            current = null;
        }

        /* Wrapped lines are rejoined first, so anything left that is
           not bulleted really is a project name rather than the tail
           of the previous sentence. */
        mergeWrappedLines(lines).forEach(function (item) {
            var text = item.text;
            if (!text) return;

            /* Bulleted lines are always content, never a name. */
            if (item.bulleted) {
                if (!current) {
                    current = { id: u.uid(), name: 'Project', tech: '', link: '', bullets: [] };
                }
                var bulletUrl = URL_FIND.exec(text);
                if (bulletUrl && !current.link) {
                    current.link = bulletUrl[0].replace(/^https?:\/\//i, '').replace(/\/+$/, '');
                }
                current.bullets.push(text);
                expectMeta = false;
                return;
            }

            var hasUrl = URL_FIND.test(text);
            var isProse = /[.!?]$/.test(text) || u.wordCount(text) > 14;

            /* "Click here" and bare links under a name are the project's
               link, not a project called "Click here". */
            if (current && expectMeta && !isProse &&
                (hasUrl || /^(click here|link|view|see|demo|repo|source)$/i.test(text) ||
                 text.indexOf('|') !== -1)) {
                var url = URL_FIND.exec(text);
                if (url) {
                    current.link = url[0].replace(/^https?:\/\//i, '').replace(/\/+$/, '');
                    text = u.trim(text.replace(url[0], ''));
                }
                if (!/^(click here|link|view|see|demo|repo|source)$/i.test(u.trim(text))) {
                    current.tech = splitMeta(text).join(', ').replace(/^[,\s|]+|[,\s|]+$/g, '');
                }
                expectMeta = false;
                return;
            }

            if (isProse && current) {
                current.bullets.push(text);
                expectMeta = false;
                return;
            }

            flush();
            current = { id: u.uid(), name: text, tech: '', link: '', bullets: [] };
            var nameUrl = URL_FIND.exec(text);
            if (nameUrl) {
                current.link = nameUrl[0].replace(/^https?:\/\//i, '').replace(/\/+$/, '');
                current.name = u.trim(text.replace(nameUrl[0], '').replace(/[|•·-]\s*$/, '')) || text;
            }
            expectMeta = true;
        });

        flush();
        return projects;
    }

    /* ============================================================
       ASSEMBLY
       ============================================================ */

    function toResume(extract) {
        var lines = extract.lines || [];
        var warnings = (extract.warnings || []).slice();
        var dropped = [];

        if (!lines.length) {
            return {
                resume: m.blankResume(),
                warnings: warnings.concat(['No text could be read from that file.']),
                dropped: dropped,
                found: {}
            };
        }

        var blocks = splitSections(lines);
        var byKey = {};
        blocks.forEach(function (b) {
            if (!byKey[b.key]) byKey[b.key] = [];
            byKey[b.key] = byKey[b.key].concat(b.lines);
        });

        var resume = m.blankResume();
        var allText = lines.join('\n');

        /* contact */
        resume.contact = extractContact(byKey.__header__ || [], allText);
        // "Personal details" sections often hold the contact block.
        if (byKey.personal && (!resume.contact.email || !resume.contact.phone)) {
            var extra = extractContact(byKey.personal, byKey.personal.join('\n'));
            ['email', 'phone', 'linkedin', 'location', 'name'].forEach(function (k) {
                if (!resume.contact[k] && extra[k]) resume.contact[k] = extra[k];
            });
        }

        /* summary */
        if (byKey.summary && byKey.summary.length) {
            resume.summary = byKey.summary
                .map(stripBullet)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();
        } else {
            // No summary heading: a long prose paragraph in the
            // header zone is almost always the profile.
            var headerProse = (byKey.__header__ || []).filter(function (l) {
                return u.wordCount(l) >= 12 && !looksLikeContactLine(l);
            });
            if (headerProse.length) {
                resume.summary = headerProse.join(' ').replace(/\s+/g, ' ').trim();
            }
        }

        /* experience */
        var expLines = (byKey.experience || []);
        if (byKey.volunteer) expLines = expLines.concat(byKey.volunteer);
        var jobs = extractExperience(expLines);
        if (jobs.length) resume.experience = jobs;

        /* education */
        var edu = extractEducation(byKey.education || []);
        if (edu.length) resume.education = edu;

        /* skills */
        var skills = extractSkills(byKey.skills || []);
        if (byKey.languages) {
            var langs = extractSkills(byKey.languages);
            var langItems = langs.reduce(function (acc, g) { return acc.concat(g.items); }, []);
            if (langItems.length) {
                skills.push({ id: u.uid(), category: 'Languages', items: dedupe(langItems) });
            }
        }
        if (skills.length) resume.skills = skills;

        /* certifications — awards fold in here */
        var certs = extractCertifications(byKey.certifications || []);
        if (byKey.awards) certs = certs.concat(extractCertifications(byKey.awards));
        if (certs.length) resume.certifications = certs;

        /* projects */
        var projects = extractProjects(byKey.projects || []);
        if (projects.length) resume.projects = projects;

        /* --- report what we deliberately left behind --- */
        if (byKey.references && byKey.references.length) {
            dropped.push('References section — recruiters ask for these separately, and ' +
                '"References available on request" wastes a line. Removed.');
        }
        if (byKey.interests && byKey.interests.length) {
            dropped.push('Interests and hobbies — carries no weight with an ATS. Removed; ' +
                'add it back from the editor if a specific role calls for it.');
        }
        if (byKey.publications && byKey.publications.length) {
            dropped.push('Publications — kept out of the rebuild to avoid mangling citations. ' +
                'Re-add the important ones under Projects.');
        }

        /* --- honest reporting on what we found --- */
        var found = {
            name: !!resume.contact.name,
            email: !!resume.contact.email,
            phone: !!resume.contact.phone,
            summary: !!resume.summary,
            roles: jobs.length,
            education: edu.length,
            skills: resume.skills.reduce(function (n, g) { return n + g.items.length; }, 0),
            certifications: certs.length,
            projects: projects.length
        };

        var recognised = Object.keys(byKey).filter(function (k) { return k !== '__header__'; });
        if (!recognised.length) {
            warnings.push('No standard section headings were found, so the split into ' +
                'Experience, Education and Skills is a best guess. This usually means the ' +
                'original CV uses non-standard headings — which is itself an ATS problem. ' +
                'Please check every section before exporting.');
        }
        if (!jobs.length) {
            warnings.push('No work experience could be identified. You will need to add your ' +
                'roles by hand in the Experience section.');
        }
        if (!resume.contact.name) {
            warnings.push('Your name could not be identified with confidence — please fill it in.');
        }
        if (jobs.length && jobs.some(function (j) { return !j.startDate; })) {
            warnings.push('Some roles are missing dates. Add them: incomplete dates are one of ' +
                'the most common reasons an application is rejected outright.');
        }

        return {
            resume: m.migrate(resume),
            warnings: warnings,
            dropped: dropped,
            found: found,
            sectionsSeen: recognised
        };
    }

    RB.parse = {
        extractText: extractText,
        toResume: toResume,
        headingKey: headingKey,
        findDateRange: findDateRange,
        stripBullet: stripBullet,
        BULLET_PREFIX: BULLET_PREFIX
    };
})(window.RB);

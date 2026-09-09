/* ============================================================
   exporters.js — PDF, DOCX, HTML, TXT and JSON output

   ── Why this file was rewritten from scratch ──────────────────
   The previous version had two silent, fatal ATS bugs:

   1. PDF export ran the preview through html2canvas. That paints
      the CV into a bitmap and wraps it in a PDF. It LOOKS right
      and contains ZERO extractable text, so every ATS scores it
      zero no matter how good the content is. Now we typeset the
      PDF with jsPDF's text API, producing a real text layer.

   2. DOCX export used html-docx-js, which writes an "altChunk"
      .docx: the body is embedded HTML that Word converts when a
      human opens it. Word is happy; python-docx and Apache POI —
      what ATS vendors actually parse with — read an empty body.
      Now we emit real WordprocessingML paragraphs.

   Both are verifiable: open the PDF and press Ctrl+F, or unzip
   the .docx and read word/document.xml.
   ── ───────────────────────────────────────────────────────────
   ============================================================ */

(function (RB) {
    'use strict';

    var u = RB.util;

    var JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    var JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

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
                reject(new Error('Could not load the export library. Check your internet connection.'));
            };
            document.head.appendChild(s);
        });
        return scriptCache[src];
    }

    /* ---------- template typography ---------- */

    var THEMES = {
        /* Centred header, near-black headings, grey rules — the
           conventional corporate CV look. `centreHeader` is read by
           the header block below. */
        professional: { font: 'helvetica', primary: [23, 37, 63], rule: [148, 163, 184], body: [17, 24, 39], meta: [51, 65, 85], centreHeader: true },
        modern:    { font: 'helvetica', primary: [12, 74, 110],  rule: [125, 211, 252], body: [17, 24, 39],  meta: [55, 65, 81] },
        classic:   { font: 'times',     primary: [0, 0, 0],      rule: [85, 85, 85],    body: [17, 17, 17],  meta: [34, 34, 34] },
        executive: { font: 'times',     primary: [20, 52, 44],   rule: [94, 234, 212],  body: [31, 41, 55],  meta: [55, 65, 81] },
        compact:   { font: 'helvetica', primary: [31, 41, 55],   rule: [156, 163, 175], body: [17, 24, 39],  meta: [55, 65, 81] }
    };

    /* Standard PDF fonts use WinAnsi encoding. Transliterate the
       Latin-Extended characters that would otherwise render — and
       extract — as the wrong glyph. Anything not listed passes
       through; dropping it would lose more than it saves. */
    var TRANSLIT = {
        '‘': "'", '’': "'", '‚': "'", '‛': "'",
        '“': '"', '”': '"', '„': '"',
        '–': '-', '—': '-', '−': '-', '‑': '-',
        '…': '...', ' ': ' ', ' ': ' ', ' ': ' ',
        '​': '', '‌': '', '‍': '', '﻿': '',
        '→': '->', '←': '<-', '✓': '', '✔': '',
        'Ā': 'A', 'ā': 'a', 'Ă': 'A', 'ă': 'a',
        'Ą': 'A', 'ą': 'a', 'Ć': 'C', 'ć': 'c',
        'Č': 'C', 'č': 'c', 'Ď': 'D', 'ď': 'd',
        'Đ': 'D', 'đ': 'd', 'Ē': 'E', 'ē': 'e',
        'Ę': 'E', 'ę': 'e', 'Ě': 'E', 'ě': 'e',
        'Ğ': 'G', 'ğ': 'g', 'Ģ': 'G', 'ģ': 'g',
        'Ī': 'I', 'ī': 'i', 'İ': 'I', 'ı': 'i',
        'Ķ': 'K', 'ķ': 'k', 'Ĺ': 'L', 'ĺ': 'l',
        'Ľ': 'L', 'ľ': 'l', 'Ł': 'L', 'ł': 'l',
        'Ń': 'N', 'ń': 'n', 'Ň': 'N', 'ň': 'n',
        'Ō': 'O', 'ō': 'o', 'Ő': 'O', 'ő': 'o',
        'Ŕ': 'R', 'ŕ': 'r', 'Ř': 'R', 'ř': 'r',
        'Ś': 'S', 'ś': 's', 'Ş': 'S', 'ş': 's',
        'Š': 'S', 'š': 's', 'Ţ': 'T', 'ţ': 't',
        'Ť': 'T', 'ť': 't', 'Ū': 'U', 'ū': 'u',
        'Ů': 'U', 'ů': 'u', 'Ű': 'U', 'ű': 'u',
        'Ų': 'U', 'ų': 'u', 'Ź': 'Z', 'ź': 'z',
        'Ż': 'Z', 'ż': 'z', 'Ž': 'Z', 'ž': 'z',
        'Ș': 'S', 'ș': 's', 'Ț': 'T', 'ț': 't'
    };

    function pdfSafe(text) {
        var s = String(text == null ? '' : text);
        var out = '';
        for (var i = 0; i < s.length; i++) {
            var ch = s.charAt(i);
            out += (TRANSLIT[ch] !== undefined) ? TRANSLIT[ch] : ch;
        }
        // Strip the decorative glyphs the ATS engine already flags.
        return out.replace(/[▪▫◦‣⁃●○◆◇■□★☆✦➤➔»]/g, '').replace(/\s{2,}/g, ' ');
    }

    /* ============================================================
       PDF — typeset, not screenshotted
       ============================================================ */

    var MM_PER_PT = 25.4 / 72;

    /* Building is separated from saving so the output can be
       inspected (and tested) without triggering a download. */
    function buildPdf(resume, template) {
        return loadScript(JSPDF_URL).then(function () {
            var ctor = window.jspdf && window.jspdf.jsPDF;
            if (!ctor) throw new Error('The PDF library failed to load.');

            var theme = THEMES[template] || THEMES.modern;
            var doc = new ctor({
                unit: 'mm', format: 'a4', orientation: 'portrait', compress: true
            });

            var name = u.trim(resume.contact.name) || 'Resume';

            /* PDF metadata. Some systems index these fields, and a
               titled document looks deliberate to a human too. */
            doc.setProperties({
                title: name + ' - CV',
                author: name,
                subject: u.trim(resume.contact.title) || 'Curriculum Vitae',
                keywords: resume.skills.reduce(function (acc, g) {
                    return acc.concat(g.items);
                }, []).slice(0, 40).join(', '),
                creator: "Nene's CV Platform"
            });

            var L = {
                left: 16,
                right: 16,
                top: 15,
                bottom: 16,
                pageW: 210,
                pageH: 297
            };
            L.width = L.pageW - L.left - L.right;

            var compact = template === 'compact';
            var S = {
                name: compact ? 17 : 19,
                title: compact ? 10.5 : 11.5,
                contact: compact ? 8.5 : 9,
                section: compact ? 10 : 11,
                entryTitle: compact ? 10 : 10.5,
                meta: compact ? 8.5 : 9,
                body: compact ? 9.5 : 10,
                leading: compact ? 1.12 : 1.2
            };

            var y = L.top;

            function lineH(sizePt, factor) {
                return sizePt * MM_PER_PT * (factor || S.leading);
            }

            function ensureSpace(h) {
                if (y + h > L.pageH - L.bottom) {
                    doc.addPage();
                    y = L.top;
                    return true;
                }
                return false;
            }

            function setFont(sizePt, style, color) {
                doc.setFont(theme.font, style || 'normal');
                doc.setFontSize(sizePt);
                var c = color || theme.body;
                doc.setTextColor(c[0], c[1], c[2]);
            }

            /* Write wrapped text, breaking pages line by line so a
               paragraph can straddle a page boundary cleanly. */
            function writeWrapped(text, opts) {
                var o = opts || {};
                var size = o.size || S.body;
                var indent = o.indent || 0;
                var width = L.width - indent - (o.rightPad || 0);
                var safe = pdfSafe(text);
                if (!u.trim(safe)) return;

                setFont(size, o.style, o.color);
                var lines = doc.splitTextToSize(safe, width);
                var lh = lineH(size, o.leading);

                lines.forEach(function (line) {
                    ensureSpace(lh);
                    setFont(size, o.style, o.color);
                    if (o.align === 'center') {
                        doc.text(line, L.left + L.width / 2, y + lh * 0.78, { align: 'center' });
                    } else {
                        doc.text(line, L.left + indent, y + lh * 0.78);
                    }
                    y += lh;
                });

                if (o.spaceAfter) y += o.spaceAfter;
            }

            function writeBullet(text) {
                var safe = pdfSafe(text);
                if (!u.trim(safe)) return;

                var indent = 4.2;
                var lh = lineH(S.body);
                setFont(S.body, 'normal', theme.meta);
                var lines = doc.splitTextToSize(safe, L.width - indent);

                lines.forEach(function (line, i) {
                    ensureSpace(lh);
                    setFont(S.body, 'normal', theme.meta);
                    if (i === 0) {
                        // U+2022 is present in WinAnsi, so this is a
                        // real bullet character, not an image.
                        doc.text('•', L.left + 1, y + lh * 0.78);
                    }
                    doc.text(line, L.left + indent, y + lh * 0.78);
                    y += lh;
                });
                y += 0.4;
            }

            function rule(color, weight) {
                var c = color || theme.rule;
                doc.setDrawColor(c[0], c[1], c[2]);
                doc.setLineWidth(weight || 0.35);
                doc.line(L.left, y, L.left + L.width, y);
            }

            /* A heading must never be the last thing on a page. */
            function sectionTitle(text) {
                var lh = lineH(S.section, 1.15);
                ensureSpace(lh + 10);
                y += compact ? 2.2 : 3;

                setFont(S.section, 'bold', theme.primary);
                doc.text(pdfSafe(String(text).toUpperCase()), L.left, y + lh * 0.78,
                    { charSpace: 0.25 });
                y += lh * 0.95;

                rule(theme.rule, 0.4);
                y += compact ? 1.6 : 2.1;
            }

            /* ---- header ---- */

            var centre = theme.centreHeader ? 'center' : undefined;

            var nameLh = lineH(S.name, 1.1);
            setFont(S.name, 'bold', theme.primary);
            var nameText = pdfSafe(theme.centreHeader ? name.toUpperCase() : name);
            if (centre) {
                doc.text(nameText, L.left + L.width / 2, y + nameLh * 0.8, { align: 'center' });
            } else {
                doc.text(nameText, L.left, y + nameLh * 0.8);
            }
            y += nameLh;

            if (u.trim(resume.contact.title)) {
                writeWrapped(resume.contact.title, {
                    size: S.title, style: 'bold', color: theme.meta, leading: 1.15, align: centre
                });
            }

            var bits = [];
            ['email', 'phone', 'location', 'linkedin', 'portfolio'].forEach(function (k) {
                if (u.trim(resume.contact[k])) bits.push(u.trim(resume.contact[k]));
            });
            if (bits.length) {
                y += 0.6;
                writeWrapped(bits.join('  |  '), {
                    size: S.contact, color: theme.meta, leading: 1.2, align: centre
                });
            }

            y += 1.4;
            rule(theme.rule, 0.5);
            y += 1.2;

            /* ---- summary ---- */

            if (u.trim(resume.summary)) {
                sectionTitle(RB.render.HEADINGS.summary);
                writeWrapped(resume.summary, { size: S.body, color: theme.meta });
            }

            /* ---- experience ---- */

            var jobs = resume.experience.filter(function (j) {
                return u.trim(j.title) || u.trim(j.company) ||
                       j.bullets.some(function (b) { return u.trim(b); });
            });

            if (jobs.length) {
                sectionTitle(RB.render.HEADINGS.experience);
                jobs.forEach(function (job, i) {
                    if (i) y += compact ? 1.4 : 2;

                    // Keep the title with at least one line of its body.
                    ensureSpace(lineH(S.entryTitle) + lineH(S.meta) + lineH(S.body));

                    if (u.trim(job.title)) {
                        writeWrapped(job.title, {
                            size: S.entryTitle, style: 'bold', color: theme.body, leading: 1.14
                        });
                    }

                    var meta = [];
                    if (u.trim(job.company))  meta.push(u.trim(job.company));
                    if (u.trim(job.location)) meta.push(u.trim(job.location));
                    var range = u.formatRange(job.startDate, job.endDate, job.current);
                    if (range) meta.push(range);
                    if (meta.length) {
                        writeWrapped(meta.join('  |  '), {
                            size: S.meta, style: 'italic', color: theme.meta, leading: 1.18
                        });
                    }

                    y += 0.5;
                    job.bullets.forEach(function (b) { writeBullet(b); });
                });
            }

            /* ---- education ---- */

            var edus = resume.education.filter(function (e) {
                return u.trim(e.degree) || u.trim(e.institution);
            });

            if (edus.length) {
                sectionTitle(RB.render.HEADINGS.education);
                edus.forEach(function (edu, i) {
                    if (i) y += compact ? 1.2 : 1.8;
                    ensureSpace(lineH(S.entryTitle) + lineH(S.meta));

                    if (u.trim(edu.degree)) {
                        writeWrapped(edu.degree, {
                            size: S.entryTitle, style: 'bold', color: theme.body, leading: 1.14
                        });
                    }

                    var meta = [];
                    if (u.trim(edu.institution)) meta.push(u.trim(edu.institution));
                    if (u.trim(edu.location))    meta.push(u.trim(edu.location));
                    var range = u.formatRange(edu.startDate, edu.endDate, false);
                    if (range) meta.push(range);
                    if (meta.length) {
                        writeWrapped(meta.join('  |  '), {
                            size: S.meta, style: 'italic', color: theme.meta, leading: 1.18
                        });
                    }
                    if (u.trim(edu.details)) {
                        writeWrapped(edu.details, { size: S.body, color: theme.meta });
                    }
                });
            }

            /* ---- skills ---- */

            var groups = resume.skills.filter(function (g) { return g.items.length; });
            if (groups.length) {
                sectionTitle(RB.render.HEADINGS.skills);
                groups.forEach(function (g) {
                    var items = g.items.map(u.trim).filter(Boolean).join(', ');
                    if (!items) return;
                    var label = u.trim(g.category);
                    var lh = lineH(S.body);

                    if (label) {
                        /* Bold label, then the list flowing after it on
                           the same line — one paragraph, so extraction
                           yields "Technical: SQL, Python, ...". */
                        setFont(S.body, 'bold', theme.body);
                        var labelText = pdfSafe(label + ': ');
                        var labelWidth = doc.getTextWidth(labelText);

                        setFont(S.body, 'normal', theme.meta);
                        var firstLine = doc.splitTextToSize(pdfSafe(items), L.width - labelWidth)[0] || '';
                        var rest = pdfSafe(items).slice(firstLine.length).trim();

                        ensureSpace(lh);
                        setFont(S.body, 'bold', theme.body);
                        doc.text(labelText, L.left, y + lh * 0.78);
                        setFont(S.body, 'normal', theme.meta);
                        doc.text(firstLine, L.left + labelWidth, y + lh * 0.78);
                        y += lh;

                        if (rest) {
                            writeWrapped(rest, { size: S.body, color: theme.meta });
                        }
                    } else {
                        writeWrapped(items, { size: S.body, color: theme.meta });
                    }
                    y += 0.5;
                });
            }

            /* ---- certifications ---- */

            var certs = resume.certifications.filter(function (c) { return u.trim(c.name); });
            if (certs.length) {
                sectionTitle(RB.render.HEADINGS.certifications);
                certs.forEach(function (cert) {
                    var parts = [u.trim(cert.name)];
                    if (u.trim(cert.issuer)) parts.push(u.trim(cert.issuer));
                    var d = u.formatMonth(cert.date);
                    if (d) parts.push(d);
                    writeBullet(parts.join('  |  '));
                });
            }

            /* ---- projects ---- */

            var projects = resume.projects.filter(function (p) { return u.trim(p.name); });
            if (projects.length) {
                sectionTitle(RB.render.HEADINGS.projects);
                projects.forEach(function (p, i) {
                    if (i) y += compact ? 1.2 : 1.8;
                    ensureSpace(lineH(S.entryTitle) + lineH(S.body));

                    writeWrapped(p.name, {
                        size: S.entryTitle, style: 'bold', color: theme.body, leading: 1.14
                    });

                    var meta = [];
                    if (u.trim(p.tech)) meta.push(u.trim(p.tech));
                    if (u.trim(p.link)) meta.push(u.trim(p.link));
                    if (meta.length) {
                        writeWrapped(meta.join('  |  '), {
                            size: S.meta, style: 'italic', color: theme.meta, leading: 1.18
                        });
                    }
                    y += 0.5;
                    p.bullets.forEach(function (b) { writeBullet(b); });
                });
            }

            return doc;
        });
    }

    function exportPdf(resume, template, filenameBase) {
        return buildPdf(resume, template).then(function (doc) {
            var name = u.trim(resume.contact.name) || 'Resume';
            doc.save(u.safeFilename(filenameBase || name, 'resume') + '_CV.pdf');
            return { pages: doc.getNumberOfPages() };
        });
    }

    /* ============================================================
       DOCX — real WordprocessingML
       ============================================================ */

    function xmlEsc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;')
            // Strip control characters that make the XML invalid.
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    }

    var DOCX_FONTS = {
        professional: 'Calibri',
        modern:       'Calibri',
        classic:      'Times New Roman',
        executive:    'Georgia',
        compact:      'Arial'
    };

    var DOCX_COLORS = {
        professional: '17253F',
        modern:       '0C4A6E',
        classic:      '000000',
        executive:    '14342C',
        compact:      '1F2937'
    };

    function buildDocx(resume, template) {
        return loadScript(JSZIP_URL).then(function () {
            if (!window.JSZip) throw new Error('The DOCX library failed to load.');

            var font = DOCX_FONTS[template] || DOCX_FONTS.modern;
            var accent = DOCX_COLORS[template] || DOCX_COLORS.modern;
            var name = u.trim(resume.contact.name) || 'Resume';

            var body = [];

            /* Word sizes are in half-points; spacing in twentieths
               of a point. */
            function para(runs, opts) {
                var o = opts || {};
                var pPr = '<w:pPr>';
                pPr += '<w:spacing w:before="' + (o.before || 0) + '" w:after="' +
                       (o.after === undefined ? 40 : o.after) + '" w:line="' +
                       (o.line || 252) + '" w:lineRule="auto"/>';
                if (o.hanging) {
                    pPr += '<w:ind w:left="' + o.hanging + '" w:hanging="' + o.hanging + '"/>';
                }
                if (o.borderBottom) {
                    pPr += '<w:pBdr><w:bottom w:val="single" w:sz="' + (o.borderSize || 6) +
                           '" w:space="2" w:color="' + (o.borderColor || accent) + '"/></w:pBdr>';
                }
                if (o.align) pPr += '<w:jc w:val="' + o.align + '"/>';
                if (o.keepNext) pPr += '<w:keepNext/>';
                if (o.outline !== undefined) {
                    pPr += '<w:outlineLvl w:val="' + o.outline + '"/>';
                }
                pPr += '</w:pPr>';
                body.push('<w:p>' + pPr + runs + '</w:p>');
            }

            function run(text, opts) {
                var o = opts || {};
                var rPr = '<w:rPr>';
                rPr += '<w:rFonts w:ascii="' + xmlEsc(font) + '" w:hAnsi="' + xmlEsc(font) +
                       '" w:cs="' + xmlEsc(font) + '"/>';
                if (o.bold) rPr += '<w:b/>';
                if (o.italic) rPr += '<w:i/>';
                if (o.caps) rPr += '<w:caps/>';
                if (o.color) rPr += '<w:color w:val="' + o.color + '"/>';
                if (o.size) rPr += '<w:sz w:val="' + o.size + '"/><w:szCs w:val="' + o.size + '"/>';
                if (o.spacing) rPr += '<w:spacing w:val="' + o.spacing + '"/>';
                rPr += '</w:rPr>';
                return '<w:r>' + rPr +
                    '<w:t xml:space="preserve">' + xmlEsc(text) + '</w:t></w:r>';
            }

            function heading(text) {
                para(run(text.toUpperCase(), {
                    bold: true, size: 23, color: accent, spacing: 12
                }), { before: 220, after: 70, borderBottom: true, keepNext: true, outline: 1 });
            }

            /* ---- header ---- */
            var centred = template === 'professional';
            var headerAlign = centred ? 'center' : undefined;

            para(run(centred ? name.toUpperCase() : name,
                { bold: true, size: 38, color: accent }),
                { after: 20, align: headerAlign });

            if (u.trim(resume.contact.title)) {
                para(run(u.trim(resume.contact.title), { bold: true, size: 23 }),
                    { after: 40, align: headerAlign });
            }

            var bits = [];
            ['email', 'phone', 'location', 'linkedin', 'portfolio'].forEach(function (k) {
                if (u.trim(resume.contact[k])) bits.push(u.trim(resume.contact[k]));
            });
            if (bits.length) {
                para(run(bits.join('  |  '), { size: 18 }),
                    { after: 60, align: headerAlign,
                      borderBottom: true, borderSize: 8, borderColor: '999999' });
            }

            /* ---- summary ---- */
            if (u.trim(resume.summary)) {
                heading(RB.render.HEADINGS.summary);
                para(run(u.trim(resume.summary), { size: 20 }), { after: 60 });
            }

            /* ---- experience ---- */
            var jobs = resume.experience.filter(function (j) {
                return u.trim(j.title) || u.trim(j.company) ||
                       j.bullets.some(function (b) { return u.trim(b); });
            });
            if (jobs.length) {
                heading(RB.render.HEADINGS.experience);
                jobs.forEach(function (job) {
                    if (u.trim(job.title)) {
                        para(run(u.trim(job.title), { bold: true, size: 21 }),
                            { before: 90, after: 0, keepNext: true, outline: 2 });
                    }
                    var meta = [];
                    if (u.trim(job.company))  meta.push(u.trim(job.company));
                    if (u.trim(job.location)) meta.push(u.trim(job.location));
                    var range = u.formatRange(job.startDate, job.endDate, job.current);
                    if (range) meta.push(range);
                    if (meta.length) {
                        para(run(meta.join('  |  '), { italic: true, size: 18 }),
                            { after: 40, keepNext: true });
                    }
                    job.bullets.filter(function (b) { return u.trim(b); }).forEach(function (b) {
                        /* Literal bullet with a hanging indent. Word
                           renders it as a list; every text extractor
                           reads "• text" and strips the marker. */
                        para(run('•  ' + u.trim(b), { size: 20 }),
                            { after: 30, hanging: 227 });
                    });
                });
            }

            /* ---- education ---- */
            var edus = resume.education.filter(function (e) {
                return u.trim(e.degree) || u.trim(e.institution);
            });
            if (edus.length) {
                heading(RB.render.HEADINGS.education);
                edus.forEach(function (edu) {
                    if (u.trim(edu.degree)) {
                        para(run(u.trim(edu.degree), { bold: true, size: 21 }),
                            { before: 80, after: 0, keepNext: true, outline: 2 });
                    }
                    var meta = [];
                    if (u.trim(edu.institution)) meta.push(u.trim(edu.institution));
                    if (u.trim(edu.location))    meta.push(u.trim(edu.location));
                    var range = u.formatRange(edu.startDate, edu.endDate, false);
                    if (range) meta.push(range);
                    if (meta.length) {
                        para(run(meta.join('  |  '), { italic: true, size: 18 }), { after: 30 });
                    }
                    if (u.trim(edu.details)) {
                        para(run(u.trim(edu.details), { size: 20 }), { after: 40 });
                    }
                });
            }

            /* ---- skills ---- */
            var groups = resume.skills.filter(function (g) { return g.items.length; });
            if (groups.length) {
                heading(RB.render.HEADINGS.skills);
                groups.forEach(function (g) {
                    var items = g.items.map(u.trim).filter(Boolean).join(', ');
                    if (!items) return;
                    var label = u.trim(g.category);
                    var runs = label
                        ? run(label + ': ', { bold: true, size: 20 }) + run(items, { size: 20 })
                        : run(items, { size: 20 });
                    para(runs, { after: 40 });
                });
            }

            /* ---- certifications ---- */
            var certs = resume.certifications.filter(function (c) { return u.trim(c.name); });
            if (certs.length) {
                heading(RB.render.HEADINGS.certifications);
                certs.forEach(function (cert) {
                    var parts = [u.trim(cert.name)];
                    if (u.trim(cert.issuer)) parts.push(u.trim(cert.issuer));
                    var d = u.formatMonth(cert.date);
                    if (d) parts.push(d);
                    para(run('•  ' + parts.join('  |  '), { size: 20 }),
                        { after: 30, hanging: 227 });
                });
            }

            /* ---- projects ---- */
            var projects = resume.projects.filter(function (p) { return u.trim(p.name); });
            if (projects.length) {
                heading(RB.render.HEADINGS.projects);
                projects.forEach(function (p) {
                    para(run(u.trim(p.name), { bold: true, size: 21 }),
                        { before: 80, after: 0, keepNext: true, outline: 2 });
                    var meta = [];
                    if (u.trim(p.tech)) meta.push(u.trim(p.tech));
                    if (u.trim(p.link)) meta.push(u.trim(p.link));
                    if (meta.length) {
                        para(run(meta.join('  |  '), { italic: true, size: 18 }), { after: 30 });
                    }
                    p.bullets.filter(function (b) { return u.trim(b); }).forEach(function (b) {
                        para(run('•  ' + u.trim(b), { size: 20 }),
                            { after: 30, hanging: 227 });
                    });
                });
            }

            /* ---- assemble the package ---- */

            var documentXml =
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
                '<w:body>' + body.join('') +
                '<w:sectPr>' +
                    '<w:pgSz w:w="11906" w:h="16838"/>' +
                    // 1134 twentieths of a point = 20mm
                    '<w:pgMar w:top="964" w:right="1021" w:bottom="964" w:left="1021" ' +
                             'w:header="0" w:footer="0" w:gutter="0"/>' +
                    '<w:cols w:space="708"/>' +
                '</w:sectPr>' +
                '</w:body></w:document>';

            var stylesXml =
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
                '<w:docDefaults><w:rPrDefault><w:rPr>' +
                '<w:rFonts w:ascii="' + xmlEsc(font) + '" w:hAnsi="' + xmlEsc(font) +
                '" w:cs="' + xmlEsc(font) + '"/>' +
                '<w:sz w:val="20"/><w:szCs w:val="20"/>' +
                '</w:rPr></w:rPrDefault>' +
                '<w:pPrDefault><w:pPr>' +
                '<w:spacing w:after="40" w:line="252" w:lineRule="auto"/>' +
                '</w:pPr></w:pPrDefault></w:docDefaults>' +
                '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
                '<w:name w:val="Normal"/><w:qFormat/></w:style>' +
                '</w:styles>';

            var contentTypes =
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
                '<Default Extension="xml" ContentType="application/xml"/>' +
                '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
                '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
                '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
                '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
                '</Types>';

            var rootRels =
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
                '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
                '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
                '</Relationships>';

            var docRels =
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
                '</Relationships>';

            var nowIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
            var coreXml =
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<cp:coreProperties ' +
                'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
                'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
                'xmlns:dcterms="http://purl.org/dc/terms/" ' +
                'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
                '<dc:title>' + xmlEsc(name + ' - CV') + '</dc:title>' +
                '<dc:creator>' + xmlEsc(name) + '</dc:creator>' +
                '<cp:lastModifiedBy>' + xmlEsc(name) + '</cp:lastModifiedBy>' +
                '<dcterms:created xsi:type="dcterms:W3CDTF">' + nowIso + '</dcterms:created>' +
                '<dcterms:modified xsi:type="dcterms:W3CDTF">' + nowIso + '</dcterms:modified>' +
                '</cp:coreProperties>';

            var appXml =
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
                'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
                "<Application>Nene's CV Platform</Application>" +
                '</Properties>';

            var zip = new window.JSZip();
            zip.file('[Content_Types].xml', contentTypes);
            zip.folder('_rels').file('.rels', rootRels);
            var word = zip.folder('word');
            word.file('document.xml', documentXml);
            word.file('styles.xml', stylesXml);
            word.folder('_rels').file('document.xml.rels', docRels);
            var props = zip.folder('docProps');
            props.file('core.xml', coreXml);
            props.file('app.xml', appXml);

            return zip.generateAsync({
                type: 'blob',
                mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                compression: 'DEFLATE'
            });
        });
    }

    function exportDocx(resume, template, filenameBase) {
        return buildDocx(resume, template).then(function (blob) {
            var name = u.trim(resume.contact.name) || 'Resume';
            u.downloadBlob(blob, u.safeFilename(filenameBase || name, 'resume') + '_CV.docx');
            return { bytes: blob.size };
        });
    }

    /* ============================================================
       HTML — self-contained, no fetch
       ============================================================ */

    /* The previous version fetched style.css at export time, which
       fails on file:// and produced an unstyled file. The styles
       the document actually needs are inlined here instead. */
    var DOC_CSS = [
        'body{margin:0;background:#fff;color:#1f2937;font-family:Arial,Helvetica,sans-serif;',
        '-webkit-print-color-adjust:exact;print-color-adjust:exact}',
        '.resume-doc{--primary-color:#111827;--accent-color:#111827;--text-color:#1f2937;',
        '--secondary-text-color:#374151;--rule-color:#9ca3af;--heading-size:11.5pt;',
        '--heading-transform:uppercase;--heading-spacing:.08em;--body-size:10.5pt;--name-size:20pt;',
        'max-width:8.27in;margin:0 auto;padding:.6in .65in;background:#fff;color:var(--text-color);',
        'font-size:var(--body-size);line-height:1.42;columns:1}',
        '.r-head{margin-bottom:.85rem;padding-bottom:.6rem;border-bottom:1.5px solid var(--rule-color)}',
        '.r-name{margin:0 0 .1rem;font-size:var(--name-size);font-weight:700;color:var(--primary-color);line-height:1.15}',
        '.r-title{margin:0 0 .35rem;font-size:calc(var(--body-size) + 1.5pt);font-weight:600;color:var(--secondary-text-color)}',
        '.r-contact{margin:0;font-size:calc(var(--body-size) - .5pt);color:var(--secondary-text-color)}',
        '.r-contact span:not(:last-child)::after{content:"  |  ";color:var(--rule-color)}',
        '.r-section{margin-bottom:.8rem}.r-section:last-child{margin-bottom:0}',
        '.section-title{margin:0 0 .45rem;padding-bottom:.15rem;font-size:var(--heading-size);',
        'font-weight:700;text-transform:var(--heading-transform);letter-spacing:var(--heading-spacing);',
        'color:var(--primary-color);border-bottom:1px solid var(--rule-color)}',
        '.r-entry{margin-bottom:.6rem;break-inside:avoid;page-break-inside:avoid}',
        '.r-entry:last-child{margin-bottom:0}',
        '.r-entry-title{margin:0;font-size:calc(var(--body-size) + .5pt);font-weight:700;color:var(--text-color)}',
        '.r-entry-meta{margin:0 0 .25rem;font-size:calc(var(--body-size) - .5pt);color:var(--secondary-text-color);font-weight:500}',
        '.r-entry-meta span:not(:last-child)::after{content:"  |  ";font-weight:400;color:var(--rule-color)}',
        '.resume-ul{margin:.15rem 0 0;padding-left:1.05rem;list-style-type:disc}',
        '.resume-ul li{margin-bottom:.16rem;color:var(--secondary-text-color)}',
        '.resume-ul li::marker{color:var(--accent-color)}',
        '.r-summary,.r-skill-line,.r-inline-note{margin:0 0 .18rem;color:var(--secondary-text-color)}',
        '.r-skill-line strong{color:var(--text-color);font-weight:700}',
        '.resume-doc.professional{--primary-color:#17253f;--accent-color:#334155;--text-color:#111827;',
        '--secondary-text-color:#333f55;--rule-color:#94a3b8;--heading-spacing:.06em;',
        "font-family:Inter,Calibri,Carlito,Arial,Helvetica,sans-serif}",
        '.resume-doc.professional .r-head{text-align:center;border-bottom-width:1px}',
        '.resume-doc.professional .r-name{text-transform:uppercase;letter-spacing:.04em;font-size:19pt}',
        '.resume-doc.professional .r-contact{max-width:46em;margin:0 auto}',
        '.resume-doc.modern{--primary-color:#0c4a6e;--accent-color:#0369a1;--text-color:#111827;',
        '--secondary-text-color:#374151;--rule-color:#7dd3fc;font-family:Inter,Arial,Helvetica,sans-serif}',
        '.resume-doc.classic{--primary-color:#000;--accent-color:#000;--text-color:#111;',
        '--secondary-text-color:#222;--rule-color:#555;--name-size:21pt;--heading-size:12pt;',
        'font-family:"Times New Roman",Times,Georgia,serif}',
        '.resume-doc.executive{--primary-color:#14342c;--accent-color:#0f766e;--text-color:#1f2937;',
        '--secondary-text-color:#374151;--rule-color:#5eead4;--name-size:21pt;',
        'font-family:Georgia,"Times New Roman",serif}',
        '.resume-doc.executive .r-name,.resume-doc.executive .section-title,',
        '.resume-doc.executive .r-entry-title{font-family:Inter,Arial,Helvetica,sans-serif}',
        '.resume-doc.compact{--primary-color:#1f2937;--accent-color:#4b5563;--text-color:#111827;',
        '--secondary-text-color:#374151;--rule-color:#9ca3af;--body-size:10pt;--name-size:18pt;',
        '--heading-size:10.5pt;font-family:Arial,Helvetica,sans-serif;line-height:1.32;padding:.5in .55in}',
        '@page{size:A4;margin:14mm 15mm}',
        '@media print{.resume-doc{max-width:none;padding:0;margin:0}}'
    ].join('');

    function exportHtml(resume, template, filenameBase) {
        var name = u.trim(resume.contact.name) || 'Resume';
        var title = u.trim(resume.contact.title);

        var html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
            '<meta charset="UTF-8">\n' +
            '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
            '<title>' + u.esc(name) + ' - CV</title>\n' +
            '<meta name="author" content="' + u.esc(name) + '">\n' +
            (title ? '<meta name="description" content="' + u.esc(title) + '">\n' : '') +
            '<style>' + DOC_CSS + '</style>\n' +
            '</head>\n<body>\n' +
            RB.render.documentHtml(resume, template) +
            '\n</body>\n</html>\n';

        u.downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }),
            u.safeFilename(filenameBase || name, 'resume') + '_CV.html');

        return Promise.resolve({ bytes: html.length });
    }

    /* ============================================================
       TXT and JSON
       ============================================================ */

    function exportTxt(resume, filenameBase) {
        var name = u.trim(resume.contact.name) || 'Resume';
        var text = RB.render.plainText(resume);
        u.downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }),
            u.safeFilename(filenameBase || name, 'resume') + '_CV.txt');
        return Promise.resolve({ bytes: text.length });
    }

    function exportBackupJson(payload, filenameBase) {
        var json = JSON.stringify(payload, null, 2);
        u.downloadBlob(new Blob([json], { type: 'application/json' }),
            u.safeFilename(filenameBase || 'nene-cv-backup', 'backup') + '.json');
        return Promise.resolve({ bytes: json.length });
    }

    /* ============================================================
       PRINT — the browser's own "Save as PDF" also yields real text
       ============================================================ */

    function printResume(resume, template) {
        var root = document.getElementById('print-root');
        if (!root) {
            root = document.createElement('div');
            root.id = 'print-root';
            document.body.appendChild(root);
        }
        root.innerHTML = RB.render.documentHtml(resume, template);

        var name = u.trim(resume.contact.name) || 'CV';
        var previousTitle = document.title;
        document.title = name + ' - CV';

        function restore() {
            document.title = previousTitle;
            window.removeEventListener('afterprint', restore);
        }
        window.addEventListener('afterprint', restore);

        window.print();
        // Safari never fires afterprint in some versions.
        setTimeout(restore, 8000);

        return Promise.resolve();
    }

    RB.exporters = {
        buildPdf: buildPdf,
        buildDocx: buildDocx,
        exportPdf: exportPdf,
        exportDocx: exportDocx,
        exportHtml: exportHtml,
        exportTxt: exportTxt,
        exportBackupJson: exportBackupJson,
        printResume: printResume,
        pdfSafe: pdfSafe,
        DOC_CSS: DOC_CSS
    };
})(window.RB);

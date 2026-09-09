/* ============================================================
   render.js — build the resume document markup

   RB.render.resumeHtml(resume)        -> inner HTML of the document
   RB.render.documentHtml(resume, tpl) -> the full <div class="resume-doc">
   RB.render.plainText(resume)         -> ATS-safe .txt rendering

   One renderer feeds the on-screen preview, the print/PDF path,
   the HTML export and the DOCX export, so what the user sees is
   exactly what a parser gets. Every interpolation is escaped.

   Structural rules, repeated here because they are load-bearing:
     - one column, in the fixed section order below
     - real <h1>/<h2>/<h3> and <ul>, no tables, no flex columns
     - dates on their own meta line, never right-aligned
     - no icons or images inside the document
   ============================================================ */

(function (RB) {
    'use strict';

    var u = RB.util;
    var esc = u.esc;

    /* Standard headings. These exact words are what parsers look
       for — "My Journey" instead of "Work Experience" is a real
       and common cause of a section being missed entirely. */
    var HEADINGS = {
        summary: 'Professional Summary',
        experience: 'Work Experience',
        education: 'Education',
        skills: 'Skills',
        certifications: 'Certifications',
        projects: 'Projects'
    };

    function documentHtml(resume, template) {
        var tpl = template || 'modern';
        return '<div class="resume-doc ' + esc(tpl) + '">' + resumeHtml(resume) + '</div>';
    }

    function resumeHtml(r) {
        return [
            headerBlock(r),
            summaryBlock(r),
            experienceBlock(r),
            educationBlock(r),
            skillsBlock(r),
            certificationsBlock(r),
            projectsBlock(r)
        ].filter(Boolean).join('\n');
    }

    /* ---------- header ---------- */

    function headerBlock(r) {
        var c = r.contact;
        var name = u.trim(c.name) || 'Your Name';

        var bits = [];
        if (u.trim(c.email))     bits.push(u.trim(c.email));
        if (u.trim(c.phone))     bits.push(u.trim(c.phone));
        if (u.trim(c.location))  bits.push(u.trim(c.location));
        if (u.trim(c.linkedin))  bits.push(u.trim(c.linkedin));
        if (u.trim(c.portfolio)) bits.push(u.trim(c.portfolio));

        var html = '<header class="r-head">';
        html += '<h1 class="r-name">' + esc(name) + '</h1>';
        if (u.trim(c.title)) {
            html += '<p class="r-title">' + esc(u.trim(c.title)) + '</p>';
        }
        if (bits.length) {
            html += '<p class="r-contact">' +
                bits.map(function (b) { return '<span>' + esc(b) + '</span>'; }).join('') +
                '</p>';
        }
        html += '</header>';
        return html;
    }

    /* ---------- summary ---------- */

    function summaryBlock(r) {
        if (u.isBlank(r.summary)) return '';
        return section(HEADINGS.summary,
            '<p class="r-summary">' + esc(u.trim(r.summary)) + '</p>');
    }

    /* ---------- experience ---------- */

    function experienceBlock(r) {
        var entries = r.experience.filter(function (j) {
            return u.trim(j.title) || u.trim(j.company) ||
                   j.bullets.some(function (b) { return u.trim(b); });
        });
        if (!entries.length) return '';

        var body = entries.map(function (job) {
            var html = '<article class="r-entry">';

            if (u.trim(job.title)) {
                html += '<h3 class="r-entry-title">' + esc(u.trim(job.title)) + '</h3>';
            }

            var meta = [];
            if (u.trim(job.company))  meta.push(u.trim(job.company));
            if (u.trim(job.location)) meta.push(u.trim(job.location));
            var range = u.formatRange(job.startDate, job.endDate, job.current);
            if (range) meta.push(range);

            if (meta.length) {
                html += '<p class="r-entry-meta">' +
                    meta.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') +
                    '</p>';
            }

            var bullets = job.bullets.filter(function (b) { return u.trim(b); });
            if (bullets.length) {
                html += '<ul class="resume-ul">' +
                    bullets.map(function (b) { return '<li>' + esc(u.trim(b)) + '</li>'; }).join('') +
                    '</ul>';
            }

            html += '</article>';
            return html;
        }).join('\n');

        return section(HEADINGS.experience, body);
    }

    /* ---------- education ---------- */

    function educationBlock(r) {
        var entries = r.education.filter(function (e) {
            return u.trim(e.degree) || u.trim(e.institution);
        });
        if (!entries.length) return '';

        var body = entries.map(function (edu) {
            var html = '<article class="r-entry">';

            if (u.trim(edu.degree)) {
                html += '<h3 class="r-entry-title">' + esc(u.trim(edu.degree)) + '</h3>';
            }

            var meta = [];
            if (u.trim(edu.institution)) meta.push(u.trim(edu.institution));
            if (u.trim(edu.location))    meta.push(u.trim(edu.location));
            var range = u.formatRange(edu.startDate, edu.endDate, false);
            if (range) meta.push(range);

            if (meta.length) {
                html += '<p class="r-entry-meta">' +
                    meta.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') +
                    '</p>';
            }

            if (u.trim(edu.details)) {
                html += '<p class="r-inline-note">' + esc(u.trim(edu.details)) + '</p>';
            }

            html += '</article>';
            return html;
        }).join('\n');

        return section(HEADINGS.education, body);
    }

    /* ---------- skills ---------- */

    function skillsBlock(r) {
        var groups = r.skills.filter(function (g) { return g.items.length; });
        if (!groups.length) return '';

        var body = groups.map(function (g) {
            var items = g.items.map(u.trim).filter(Boolean).join(', ');
            if (!items) return '';
            var label = u.trim(g.category);
            return '<p class="r-skill-line">' +
                (label ? '<strong>' + esc(label) + ':</strong> ' : '') +
                esc(items) +
                '</p>';
        }).filter(Boolean).join('\n');

        if (!body) return '';
        return section(HEADINGS.skills, body);
    }

    /* ---------- certifications ---------- */

    function certificationsBlock(r) {
        var entries = r.certifications.filter(function (c) { return u.trim(c.name); });
        if (!entries.length) return '';

        var body = '<ul class="resume-ul">' + entries.map(function (c) {
            var parts = [u.trim(c.name)];
            if (u.trim(c.issuer)) parts.push(u.trim(c.issuer));
            var d = u.formatMonth(c.date);
            if (d) parts.push(d);
            return '<li>' + esc(parts.join(' | ')) + '</li>';
        }).join('') + '</ul>';

        return section(HEADINGS.certifications, body);
    }

    /* ---------- projects ---------- */

    function projectsBlock(r) {
        var entries = r.projects.filter(function (p) { return u.trim(p.name); });
        if (!entries.length) return '';

        var body = entries.map(function (p) {
            var html = '<article class="r-entry">';
            html += '<h3 class="r-entry-title">' + esc(u.trim(p.name)) + '</h3>';

            var meta = [];
            if (u.trim(p.tech)) meta.push(u.trim(p.tech));
            if (u.trim(p.link)) meta.push(u.trim(p.link));
            if (meta.length) {
                html += '<p class="r-entry-meta">' +
                    meta.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') +
                    '</p>';
            }

            var bullets = p.bullets.filter(function (b) { return u.trim(b); });
            if (bullets.length) {
                html += '<ul class="resume-ul">' +
                    bullets.map(function (b) { return '<li>' + esc(u.trim(b)) + '</li>'; }).join('') +
                    '</ul>';
            }
            html += '</article>';
            return html;
        }).join('\n');

        return section(HEADINGS.projects, body);
    }

    function section(title, body) {
        return '<section class="r-section">' +
            '<h2 class="section-title">' + esc(title) + '</h2>' +
            body +
            '</section>';
    }

    /* ============================================================
       PLAIN TEXT
       The format to paste into an application form's "paste your
       resume" box. Nothing parses better than this.
       ============================================================ */

    function plainText(r) {
        var out = [];
        var c = r.contact;

        if (u.trim(c.name)) out.push(u.trim(c.name).toUpperCase());
        if (u.trim(c.title)) out.push(u.trim(c.title));

        var bits = [];
        ['email', 'phone', 'location', 'linkedin', 'portfolio'].forEach(function (k) {
            if (u.trim(c[k])) bits.push(u.trim(c[k]));
        });
        if (bits.length) out.push(bits.join(' | '));

        if (u.trim(r.summary)) {
            out.push('', HEADINGS.summary.toUpperCase(), '', wrap(u.trim(r.summary), 78));
        }

        var jobs = r.experience.filter(function (j) {
            return u.trim(j.title) || u.trim(j.company);
        });
        if (jobs.length) {
            out.push('', HEADINGS.experience.toUpperCase(), '');
            jobs.forEach(function (job, i) {
                if (i) out.push('');
                if (u.trim(job.title)) out.push(u.trim(job.title));
                var meta = [];
                if (u.trim(job.company))  meta.push(u.trim(job.company));
                if (u.trim(job.location)) meta.push(u.trim(job.location));
                var range = u.formatRange(job.startDate, job.endDate, job.current);
                if (range) meta.push(range);
                if (meta.length) out.push(meta.join(' | '));
                job.bullets.filter(function (b) { return u.trim(b); }).forEach(function (b) {
                    out.push(wrap('- ' + u.trim(b), 78, '  '));
                });
            });
        }

        var edus = r.education.filter(function (e) {
            return u.trim(e.degree) || u.trim(e.institution);
        });
        if (edus.length) {
            out.push('', HEADINGS.education.toUpperCase(), '');
            edus.forEach(function (edu, i) {
                if (i) out.push('');
                if (u.trim(edu.degree)) out.push(u.trim(edu.degree));
                var meta = [];
                if (u.trim(edu.institution)) meta.push(u.trim(edu.institution));
                if (u.trim(edu.location))    meta.push(u.trim(edu.location));
                var range = u.formatRange(edu.startDate, edu.endDate, false);
                if (range) meta.push(range);
                if (meta.length) out.push(meta.join(' | '));
                if (u.trim(edu.details)) out.push(wrap(u.trim(edu.details), 78));
            });
        }

        var groups = r.skills.filter(function (g) { return g.items.length; });
        if (groups.length) {
            out.push('', HEADINGS.skills.toUpperCase(), '');
            groups.forEach(function (g) {
                var label = u.trim(g.category);
                var items = g.items.map(u.trim).filter(Boolean).join(', ');
                out.push(wrap((label ? label + ': ' : '') + items, 78, '  '));
            });
        }

        var certs = r.certifications.filter(function (x) { return u.trim(x.name); });
        if (certs.length) {
            out.push('', HEADINGS.certifications.toUpperCase(), '');
            certs.forEach(function (cert) {
                var parts = [u.trim(cert.name)];
                if (u.trim(cert.issuer)) parts.push(u.trim(cert.issuer));
                var d = u.formatMonth(cert.date);
                if (d) parts.push(d);
                out.push(wrap('- ' + parts.join(' | '), 78, '  '));
            });
        }

        var projects = r.projects.filter(function (p) { return u.trim(p.name); });
        if (projects.length) {
            out.push('', HEADINGS.projects.toUpperCase(), '');
            projects.forEach(function (p, i) {
                if (i) out.push('');
                out.push(u.trim(p.name));
                var meta = [];
                if (u.trim(p.tech)) meta.push(u.trim(p.tech));
                if (u.trim(p.link)) meta.push(u.trim(p.link));
                if (meta.length) out.push(meta.join(' | '));
                p.bullets.filter(function (b) { return u.trim(b); }).forEach(function (b) {
                    out.push(wrap('- ' + u.trim(b), 78, '  '));
                });
            });
        }

        return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
    }

    /* Soft-wrap at a column, indenting continuation lines. */
    function wrap(text, width, indent) {
        var pad = indent || '';
        var words = u.trim(text).split(' ');
        var lines = [];
        var line = '';

        words.forEach(function (word) {
            var candidate = line ? line + ' ' + word : word;
            var limit = lines.length ? width - pad.length : width;
            if (candidate.length > limit && line) {
                lines.push(line);
                line = word;
            } else {
                line = candidate;
            }
        });
        if (line) lines.push(line);

        return lines.map(function (l, i) { return i ? pad + l : l; }).join('\n');
    }

    RB.render = {
        HEADINGS: HEADINGS,
        resumeHtml: resumeHtml,
        documentHtml: documentHtml,
        plainText: plainText
    };
})(window.RB);

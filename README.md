# Nene's CV Platform

**Past the filter, into the room.**

A CV builder that targets the software reading your CV *and* the person reading it
afterwards. Upload an existing CV and have it rebuilt, or start from scratch, then
export something an applicant tracking system can actually read.

Everything runs in the browser. There is no server, no build step and no dependencies
to install — it is static HTML, CSS and plain JavaScript.

**[Try it →](https://kagisogotech.github.io/Resumebuilder/)**

---

## Why this exists

Most CVs are filtered by software before a human sees them. The failures are boring and
fixable, and this app fixes them:

| Problem | What this does |
|---|---|
| PDFs that are secretly images (`html2canvas` and friends) | Typesets the PDF as a real text layer — open it and press Ctrl+F |
| `.docx` files that are HTML in a `.docx` wrapper | Emits genuine WordprocessingML paragraphs |
| Two columns and sidebars, which scramble reading order | Every template is a single column |
| Tables, text boxes, headers and footers | None used; contact details live in the document body |
| Invented section headings ("My Journey") | Fixed, standard headings parsers recognise |
| Incomplete dates | Month-level date fields, flagged when missing |
| "Responsible for…" bullets | Rewritten to lead with a past-tense action verb |

---

## Features

### Upload and rebuild an existing CV
Drop in a **PDF**, **.docx** or **.txt**. The text is extracted in-browser, split into
sections, and rebuilt as a clean single-column CV. You get a before/after ATS score, a
full log of every change, and an explicit list of what the importer was unsure about.

PDF text is reconstructed by grouping glyph runs by baseline, so line structure survives.
Where the source looks like it uses two columns, the importer says so rather than
pretending it got a clean read.

### A rewrite that fixes form, never fact
`js/revamp.js` restructures wording:

- filler openers become verbs — "was responsible for the management of a team" → "Managed a team"
- auxiliaries are stripped and the verb tensed — "was able to assist" → "Assisted"
- leading first-person pronouns removed, dates normalised, roles sorted newest-first
- skills de-duplicated, capitalisation canonicalised (`sap` → `SAP`), self-rated star
  ratings and "(90%)" proficiency labels stripped, then grouped into labelled categories

**It will not invent a number, a tool, an employer or an outcome.** You sign your name to
a CV. Where a bullet needs a figure, the engine says so and leaves the writing to you.

It also deliberately declines to edit prose mid-sentence. Removing clichés with regular
expressions turns "I am a hard-working and highly motivated individual with excellent
communication skills" into "And highly motivated individual with." — so clichés and
mid-sentence pronouns are **reported**, not silently mangled.

### An ATS score that tells you what to fix
Seven weighted categories out of 100, live as you type: contact completeness, required
sections, content depth, quantified results, phrasing, format hygiene and skills breadth.
Every finding carries the specific fix, ordered worst-first. It also checks
reverse-chronological order and flags employment gaps over 12 months.

### Match against a specific job advert
Paste an ad and see which of its terms are missing. Terms under a "requirements" or
"must have" heading are weighted higher than boilerplate about company culture, and
multi-word skills are matched as phrases so "machine learning" counts once rather than
as two meaningless tokens.

### Profiles and multiple CVs
Optional local profiles with a PIN, and as many CVs as you like per profile — rename,
duplicate, delete, and download a JSON backup. A tailored CV per role beats one generic
CV every time.

### Exports
PDF (real text layer), Word `.docx` (real OOXML), plain text, self-contained HTML, and
browser print. Plus copy-as-plain-text for "paste your CV here" boxes.

### Document structure

Five templates — **Professional** (centred header, plain bold headings), Modern, Classic,
Executive and Compact. They differ only in colour and type: the DOM, the section order and
the heading words are identical, so all five parse the same.

Sections render in the fixed order parsers expect: contact, Professional Summary, Work
Experience, Education, Skills, Certifications, Projects.

Experience **and Projects** both take multi-bullet entries. A project worth listing usually
has several distinct things to say about it, and each bullet gets graded for an action verb
and a metric individually — project bullets count toward the quantification score exactly
like job bullets, because they are the same kind of claim. Skills group under labelled
categories as bold-label comma lists, which is the most parseable skills layout there is.

---

## Accounts, storage and privacy — the honest version

**No login is required.** Open the app and start typing; work saves to your browser
straight away. Creating a profile is optional and only groups your CVs under a name.

Storage is **local to your browser on your device** (IndexedDB, falling back to
localStorage where a browser blocks IndexedDB on `file://` origins). Nothing is uploaded:
reading your CV, scoring it, rewriting it and generating every export all happen in the tab.

The trade-offs, stated plainly:

- Clearing your browser data **deletes your CVs**. Download a backup from **My CVs**.
- CVs do **not** sync to your phone or another computer.
- The PIN separates people sharing a computer. It is PBKDF2-stretched and never stored in
  plain text, but it is **not encryption** — anyone with developer tools on your machine
  can read the stored records. Keep genuinely sensitive details out of CV fields.

Swapping in real cloud accounts means writing one more storage driver against the nine
methods documented at the top of `js/store.js`; nothing else needs to change.

---

## Running it

No install needed. Either open `index.html` in a browser, or serve the folder:

```bash
python -m http.server 8123
```

Then visit <http://localhost:8123>.

Serving over HTTP is recommended over opening the files directly: some browsers restrict
IndexedDB on `file://` origins, and the app will fall back to simpler storage and tell you
so. Deploys to GitHub Pages as-is.

---

## Project structure

```
.
├── index.html          Landing page
├── welcome.html        The editor
├── code.js             Application controller: UI, state, autosave
├── style.css           App chrome + the ATS-safe resume document styles
├── assets/logo.svg     The CV monogram
└── js/
    ├── util.js         Escaping, dates, downloads, clipboard
    ├── model.js        Resume schema, blank/sample docs, v1→v2 migration
    ├── store.js        Local profiles and saved CVs (driver-based)
    ├── ats.js          Scoring engine and job-description matching
    ├── parse.js        CV text extraction and section detection
    ├── revamp.js       The rewrite rules engine
    ├── render.js       Resume markup and plain-text rendering
    └── exporters.js    PDF, DOCX, HTML, TXT, JSON, print
```

Scripts load in dependency order and share a single `window.RB` namespace. Plain
`<script>` tags rather than ES modules, so the app still works opened straight off disk.

CVs saved by the previous version are migrated automatically on first load, including the
old flat skills list and single-string job descriptions.

### Third-party libraries

Loaded from a CDN, and the heavy ones only on demand: **Tailwind** (chrome), **lucide**
(icons), **pdf.js** (reading PDFs), **mammoth.js** (reading .docx), **jsPDF** (writing
PDFs), **JSZip** (writing .docx).

---

## Contributing

Two rules matter more than the rest:

1. **Do not reintroduce ATS-hostile layout for looks.** No tables, no multi-column
   resume layouts, no icons or images inside the document, no canvas-rendered PDFs.
   The constraints are documented in `style.css` and `js/render.js`.
2. **The rewrite engine must not fabricate content.** Form, never fact.

Otherwise: issues and pull requests welcome.

## Licence

MIT. Free to use, modify and distribute.

Built by Kagiso.

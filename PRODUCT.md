# GradeGoal

**One-liner:** "What do I need on the final?" plus a weighted grade book and GPA planner — mobile-first, saved locally, shareable.

**Live at:** `https://rouraroble.github.io/gradegoal/` (GitHub Pages project site).

## What it is

Four free, static, client-side calculators for students:

1. **Final grade calculator** (`/final-grade-calculator/`, also the home page hero) — current grade + final's weight + target grade → exact score needed, with a plain-English verdict and a full table of needed scores per letter grade. Three variants: final replaces your lowest test, a two-part final, and points-based grading.
2. **Weighted grade calculator** (`/grade-calculator/`) — categories with weights, per-item scores, drop-lowest, what-if rows, a live running grade, save/export/import/print, and a "teacher link" that shares your grading structure (categories + weights) without your scores.
3. **GPA calculator** (`/gpa-calculator/`) — semester and cumulative GPA across 20 researched grading scales (see Data below; 14 are usable in the interactive averager, the rest — UK classification, India CGPA, ECTS and the inverted/descriptive scales — are reference tables only), optional Honors/AP weighting, save multiple semesters locally.
4. **GPA planner** (`/gpa-planner/`) — "I'm at X, I want Y, in N credits" → the average you need, plus tables for "what's the best GPA I could reach" and "how many credits at a given average."

Plus three small single-purpose converters (`/gpa-to-percentage/`, `/percentage-to-gpa/`, `/letter-grade-to-gpa/`), 28 programmatic reference pages (8 final-weight matrices + 20 grading-scale pages), and 2 guide pages (`/how-to-calculate-gpa/`, `/weighted-vs-unweighted-gpa/`) with worked examples.

Every result is computed in the browser. Nothing is uploaded; saved courses/semesters live only in the visitor's `localStorage`.

## Data sources & licences

All grading-scale data lives in `src/data/scales.json` (20 entries) and is bundled at build time — calculating a grade never makes a network request. (Analytics is a separate, opt-in concern: when `PUBLIC_BEACON_URL` is configured for a deployment, one cookieless pageview beacon is sent per page load — see `src/pages/privacy.astro`.) Each entry records `generic` (a widely-used convention, not tied to one institution — its `source.url` is `null`) or a `source` object with the exact URL, title and the date it was verified (2026-09-23):

- **Generic conventions** (no single citable institution — accuracy checked against common knowledge, not fabricated): US unweighted 4.0, US plus 4.3, US weighted 5.0 (Honors +0.5/AP +1.0), US weighted 6.0 (Honors +1.0/AP +2.0), percentage→4.0 mapping, letter-only 4.0, Australia's 7-point scale, Spain's 0–10 scale.
- **Verified institutions/systems**, each cited to an official page:
  - MIT — `registrar.mit.edu` (5.0 scale: A=5…F=0)
  - Harvard FAS — `infoforfaculty.fas.harvard.edu` (4.0, no A+)
  - Purdue — `polytechnic.purdue.edu` Office of Academic Advising (4.0, A+ = A = 4.0; corrected after audit 1 to one-decimal weights — the Office of the Registrar's own grading page has no grade-point table)
  - UT Austin — `catalog.utexas.edu` (4.0, no A+)
  - Penn State — `registrar.psu.edu` (4.0, only 9 official grades — no A+/C-/D+)
  - University of Toronto — `registrar.utoronto.ca` (full 13-grade table with percentage bands, in effect since 1998)
  - UBC — `vancouver.calendar.ubc.ca` (percentage bands only; UBC's calendar does not publish a single university-wide GPA-point column, so none is invented)
  - UK Honours classification — `ucl.ac.uk` (First/2:1/2:2/Third, standard 70/60/50/40 convention)
  - India CGPA (CBSE) — `cbseacademic.nic.in` (official ×9.5 percentage formula)
  - ECTS — `erasmus-plus.ec.europa.eu` (European Commission)
  - Germany (Modified Bavarian Formula) — `uni-heidelberg.de`
  - France (/20) — `univ-catholille.fr`

Any school the team could not verify against an official public page (e.g. Stanford's numeric GPA points, which its own policy page does not publish; University of Michigan's exact plus/minus point table) was **deliberately skipped** rather than guessed, per the brief's "accuracy matters more than count."

Libraries: Astro 7 (MIT), Preact (MIT), `@fontsource/inter` + `@fontsource/sora` (OFL), `satori` + `sharp` (MIT/Apache-2.0) for build-time OG images. All permissive.

## Formulas (see `/about/` for the full write-up, and `src/lib/grades.ts` for the implementation + `tests/unit/grades.test.ts` for hand-checked cases)

- Final grade: `final = (target − current × (1 − weight)) / weight`, plus algebraic variants for "final replaces lowest test", "two-part final" and "points-based."
- Weighted grade book: per-category average (points-weighted or equal-weight) with drop-lowest, categories with no graded items excluded and remaining weights renormalised (LMS convention).
- GPA: `Σ(points × credits) / Σ(credits)`; cumulative folds in a prior GPA/credit count; Honors/AP adds a configurable bonus (never to a failing grade).
- Planner: algebraic rearrangements of the cumulative-GPA formula.

## Identity

Indigo (`#4f46e5`) + a WCAG-AA-checked feasibility palette (success/warning/danger, verified ≥4.5:1 contrast in both themes), Sora for headings, Inter for body, a target-and-checkmark favicon mark. Feasibility is always labelled in text, never colour-only.

## Monetization hooks (not active)

`<AdSlot slot="...">` placeholders below every tool's result (render nothing until `PUBLIC_ADSENSE_CLIENT` is set). No affiliate partner has been identified yet for tutoring/test-prep — the brief's affiliate block was left out rather than filled with a placeholder `#` link with no real partner in mind; add one to `src/site.config.ts` (`affiliate` object) when a partner exists. A "Pro" cloud-sync stub (sync saved courses/semesters across devices) is a natural low-effort next monetization step — see Next improvements in `STATUS.md`.

## Known limits

- Grading-scale data is a snapshot verified 2026-09-23; schools change policies. Every scale page states its source and date and tells the visitor to check their own syllabus.
- The interactive GPA averager only accepts scales with a clean ascending letter/percent/numeric point column (14 of 20); the other 6 (UBC's percent-only scale, UK classification, India CGPA, ECTS, and the inverted/descriptive Germany and France scales) are reference tables plus a dedicated small converter where one made sense (India CGPA).
- International/inverted scales (Germany's 1.0=best, France's /20) are shown as reference tables, not wired into the semester averager, since mixing "lower is better" into the same UI would be confusing and none of GradeGoal's saved-course flows assume an inverted scale.

# Contributing to CareerOps

CareerOps is a small, dependency-free résumé-to-form demo. Contributions should
make the local intake, clarification, reviewed FillPlan, or local-only browser
assistance clearer, safer, and more testable without weakening the
human-in-the-loop boundary.

## Local setup

Requirements: Node.js 20 or later and a modern browser. The baseline project
has no runtime dependency install step.

```bash
git clone https://github.com/ayan-saiyad/CareerOps.git
cd CareerOps
npm run dev
```

Open the local URL printed by the server. Use `fake-ats.html` and
`workday-demo.html` as the only browser-fill development targets.

Run these checks before opening a pull request:

```bash
npm run check
npm test
```

## Project map

| Path | Purpose |
| --- | --- |
| `index.html`, `styles.css`, `src/simple.css`, `src/app.js` | Résumé-first local UI and reviewed FillPlan orchestration |
| `src/domain/resume-intake.js` | Conservative local résumé extraction |
| `src/domain/form-answer-resolver.js` | Deterministic current-question classification |
| `src/domain/clarification-queue.js` | Candidate-input and manual-only task queue |
| `fake-ats.html`, `src/fake-ats.js` | Fictional local application flow |
| `workday-demo.html`, `src/workday-demo.*` | Synthetic Workday-like mapping fixture; never a real Workday integration |
| `extension/` | Manifest V3, local-fixtures-only reviewed fill companion |
| `tests/` | Node built-in test runner unit and contract tests |
| `docs/` | Architecture, safety, evaluation, and contribution guidance |

Other pure domain modules in `src/domain/` are retained portfolio examples.
Do not make the résumé-first UI depend on job crawling, automatic ranking, or
application submission without an explicit new product design.

## Implementation rules

- Use standard browser and Node APIs before proposing a package. The project has
  no runtime third-party dependencies by design.
- Keep `src/domain/` modules pure and deterministic. UI code may render a
  result; parser, resolver, and queue code must calculate it without browser
  authority or network access.
- The résumé parser may extract only clear, reusable contact, public-link, and
  education facts. It must not infer authorization, sponsorship, compensation,
  demographics, legal answers, credentials, or identity facts.
- Preserve an explicit candidate default over a conflicting résumé hint. Keep
  ambiguous hints absent rather than choosing one.
- Treat `form-answer-resolver.js` and `clarification-queue.js` as safety
  boundaries. Normalize labels/context, require exact native option matches,
  preserve abstention reasons, and do not turn a non-empty value into authority
  to fill a form.
- A company-specific response may be carried only after the candidate writes
  and approves it for the exact normalized current question. Do not add fuzzy
  matching or page-generated answer text.
- Add or update Node built-in tests for every behavior change in resume intake,
  question resolution, queue handling, plan validation, or extension mapping.
- Keep test data fictional and deterministic. Avoid real résumés, credentials,
  employer pages, screenshots, and clock-dependent assertions unless the clock
  is passed into the function under test.
- Keep extension changes local-only and preserve the **Preview → select → Fill**
  consent path. Do not add broad origins, submit interaction, uploads,
  credential handling, or background form activity.

## Local fixture and future host access

`workday-demo.html` is the controlled test surface for Workday-style labels,
native select/radio options, conditional questions, free text, and voluntary
disclosures. Update it and its resolver/extension tests together when changing
the question vocabulary or form extraction behavior.

The repository does **not** support a real Workday domain. A proposal for an
optional real-site adapter must be reviewed before code is written. It must
specify the exact hostname and permission lifecycle, explicit enablement and
revocation, field-by-field preview behavior, failure-closed handling for custom
widgets, data-transfer rules, and manual validation steps. It cannot turn the
fixture into blanket Workday access.

Likewise, adding a ChatGPT/API capability needs a separate opt-in design. It
must describe what résumé/application data leaves the device, where it is sent,
how it is retained, the candidate's review controls, failure behavior, and how
unsupported claims remain blocked.

## Safety review is part of code review

Changes that touch résumé text, profile data, question handling, FillPlans, or
browser filling must answer these questions in the pull request description:

1. Does this extract or claim anything that the candidate did not explicitly
   provide or clearly state in their résumé?
2. Can untrusted page text change a decision, a permission, or a fill value?
3. Does a sensitive, changing, conditional, or unknown field still require
   candidate review?
4. Could this cause a real submission, login, MFA action, CAPTCHA handling, or
   external data transfer?
5. Does an ambiguous scope, matcher, or FillPlan fail closed rather than guess?

If any answer is unclear, keep the work in a fictional local fixture or design
a narrower adapter first. Read [safety.md](safety.md) before modifying the
workflow.

## Pull requests

- Keep a pull request focused and explain the user-visible behavior change.
- Include tests and update relevant documentation or fixture labels.
- State how you manually exercised the résumé-first screen and local fixture
  when a workflow changes.
- Do not commit `.env` files, real candidate data, credentials, or employer
  screenshots. Use fictional fixtures and redacted examples only.
- Include the evaluation corpus, numerator/denominator, and date for any
  reported safety or mapping score.

# CareerOps

> A simple, local résumé-to-form helper for reviewing reusable application
> details and pausing for the questions that need a person.

CareerOps starts with a résumé and a small set of editable defaults. It extracts
only clear, non-sensitive contact, public-link, and education details locally,
then creates a short-lived, reviewed FillPlan for a form. It is a portfolio
demo of careful form assistance—not an unattended auto-apply system.

All built-in examples are fictional. The demo does not contact an employer,
send résumé data to a server, or use a hosted ChatGPT/API service.

## What it does today

- **Résumé-first intake** — paste résumé text or load a local `.txt`/`.md`
  file. The deterministic parser copies only clear reusable details into
  editable defaults; it does not infer authorization, sponsorship,
  compensation, legal, or demographic answers.
- **Editable defaults** — review name, contact details, location, public links,
  and education before anything is prepared for a form. Work authorization and
  sponsorship require explicit yes/no confirmation.
- **Current-form question handling** — the resolver classifies the questions
  that are actually present in the local Workday-style fixture. Routine facts
  can be included; company-specific text requires a candidate-written,
  explicitly approved response; unknown, changing, conditional, or protected
  prompts pause for manual completion.
- **Reviewed FillPlan** — creates a page-local plan that expires after five
  minutes. The local browser companion offers only compatible fields through
  **Preview → select → Fill**.
- **Local application queue** — records links the candidate wants to review.
  It does not crawl those links, sign in, inspect a live application, or submit
  anything.

## What it deliberately does not do

- It does not connect to ChatGPT, upload a PDF/DOCX, or send résumé text to an
  AI provider. Adding an AI-backed parser or writer would require an explicit
  opt-in backend, credentials, privacy design, and review controls.
- It does not search for jobs, scrape job boards, create accounts, log in,
  handle MFA/CAPTCHAs, or access real Workday tenants.
- It does not fill checkboxes, sensitive disclosures, legal terms,
  attestations, uploads, passwords, compensation, changing availability, or
  final Submit controls.
- It does not claim a form was submitted. The candidate performs the employer's
  native submission step.

## Quick start

CareerOps has no runtime npm dependencies. It needs Node.js 20 or newer.

```bash
git clone https://github.com/ayan-saiyad/CareerOps.git
cd CareerOps
npm run dev
```

Open [http://localhost:4173](http://localhost:4173).

To verify the project:

```bash
npm run check
npm test
```

## Local demo flow

```text
Paste résumé text
      ↓
Review editable reusable defaults
      ↓
Answer only unresolved questions in the local fixture
      ↓
Explicitly approve exact company-specific text
      ↓
Create a five-minute local FillPlan
      ↓
Preview → select → Fill on a local controlled form
      ↓
Candidate reviews and submits manually
```

1. Paste résumé text and select **Use résumé details**.
2. Confirm the reusable defaults. Verify work authorization and sponsorship
   directly; CareerOps never extracts either from a résumé.
3. Review the local fixture's unresolved questions. A company-specific answer
   must be written and approved for that exact question. Protected questions
   remain manual.
4. Choose **Create reviewed FillPlan**.
5. Open the local Workday-style fixture, then use the companion in
   [`extension/`](extension/README.md) to preview, select, and fill supported
   fields. It never submits the form.

## Architecture at a glance

```text
index.html + src/app.js
        │
        ├── resume-intake.js       conservative local extraction
        ├── form-answer-resolver.js current-question classification
        └── clarification-queue.js unanswered/manual task queue
                    │
                    ▼
            short-lived local FillPlan
                    │
                    ▼
      local fixtures + optional local-only extension
```

| Area | Location |
| --- | --- |
| Résumé-first interface | [`index.html`](index.html), [`src/app.js`](src/app.js), [`src/simple.css`](src/simple.css) |
| Resume intake/parser | [`src/domain/resume-intake.js`](src/domain/resume-intake.js) |
| Current-form resolver | [`src/domain/form-answer-resolver.js`](src/domain/form-answer-resolver.js) |
| Clarification queue | [`src/domain/clarification-queue.js`](src/domain/clarification-queue.js) |
| Controlled form fixtures | [`fake-ats.html`](fake-ats.html), [`workday-demo.html`](workday-demo.html) |
| Local-only Chrome companion | [`extension/`](extension/) |
| Full design notes | [`docs/architecture.md`](docs/architecture.md) |
| User-authority and safety model | [`docs/safety.md`](docs/safety.md) |

## Safety and privacy

- Keep real résumé text, candidate profiles, credentials, and API keys out of
  the repository.
- A missing, ambiguous, or unsupported answer remains unanswered; it is never
  guessed from page content or invented from the résumé.
- The current extension is authorized only for `localhost` fixtures. No real
  Workday host permission is included.
- An external AI provider or a real-site adapter is not a configuration switch:
  each would require a separate, explicit product and permission design.

See the complete [safety and user-authority model](docs/safety.md),
[architecture](docs/architecture.md), and [evaluation guide](docs/evaluation.md).

## Future directions

The next safe increment is a user-approved integration design, not broader
automation. Examples include a local PDF/DOCX extraction path, an opt-in
AI-assisted draft workflow with data controls, or a narrowly permissioned
per-tenant adapter. Any of these must preserve exact question matching,
field-by-field review, no-login/no-submit boundaries, and a reliable manual
fallback.

## License

[MIT](LICENSE)

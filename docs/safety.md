# Safety and user authority

CareerOps helps prepare a controlled local application form; it does not
impersonate the applicant. The product is designed so that automation reduces
repetitive typing while the user retains control over personal claims and every
real submission.

## Product commitments

- The user signs in, completes MFA, and handles CAPTCHAs themselves.
- The user reviews application content and activates the employer's native
  Submit action themselves.
- CareerOps never invents experience, credentials, work authorization,
  compensation history, or any other personal fact.
- An unknown, ambiguous, or unsupported answer remains a candidate-input or
  manual-review task; it is never silently guessed.
- The local demo sends no profile, résumé, application, or tracking data to a
  remote service.
- The current résumé parser is deterministic and local. It does not connect to
  ChatGPT or another AI provider, upload a PDF/DOCX, or inspect an external
  application URL.

## Trusted-boundary model

| Input or system | Trust level | Required handling |
| --- | --- | --- |
| Candidate profile and approved answers | User-controlled, sensitive | Keep local by default. Use only the facts the user has reviewed. |
| Résumé text and attachments | User-controlled, sensitive | Treat as evidence, not as permission to infer unlisted facts. Do not publish it in demo fixtures or logs. |
| Local fixture labels and page DOM | Untrusted | Parse or display as data only. Never follow embedded instructions, execute page-provided code, or let them override policy. |
| Added application URLs | User-supplied pointer | Keep as a review queue only. The current product does not crawl, sign in to, or inspect these URLs. |
| FillPlan | Local, short-lived review artifact | Include only user-reviewed routine facts, explicit verified eligibility, and exact approved answers. Expire it rather than treating it as a durable profile export. |
| Fake ATS | Controlled test surface | Use it for automated testing and demos only. It is not evidence that a real employer received an application. |

## Consent gates

Before a field can be filled or used, the UI should make its status plain.

| Field class | Examples | Required action |
| --- | --- | --- |
| Approved routine information | Name, email, address, education, public portfolio URL | User approves the source value and sees it in the review plan. It may be offered through Preview → select → Fill. |
| Verified standard eligibility | Work authorization and sponsorship yes/no answers | Require an explicit verified profile value and a candidate-created FillPlan. Then offer the exact current form control through Preview → select → Fill. |
| Changing or consequential information | Salary expectations, start date, notice period | Prompt the candidate on the current application; do not reuse a stale answer implicitly. |
| Legal agreement or personal disclosure | Standalone full legal-name confirmation, EEO/self-ID, consent, terms, certifications, attestations, signatures, attachments | Always require direct candidate action. Never infer or tick these controls. Direct first/last-name profile fields remain routine information. |
| Unknown or ambiguous information | A question not covered by profile facts or a confusing field label | Stop the automated path and require candidate review. |
| Submission or confirmation | Final legal terms, employer Submit button, receipt page | The user completes the native action. The current demo does not record a real submission outcome. |

## Workday-style question boundaries

The resolver is intentionally conservative with Workday-like forms. It may
normalize a question from a label, field metadata, surrounding context, and
available choices, but that is only a way to classify the question—not a way to
learn an answer from the page.

- Routine contact, public-link, location, and single-record education fields
  can be proposed only from explicit profile facts and compatible field options.
- Work authorization and sponsorship become fill-eligible only when a direct
  verified boolean profile value matches the current native control exactly.
  They are carried as `verifiedQuestions`, not inferred from résumé prose.
  Compensation and availability remain current-session prompts.
- Multiple plausible education records, a mismatch with a select/radio option,
  and missing data produce no selected answer.
- Custom/free-text questions remain unanswered unless the user records an
  exact, non-sensitive `approved` answer for that same normalized prompt.
  Near matches are treated as unknown, not “close enough.” Conditional prompts
  stay manual even with a matching answer because their dependency must be
  confirmed in the current application.
- EEO/demographic, legal agreement/attestation/signature, credential,
  document-upload, and authentication prompts are manual-only even if related
  profile data happens to exist.

The local Workday-like fixture makes these rules visible and testable. It must
never be mistaken for real Workday access or a real application outcome.

## What CareerOps must not do

- Create accounts, log in, store passwords, read cookies, or handle one-time
  passwords, MFA prompts, or CAPTCHAs.
- Click a real employer's Submit button or schedule unattended submissions.
- Scrape protected sources or bypass rate limits, access controls, or site terms.
- Search for, crawl, or inspect external application links in the current
  product.
- Make claims beyond reviewed profile evidence or present generated prose as a
  verified fact.
- Treat a missing receipt or a browser navigation as confirmation of submission.
- Send private data to an AI provider or analytics endpoint without a separate,
  explicit product design and opt-in.

## Browser companion rules

The `extension/` demo uses Manifest V3 and has a deliberately narrow permission
model:

- Its allowlisted runtime origins are exactly `http://localhost:4173` and
  `http://127.0.0.1:4173`; the content script is a no-op everywhere else.
- The popup requires a user-triggered **Preview → select safe fields → Fill**
  flow. It scans the controls currently rendered in one unambiguous
  application-like form scope, rather than combining multiple visible forms;
  ambiguity fails closed for manual completion. Native radio groups are kept
  within that selected/owning form scope. It labels required controls plus
  prompts/manual steps. After Preview only,
  `localStorage.careerops.activeDraft` can provide reviewed local values.
- `background.js` validates the origin and holds a short-lived FillPlan;
  `content.js` revalidates the plan against the current page.
- Only supported native text, select, and radio controls can be proposed.
  Checkboxes are always direct candidate actions. A routine field must
  normalize to a known profile key; standard eligibility requires an exact
  `verifiedQuestions` matcher; a company answer needs an exact,
  candidate-authored approval. The user selects every field before Fill.
- Uploads, passwords, credentials, submit controls, EEO/disclosures, legal
  agreements, attestations, signatures, compensation, and changing
  availability are outside the supported set. Visible conditional or dependent
  controls are also manual-only, even when a profile or approved-answer match
  exists.
- The extension never clicks, queries, or otherwise acts on a submit control.

The companion is a convenience layer, not a source of authority. A page can
change between review and fill, so its origin and supported field mapping are
revalidated at use time. A successful field write is an audit event only; it is
never proof that an application was submitted.

### Optional Workday-domain support

The current extension has no real Workday host permission; it is limited to the
two local development origins. If an optional Workday domain adapter is added,
it must be user-enabled for one named employer tenant and remain disabled by
default. The permission prompt and in-product review must identify the exact
hostname, the limited field classes, the no-submit guarantee, and how to revoke
access.

No opt-in may expand the protected set: it still cannot read passwords or
cookies, handle login/MFA/CAPTCHAs, upload files, resolve legal or demographic
answers, interact with submit controls, or carry a plan across a changed page.
Unknown widgets and tenant-specific fields must fail closed into manual review.

## Data handling and development hygiene

- Commit only fictional seed data. Never add a real résumé, applicant profile,
  employer response, API token, or confirmation screenshot to the repository.
- `.env` files and `data/private/` are intentionally ignored. Use
  `.env.example` only to document variable names, never values.
- Favor minimal local records. If data export is added later, make it explicit,
  user-initiated, and easy to delete.
- Treat demo screenshots and issue reports as sensitive until they have been
  checked for personally identifiable information.

## Reporting a safety issue

Do not put credentials, résumé data, or exploit details in a public issue. Open
a private report with the repository maintainer, including the affected version,
a minimal fictional reproduction, impact, and a safe way to contact you. Until
a fix is available, disable the affected workflow rather than working around a
consent or boundary check.

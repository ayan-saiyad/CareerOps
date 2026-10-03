# Evaluation guide

CareerOps should be evaluated as a safe résumé-intake and form-assistance
product, not by the number of applications it can complete. A useful evaluation
asks whether it extracts only justified reusable details, surfaces the current
form's unresolved questions, and stops where candidate judgment is required.

## Test corpus

Use a small, version-controlled corpus of entirely fictional résumé text,
profile defaults, and local form fixtures. Include both clear and deliberately
ambiguous examples for contact details, public links, and education. Include
current, hidden, conditional, required, native-choice, free-text, and protected
form controls.

Never add real résumés, employer pages, personal contact details, cookies,
application screenshots, or API credentials to the corpus.

## Metrics

| Dimension | Measurement | Why it matters |
| --- | --- | --- |
| Conservative extraction | Correctly extracted clear reusable fields / all proposed fields | A parser should leave doubt blank instead of inventing a profile value. |
| Ambiguity abstention | Ambiguous fields withheld / all ambiguous fixture fields | Measures whether the résumé parser resists choosing among plausible values. |
| Sensitive-data abstention | Protected attributes not extracted / protected test cases | Authorization, sponsorship, compensation, legal, demographic, and identity facts must not be derived from résumé prose. |
| Existing-value preservation | User-supplied defaults retained / conflicting extraction cases | Résumé hints must not silently overwrite a candidate's explicit choice. |
| Current-form coverage | Present unresolved questions surfaced / labeled present unresolved controls | Ensures hidden or stale questions are excluded and required current questions are noticed. |
| Exact-answer precision | Correct exact resolver/approved-answer matches / proposed matches | Prevents a near match from turning into an unrelated form answer. |
| Safe abstention | Protected, conditional, changing, unmatched, or unknown questions kept manual / labeled such questions | Completion rate is not a goal when human review is appropriate. |
| FillPlan integrity | Invalid/expired/conflicting plans rejected; valid plans accepted | Validates the short-lived review boundary. |
| Companion scope safety | Incorrect cross-form/non-local writes / attempted writes | Confirms that form selection and origin checks fail closed. |

Report each percentage with a numerator, denominator, fixture version, and
evaluation date. For example: “19 of 20 ambiguous fixture fields were withheld
(ambiguity abstention = 0.95) on `fixtures-v1`, evaluated 2026-10-02.”

## Required scenarios

At a minimum, automated tests should cover:

- a clear name, email, phone, public LinkedIn/GitHub URL, and education record
  extracting into candidate-reviewable hints;
- multiple plausible values, malformed values, and non-public URLs remaining
  blank rather than being chosen;
- an explicitly supplied default not being overwritten by a résumé hint;
- work authorization, sponsorship, compensation, demographics, legal answers,
  and identity-document facts never being inferred from résumé text;
- a current required form question entering the clarification queue while an
  absent or hidden question does not;
- a missing profile field, unverified eligibility question, availability or
  compensation question, company-specific prompt, unknown prompt, conditional
  question, and protected question each taking the expected path;
- a company-specific answer entering a FillPlan only after the candidate has
  written and explicitly approved it for that exact normalized prompt;
- routine profile values and verified eligibility matching only compatible
  native select/radio options;
- demographic, agreement/attestation/signature, credential, upload, password,
  and submit controls remaining manual-only;
- expired, malformed, or conflicting FillPlans failing closed;
- one unambiguous current application form being scanned while multiple
  ambiguous forms fail closed; and
- an extension request from a non-localhost origin doing nothing.

## Evaluation protocol

1. Freeze the fictional inputs and expected labels before changing parser,
   resolver, queue, or browser-companion behavior.
2. Run `npm run check` and `npm test` with Node.js 20 or later.
3. Record the metrics above, including excluded fixtures and the reason for
   each exclusion.
4. Manually walk through the résumé-first page with fictional text. Confirm
   that it copies only clear values into editable defaults and keeps protected
   categories blank.
5. Manually walk through `workday-demo.html` and `fake-ats.html`. Confirm the
   extension requires Preview → selection → Fill, does not combine form scopes,
   and does not submit.
6. Inspect the manifest/runtime allowlist and confirm no real Workday or other
   employer host has been introduced.

## Scorecard template

```text
Fixture set:              fixtures-v1
Evaluated on:             YYYY-MM-DD
Extraction precision:     __ / __ proposed fields correct
Ambiguity abstention:     __ / __ ambiguous fields withheld
Sensitive abstention:     __ / __ protected cases withheld
Current-form coverage:    __ / __ expected tasks surfaced
Exact-answer precision:   __ / __ proposed matches correct
Safe abstention:          __ / __ protected/manual cases stopped
FillPlan validity:        __ / __ valid plans accepted; __ / __ invalid rejected
Non-local writes:         __ / __ attempted writes
Notes/regressions:        ______________________________
```

The scorecard is evidence, not marketing. A small, well-labeled local corpus is
more useful than a broad collection of unreviewed live applications.

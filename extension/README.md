# CareerOps Safe Fill Companion

This is a deliberately constrained Chrome Manifest V3 companion for the
CareerOps local demo. CareerOps creates its reviewed local plan from editable
résumé-derived defaults and candidate-approved answers; this companion then
recognizes semantic patterns common to ordinary application forms, including
Workday-like markup. It is **not enabled for real employer sites**.

The runtime allowlist remains exactly `http://localhost:4173` and
`http://127.0.0.1:4173`. There are no production host permissions, network
calls, stored credentials, or background submission jobs.

## What it can do

After an explicit popup action, it follows this flow:

1. Select one unambiguous, visible application-like form scope and inspect
   only its currently rendered controls, including native `required` and
   `aria-required` state. Other visible forms, such as a header search or
   newsletter signup, are not combined into the preview; ambiguous pages fail
   closed for manual completion.
2. Build a short-lived preview that separates fillable answers from fields
   needing a candidate answer or a manual action.
3. Let the candidate deselect individual entries.
4. Fill the selected native controls and stop.

The generic adapter reads `label`, `aria-label`, `aria-labelledby`,
`aria-describedby`, `name`, `id`, `autocomplete`, nearby fieldset/group text,
and `data-automation-id` metadata. The latter is a **semantic hint** for
Workday-like pages; the adapter does not depend on a fragile CSS path or a
specific Workday DOM tree.

It can write these native controls when a reviewed value matches exactly:

- text-like inputs and textareas;
- native `<select>` controls;
- native radio groups.

Checkboxes are always manual-only. They often represent consent, an
attestation, or another direct candidate action, so the companion never checks
them on the candidate's behalf.

Native radio grouping stays within that selected form scope (or its owning
native form). Reused radio names elsewhere on a page cannot change the options
shown in the preview. A visible field marked by its container, metadata, or
instruction as conditional/dependent is also manual-only, even if it resembles
a reusable profile field or has an exact approved answer.

Accessible custom controls such as ARIA comboboxes/radios are identified but
remain manual-only. The extension never clicks an opaque page widget, because a
page can attach arbitrary side effects to a click. Preview labels every current
control as ready, required/manual, or needing a candidate answer; it does not
assume every application has the same questions.

## Local FillPlan contract

CareerOps writes the current page's `localStorage.careerops.activeDraft` only
after the candidate creates a reviewed FillPlan. The companion reads it only
after Preview. Nothing is written to `chrome.storage` or sent to a server. The
demo has no ChatGPT/API connection and does not transfer résumé text to the
extension.

Reusable profile keys in `fields` are recognized directly: `firstName`,
`lastName`, `fullName`, `preferredName`, `email`, `phone`, `city`, `state`,
`addressLine1`, `addressLine2`, `postalCode`, `country`, `website`,
`linkedin`, `github`, `school`, `degree`, `major`, and `graduation`.

Reusable eligibility answers need an extra verification record. They are never
inferred from a general profile value. Each record must carry
`verified: true`, use `category: "eligibility"`, and match the rendered
question or stable control ID exactly:

```js
{
  verifiedQuestions: [
    {
      verified: true,
      category: "eligibility",
      id: "workAuthorization",
      question: "Are you authorized to work in the United States?",
      value: true
    },
    {
      verified: true,
      category: "eligibility",
      id: "sponsorship",
      question: "Will you now or in the future require sponsorship for employment visa status?",
      value: false
    }
  ]
}
```

`category: "profile"` may be used for a standard profile field that has an
exact question or ID matcher. It is useful when a site has a nonstandard
control name but its visible question is still an ordinary, reusable profile
fact.

Company-specific prompts remain a candidate-input step. Once the candidate has
written and approved an answer in CareerOps, the plan can carry an exact
`approvedQuestions` matcher. The extension never creates or adapts this text
on a company page:

```js
localStorage.setItem("careerops.activeDraft", JSON.stringify({
  version: 1,
  id: "fill-plan-demo-123",
  expiresAt: "2026-10-01T15:05:00.000Z",
  fields: { firstName: "Taylor", lastName: "Candidate", city: "Austin, TX" },
  approvedQuestions: [{
    approved: true,
    id: "whyThisRole",
    question: "Why are you interested in this role?",
    value: "Candidate-authored and reviewed response for this employer."
  }],
  reviewOnly: ["salary", "startDate"]
}));
```

Question and option matching is exact after case/whitespace/punctuation
normalization; it is never fuzzy. Conflicting matchers, unmatched choices, and
unverified values remain empty. `reviewOnly` is a **hard block** even when a
value exists. This prevents a label on an untrusted page from turning an
unrelated answer into a form write.

Every stored local FillPlan must have a valid, future ISO `expiresAt` value.
Missing, malformed, or expired plans fail closed; the extension never treats a
legacy local value as indefinitely approved.

## Safety model

- **User-gated:** Popup action → Preview → field selection → Fill. Each preview
  is single-use, and the underlying local FillPlan expires after five minutes.
- **Revalidated:** The URL, control kind, accessible question, identifiers, and
  available options must be unchanged between preview and fill.
- **Only verified reusable eligibility:** work authorization and sponsorship
  can appear only after an exact `verifiedQuestions` record and the normal
  Preview → select → Fill confirmation. They remain empty when there is no
  current verified record.
- **Always manual:** password/credential, a standalone full legal-name
  confirmation or sensitive identity/financial data, document upload,
  agreement/consent/attestation/signature, demographic or voluntary
  disclosure, criminal-history, custom widgets, and submission controls are
  never filled, regardless of plan data.
- **No submission path:** source code does not query or click submit controls,
  call `requestSubmit`, dispatch a submit event, send Enter, create an account,
  log in, read passwords, or handle MFA/OTP/CAPTCHA prompts.
- **Short-lived data:** DOM references and the preview’s answer values are
  discarded after its single fill attempt. The page-local FillPlan remains
  valid only until its expiry, and a manually synced worker-memory copy lasts
  for at most five minutes; neither is persisted in `chrome.storage`. The
  popup cannot name a selector or supply a new page value.

## Try it locally

1. Start CareerOps with `npm run dev` from the repository root.
2. Load this `extension/` folder from `chrome://extensions` with Developer
   mode enabled.
3. In CareerOps, paste fictional résumé text if desired, confirm the defaults,
   create a reviewed FillPlan, and open either
   `http://localhost:4173/fake-ats.html` or
   `http://localhost:4173/workday-demo.html`.
4. Open the extension, choose **Preview reviewed fields**, review/deselect
   entries, then choose **Fill selected fields — never submit**.

While on a local CareerOps page, **Sync reviewed FillPlan for this browser
session** exports a normalized, already-reviewed subset into service-worker
memory for up to five minutes. It is deliberately a manual action and does not
use `chrome.storage`. This prepares the transfer boundary for a future
user-approved tenant integration; it does not give this version access to a
real job site.

`fixtures/workday-like.html` is an additional standalone synthetic page for
adapter work. To serve it without the main demo, run a local static server from
`extension/fixtures` on port 4173. The extension will still be restricted to
that local origin.

## Test the adapter

```bash
node --test extension/tests/*.test.mjs
```

The fixture and tests cover Workday-like `data-automation-id` labels, current
form required-state detection, exact verified eligibility matching,
candidate-approved question matching, native choice matching, always-manual
categories, and routine-value validation.

## Future real-site design

Real employer sites are intentionally unsupported in this version. A future
opt-in integration would need a separately reviewed permission screen using
Chrome's `scripting` permission plus an optional declaration for one exact
tenant (for example `https://tenant.wd5.myworkdayjobs.com/*`). The popup would
request only that current tenant pattern, create a visible per-origin consent
record, and require a fresh runtime approval before injecting a content script.
It would also need a session-only draft bridge (typically
`chrome.storage.session`) to transfer the candidate-approved local FillPlan
without granting the Workday page access to localhost storage.

None of those host or storage permissions are present in this manifest today.
Simply adding a Workday match pattern or broad host permission would not be an
acceptable upgrade path.

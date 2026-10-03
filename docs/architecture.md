# CareerOps architecture

CareerOps is a local-first, résumé-to-form helper. The active product path is
intentionally small: a candidate pastes résumé text, confirms reusable
defaults, handles the few questions that need input, and creates a short-lived
reviewed FillPlan for a controlled local form.

It runs as static HTML, CSS, and browser-native ES modules. Node.js only serves
the files locally and runs checks. There is no backend, database, analytics
service, remote résumé parser, or ChatGPT/API integration in this demo.

## Design goals

- Make reusable facts easy to review before they reach a form.
- Extract only clear, low-risk résumé details; leave uncertain facts blank.
- Let the currently rendered form determine which questions require attention.
- Keep sensitive, changing, legal, and company-specific decisions with the
  candidate.
- Make browser assistance local-only, scoped, previewed, and incapable of
  submitting a form.

## Runtime map

```text
                         ┌─────────────────────┐
                         │     index.html      │
                         │  styles + simple.css│
                         └─────────┬───────────┘
                                   │
                             src/app.js
                  (local state, intake, and FillPlan UI)
                                   │
                  ┌────────────────┴────────────────┐
                  │          src/domain/             │
                  │  pure, deterministic ES modules  │
                  └───────┬───────────┬──────────────┘
                          │           │
              resume-intake.js  form-answer-resolver.js
                          │           │
                          └──── clarification-queue.js
                                      │
                              localStorage FillPlan

fake-ats.html ──► src/fake-ats.js
workday-demo.html ──► src/workday-demo.js
  controlled local form surfaces; no employer receives data

extension/
  Manifest V3 browser companion, local fixtures only
  ├── popup: user-triggered Preview → select → Fill
  ├── background: origin validation and short-lived plan memory
  └── content: current-scope scan and narrow native field writes

scripts/dev-server.mjs
  Node-only static development server
```

## Active module responsibilities

| Area | Files | Responsibility |
| --- | --- | --- |
| Application shell | `index.html`, `styles.css`, `src/simple.css`, `src/app.js` | Renders the résumé-first flow, keeps candidate state in browser memory, creates a local five-minute FillPlan, and never grants browser authority by itself. |
| Resume intake | `src/domain/resume-intake.js` | Deterministically extracts only clear name, contact, public-link, and scoped education hints. It intentionally does not derive authorization, sponsorship, compensation, demographics, legal answers, or identity facts. |
| Form-answer resolution | `src/domain/form-answer-resolver.js` | Normalizes a question and classifies it into a bounded set of routine, verified, candidate-input, review-only, or unsupported outcomes. It returns advice and evidence—not permission to write a form. |
| Clarification queue | `src/domain/clarification-queue.js` | Turns unresolved questions that are currently present into either a candidate-input task or a protected manual step. It never generates an answer. |
| Controlled targets | `fake-ats.html`, `src/fake-ats.js`, `workday-demo.html`, `src/workday-demo.*` | Exercise the resolver and FillPlan against fictional application forms. `workday-demo.html` resembles common markup only; it is not Workday access. |
| Browser companion | `extension/` | Performs a user-triggered Preview → select → Fill flow on the local fixtures only. It re-scans the visible application scope before filling and has no submission path. |
| Tests | `tests/domain/`, `extension/tests/` | Verify deterministic extraction, field classification, clarification behavior, plan validation, and local-only fill safety. |

The repository also retains pure job-normalization, matching, drafting, and
application-state modules from the broader portfolio demo. They remain
testable examples, but the résumé-first screen does not use them to search for
jobs, rank applications, or submit anything.

## Main data flow

1. The candidate pastes résumé text or chooses a local text/Markdown file.
   `resume-intake.js` analyzes it in the browser and returns only conservative
   reusable hints.
2. `src/app.js` copies unambiguous hints into editable defaults only when the
   candidate has not already supplied that field. The candidate reviews and can
   change every default.
3. The app resolves the synthetic fixture's visible questions using
   `form-answer-resolver.js`. In a browser-assisted local fill, `content.js`
   independently inspects the actual currently rendered controls; the fixture
   list is never a promise that every form has the same questions.
4. `clarification-queue.js` separates missing or company-specific candidate
   input from protected manual fields. A company response may enter a plan only
   after the candidate writes and explicitly approves the exact response.
5. The app writes a `careerops.activeDraft` FillPlan to localStorage. It holds
   routine fields, verified boolean eligibility answers, approved exact
   questions, hard review-only blockers, and an expiry five minutes in the
   future.
6. The local browser companion requires a popup action, creates a one-time
   preview from one unambiguous visible application-like form scope, lets the
   candidate deselect entries, and fills only supported selected native
   controls. It stops before submit.

## FillPlan boundaries

The plan is a narrow data contract, not a general résumé export:

| Plan area | Source | Rules |
| --- | --- | --- |
| `fields` | Editable routine defaults | Only non-sensitive, compatible profile fields that the resolver marks eligible. |
| `verifiedQuestions` | Explicit candidate confirmation | Work authorization and sponsorship only, carried as a boolean and matched to an exact current question/control. |
| `approvedQuestions` | Candidate-authored response | Only a non-sensitive, non-conditional company or unknown prompt after explicit approval for that exact normalized question. |
| `reviewOnly` | Resolver and queue | Hard block for protected, changing, unknown, unmatched, conditional, or otherwise manual questions. |

Missing, malformed, expired, conflicting, or non-exact data fails closed. The
browser companion neither writes a value supplied by a page nor converts a
piece of résumé text into a protected answer.

## Workday-style mapping versus real Workday access

The resolver recognizes patterns often found in Workday-like forms by combining
visible labels, accessible labels, IDs/names, group context, type, and native
options. This is a classification feature for the fictional fixture. It is not
a claim that every Workday tenant is supported and it does not authorize a
real Workday origin.

At present, the extension's allowlist is limited to `localhost` and
`127.0.0.1`. It has no real Workday host pattern, network transport, credential
storage, login handling, upload flow, or submit interaction. Any real-site
adapter would require a separately approved, exact-host permission design,
security review, and terms-of-use review; it cannot be enabled by a generic
"Workday" switch.

## Deliberate boundaries

CareerOps does not include a job crawler, job-search integration, account
system, autonomous worker, API-backed ChatGPT workflow, PDF/DOCX upload path,
or application-submission service. Each would materially change data handling
and authority. If one is added, it needs an explicit user-facing consent model,
a narrow adapter contract, tests for failure-closed behavior, and preservation
of the no-login/no-submit/manual-sensitive-field boundaries.

Read [safety.md](safety.md) for the user-authority model and
[evaluation.md](evaluation.md) for the test protocol.

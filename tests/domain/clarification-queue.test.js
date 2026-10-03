import assert from "node:assert/strict";
import test from "node:test";

import {
  ClarificationDisposition,
  ClarificationKind,
  FormAnswerBucket,
  QuestionAction,
  QuestionCategory,
  QuestionKind,
  buildClarificationQueue,
  resolveFormQuestions,
} from "../../src/domain/index.js";

const profile = Object.freeze({
  id: "candidate-ada",
  email: "ada@example.test",
  salaryExpectation: "$130,000 base salary",
  startDate: "2026-11-02",
  // This deliberately is not a verified boolean. It may be useful context for
  // the candidate, but it must remain a clarification task.
  workAuthorization: Object.freeze({ status: "Yes" }),
});

test("builds a current-form clarification queue and omits resolved reusable fields", () => {
  const resolutions = resolveFormQuestions(profile, [
    { id: "email", label: "Email address", required: true },
    { id: "address", label: "Address line 1", required: true },
    {
      id: "work-auth",
      label: "Are you legally authorized to work in the United States?",
      options: ["Yes", "No"],
      required: true,
    },
    { id: "salary", label: "Desired base salary", required: true },
    { id: "start", label: "Earliest available start date" },
    { id: "why-role", label: "Why are you interested in this role?", required: true },
    { id: "former-employer", label: "Former employer name" },
    { id: "conditional", label: "If yes, identify your former employer", conditional: true },
    { id: "attestation", label: "I certify that the information is accurate", inputType: "checkbox", required: true },
    { id: "demographic", label: "Voluntary gender self-identification" },
  ]);

  const queue = buildClarificationQueue(profile, resolutions);
  const byFormId = new Map(queue.tasks.map((task) => [task.form.id, task]));

  assert.equal(byFormId.has("email"), false);
  assert.deepEqual(queue.needsInput.map((task) => task.kind), [
    ClarificationKind.MISSING_PROFILE_DATA,
    ClarificationKind.UNVERIFIED_ELIGIBILITY,
    ClarificationKind.COMPENSATION,
    ClarificationKind.AVAILABILITY,
    ClarificationKind.COMPANY_TAILORED,
    ClarificationKind.UNKNOWN,
    ClarificationKind.CONDITIONAL,
  ]);
  assert.deepEqual(queue.manualOnly.map((task) => task.kind), [
    ClarificationKind.PROTECTED,
    ClarificationKind.PROTECTED,
  ]);
  assert.deepEqual(queue.counts, {
    total: 9,
    needsInput: 7,
    manualOnly: 2,
    required: 5,
  });

  const salary = byFormId.get("salary");
  assert.equal(salary.disposition, ClarificationDisposition.NEEDS_INPUT);
  assert.equal(salary.existingValue, "$130,000 base salary");
  assert.equal(salary.canAutoFill, false);
  assert.equal(salary.required, true);
  assert.equal(salary.form.required, true);

  const eligibility = byFormId.get("work-auth");
  assert.equal(eligibility.kind, ClarificationKind.UNVERIFIED_ELIGIBILITY);
  assert.equal(eligibility.existingValue, "Yes");
  assert.deepEqual(eligibility.form.options, [
    { label: "Yes", value: "Yes" },
    { label: "No", value: "No" },
  ]);

  const protectedTask = byFormId.get("attestation");
  assert.equal(protectedTask.disposition, ClarificationDisposition.MANUAL_ONLY);
  assert.equal(protectedTask.existingValue, null);
  assert.equal(protectedTask.canAutoFill, false);
  assert.equal(protectedTask.required, true);
  assert.ok(Object.isFrozen(queue));
  assert.ok(Object.isFrozen(protectedTask.form));
});

test("keeps protected controls manual even when a malformed resolution contains a value", () => {
  const sourceResolution = {
    question: {
      id: "consent",
      label: "I agree to receive recruiting updates",
      inputType: "checkbox",
      required: true,
      present: true,
    },
    kind: QuestionKind.CONSENT,
    category: QuestionCategory.HARD_STOP,
    action: QuestionAction.MANUAL_ONLY,
    planBucket: FormAnswerBucket.REVIEW_ONLY,
    required: true,
    present: true,
    manualOnly: true,
    value: "true",
    evidenceIds: ["profile:candidate-ada:marketingConsent"],
    reason: "Consent choices require direct action.",
  };

  const before = structuredClone(sourceResolution);
  const queue = buildClarificationQueue(profile, [sourceResolution]);
  const task = queue.tasks[0];

  assert.deepEqual(sourceResolution, before);
  assert.equal(task.disposition, ClarificationDisposition.MANUAL_ONLY);
  assert.equal(task.kind, ClarificationKind.PROTECTED);
  assert.equal(task.existingValue, null);
  assert.deepEqual(task.evidenceIds, []);
  assert.equal(task.canAutoFill, false);
});

test("does not queue absent controls and treats an unverified eligibility record as input even if it claims auto-fill", () => {
  const queue = buildClarificationQueue(profile, [
    {
      question: { id: "hidden-salary", label: "Desired salary", present: false },
      kind: QuestionKind.SALARY,
      category: QuestionCategory.REUSABLE_PREFERENCE,
      action: QuestionAction.REQUEST_INPUT,
      // Resolution metadata can lag a DOM update; the current question's
      // explicit absent state must win.
      present: true,
      value: "$140,000",
    },
    {
      question: {
        id: "sponsorship",
        label: "Will you require sponsorship?",
        required: true,
        options: ["Yes", "No"],
      },
      kind: QuestionKind.SPONSORSHIP,
      category: QuestionCategory.VERIFIED_ELIGIBILITY,
      action: QuestionAction.VERIFIED_AUTO_FILL,
      planBucket: FormAnswerBucket.VERIFIED_QUESTIONS,
      required: true,
      present: true,
      autoFillEligible: true,
      verified: false,
      value: "No",
      evidenceIds: ["profile:candidate-ada:requiresSponsorship"],
    },
    {
      question: { id: "verified-work-auth", label: "Authorized to work?" },
      kind: QuestionKind.WORK_AUTHORIZATION,
      category: QuestionCategory.VERIFIED_ELIGIBILITY,
      action: QuestionAction.VERIFIED_AUTO_FILL,
      planBucket: FormAnswerBucket.VERIFIED_QUESTIONS,
      present: true,
      autoFillEligible: true,
      verified: true,
      value: "Yes",
    },
  ]);

  assert.equal(queue.tasks.length, 1);
  assert.equal(queue.tasks[0].form.id, "sponsorship");
  assert.equal(queue.tasks[0].kind, ClarificationKind.UNVERIFIED_ELIGIBILITY);
  assert.equal(queue.tasks[0].disposition, ClarificationDisposition.NEEDS_INPUT);
  assert.equal(queue.tasks[0].existingValue, "No");
  assert.equal(queue.tasks[0].required, true);
});

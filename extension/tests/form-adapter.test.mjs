import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadAdapter() {
  const context = { URL, globalThis: {} };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL("../form-adapter.js", import.meta.url), "utf8"), context, { filename: "form-adapter.js" });
  return context.globalThis.CareerOpsFormAdapter;
}

const adapter = loadAdapter();

test("classifies Workday-like automation metadata without a brittle DOM selector", () => {
  const result = adapter.classifyMetadata({
    tagName: "INPUT",
    type: "text",
    label: "First Name",
    name: "legalNameSection_firstName",
    autocomplete: "given-name",
    automationId: "textInput"
  });

  assert.equal(result.kind, "text");
  assert.equal(result.canonicalKey, "firstName");
  assert.equal(result.adapter, "workday-like");
  assert.equal(result.safe, true);
});

test("recognizes reusable eligibility questions without treating them as a blanket hard block", () => {
  const authorization = adapter.classifyMetadata({
    tagName: "SELECT",
    label: "Are you authorized to work in the United States?",
    name: "workAuthorization"
  });
  const password = adapter.classifyMetadata({
    tagName: "INPUT",
    type: "password",
    label: "Account password",
    autocomplete: "current-password"
  });
  const describedAuthorization = adapter.classifyMetadata({
    tagName: "INPUT",
    type: "text",
    label: "Answer",
    describedBy: "Please state your work authorization status."
  });

  assert.equal(authorization.kind, "select");
  assert.equal(authorization.category, "eligibility");
  assert.equal(authorization.eligibilityKey, "workAuthorization");
  assert.equal(authorization.safe, true);
  assert.equal(describedAuthorization.category, "eligibility");
  assert.equal(describedAuthorization.safe, true);
  assert.equal(password.safe, false);
  assert.match(password.reason, /Credentials/);
});

test("keeps agreements, disclosures, documents, and identity controls manual regardless of a plan", () => {
  const agreement = adapter.classifyMetadata({
    tagName: "INPUT",
    type: "checkbox",
    label: "I agree to the legal terms and conditions"
  });
  const demographic = adapter.classifyMetadata({
    tagName: "SELECT",
    label: "Voluntary self-identification: gender"
  });
  const upload = adapter.classifyMetadata({
    tagName: "INPUT",
    type: "file",
    label: "Upload your résumé"
  });

  for (const result of [agreement, demographic, upload]) {
    assert.equal(result.category, "manual");
    assert.equal(result.safe, false);
    assert.ok(result.reason);
  }
});

test("keeps every checkbox and consequential prompt manual", () => {
  const controls = [
    { tagName: "INPUT", type: "checkbox", label: "I agree to receive recruiting updates" },
    { tagName: "INPUT", type: "checkbox", label: "Keep me signed in on this device" },
    { tagName: "INPUT", type: "text", label: "Desired base salary" },
    { tagName: "INPUT", type: "text", label: "Desired hourly rate" },
    { tagName: "INPUT", type: "text", label: "Earliest available start date" },
    { tagName: "INPUT", type: "text", label: "Name", name: "legalName" },
    { tagName: "SELECT", label: "What is your sex?" },
    { tagName: "INPUT", type: "text", label: "Passport number" },
    { tagName: "SELECT", label: "Age" },
    { tagName: "SELECT", label: "Marital status" },
    { tagName: "INPUT", type: "text", label: "Privacy notice acknowledgement" },
    { tagName: "INPUT", type: "checkbox", label: "Authorization to contact former employers" },
    { tagName: "INPUT", type: "text", label: "I accept the release and waiver" }
  ];

  for (const metadata of controls) {
    const result = adapter.classifyMetadata(metadata);
    assert.equal(result.category, "manual");
    assert.equal(result.safe, false);
    assert.ok(result.reason);
  }
});

test("requires an exact explicit approved-question match and rejects conflicts", () => {
  const descriptor = {
    question: "How did you hear about us?",
    id: "source",
    name: "applicationSource",
    automationId: "questionnaireQuestion"
  };
  const matching = [{ approved: true, question: "How did you hear about us?", value: "LinkedIn" }];
  const conflicting = [
    { approved: true, id: "source", value: "LinkedIn" },
    { approved: true, question: "How did you hear about us?", value: "Employee referral" }
  ];
  const normalized = adapter.normalizeApprovedQuestion(matching[0]);

  assert.equal(adapter.findApprovedQuestion(descriptor, matching), "LinkedIn");
  assert.equal(normalized.approved, true);
  assert.equal(adapter.findApprovedQuestion(descriptor, [normalized]), "LinkedIn");
  assert.equal(adapter.findApprovedQuestion(descriptor, [{ approved: true, question: "Where did you find us?", value: "LinkedIn" }]), null);
  assert.equal(adapter.findApprovedQuestion({
    ...descriptor,
    question: "How did you hear about our company?"
  }, [{
    approved: true,
    id: "source",
    question: "How did you hear about us?",
    value: "LinkedIn"
  }]), null);
  assert.equal(adapter.findApprovedQuestion(descriptor, conflicting), null);
});

test("matches native select and radio choices only by an exact visible label or value", () => {
  const options = [
    { value: "linkedin", label: "LinkedIn" },
    { value: "referral", label: "Employee referral" }
  ];

  assert.deepEqual(adapter.matchingOption(options, "LinkedIn"), options[0]);
  assert.equal(adapter.matchingOption(options, "linked"), null);
  assert.deepEqual(adapter.matchingOption([{ value: "yes", label: "Yes" }, { value: "no", label: "No" }], true), { value: "yes", label: "Yes" });
  assert.deepEqual(adapter.matchingOption([{ value: "Y", label: "Y" }, { value: "N", label: "N" }], false), { value: "N", label: "N" });
  assert.equal(adapter.booleanValue(true), true);
  assert.equal(adapter.booleanValue("yes"), null);
});

test("requires exact verified-question matchers for reusable eligibility answers", () => {
  const descriptor = {
    question: "Are you authorized to work in the United States?",
    id: "workAuthorization",
    name: "workAuthorization",
    automationId: "questionItem"
  };
  const verified = [{
    verified: true,
    category: "eligibility",
    id: "workAuthorization",
    question: "Are you authorized to work in the United States?",
    value: true
  }];

  assert.equal(adapter.findVerifiedQuestion(descriptor, verified, "eligibility"), true);
  assert.equal(adapter.findVerifiedQuestion(descriptor, verified, "profile"), null);
  assert.equal(adapter.findVerifiedQuestion(descriptor, [{
    verified: true,
    category: "eligibility",
    question: "Are you eligible to work?",
    value: true
  }], "eligibility"), null);
  assert.equal(adapter.findVerifiedQuestion(descriptor, [{
    verified: true,
    category: "eligibility",
    id: "workAuthorization",
    question: "Are you authorized to work in the United States?",
    value: "Yes"
  }], "eligibility"), null);
  assert.equal(adapter.findVerifiedQuestion({
    ...descriptor,
    question: "Are you authorized to work in Canada?"
  }, verified, "eligibility"), null);
  assert.equal(adapter.findVerifiedQuestion(descriptor, [
    ...verified,
    { verified: true, category: "eligibility", id: "workAuthorization", value: false }
  ], "eligibility"), null);
});

test("identifies required state from the native required or ARIA-required metadata on the current control", () => {
  assert.equal(adapter.isRequiredMetadata({ required: true }), true);
  assert.equal(adapter.isRequiredMetadata({ ariaRequired: "true" }), true);
  assert.equal(adapter.isRequiredMetadata({ ariaRequired: "false" }), false);
  assert.equal(adapter.isRequiredMetadata({}), false);
});

test("validates routine contact values without accepting unsafe URL schemes", () => {
  assert.equal(adapter.validateRoutineValue("email", "person@example.test"), "person@example.test");
  assert.equal(adapter.validateRoutineValue("website", "javascript:alert(1)"), null);
  assert.equal(adapter.validateRoutineValue("phone", "not-a-phone"), null);
});

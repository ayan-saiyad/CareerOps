import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadBackground() {
  const chrome = {
    runtime: {
      id: "test-extension-id",
      onMessage: { addListener() {} }
    },
    tabs: {}
  };
  const context = { chrome, URL, Date, console };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL("../background.js", import.meta.url), "utf8"), context, { filename: "background.js" });
  return context;
}

const background = loadBackground();

test("session draft transfer rejects absent and expired FillPlan expiries", () => {
  assert.equal(background.sanitizeSessionDraft({ version: 1, values: { firstName: "Taylor" } }), null);
  assert.equal(background.sanitizeSessionDraft({
    version: 1,
    expiresAt: Date.now() - 1,
    values: { firstName: "Taylor" }
  }), null);
});

test("session draft keeps reusable fields, exact approved questions, and explicitly verified standard answers", () => {
  const draft = background.sanitizeSessionDraft({
    version: 1,
    expiresAt: Date.now() + 60_000,
    values: {
      firstName: "Taylor",
      salary: "100000",
      email: "taylor@example.test"
    },
    approvedQuestions: [
      { approved: true, id: "degree", question: "Degree", value: "bachelors" },
      { approved: false, id: "salary", question: "Desired salary", value: "100000" }
    ],
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
        category: "other",
        id: "ignored",
        question: "Ignored",
        value: "No"
      }
    ],
    reviewOnly: [{ key: "workAuthorization", id: "workauthorization", question: "Work authorization" }]
  });

  assert.deepEqual({ ...draft.values }, { firstName: "Taylor", email: "taylor@example.test" });
  assert.deepEqual(JSON.parse(JSON.stringify(draft.approvedQuestions)), [
    { approved: true, id: "degree", question: "Degree", value: "bachelors" }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(draft.verifiedQuestions)), [
    {
      verified: true,
      category: "eligibility",
      id: "workAuthorization",
      question: "Are you authorized to work in the United States?",
      value: true
    }
  ]);
  assert.equal(draft.reviewOnly.length, 1);
});

test("session draft can carry only a verified standard answer but rejects unverified records", () => {
  const expiry = Date.now() + 60_000;
  const verifiedOnly = background.sanitizeSessionDraft({
    version: 1,
    expiresAt: expiry,
    verifiedQuestions: [{
      verified: true,
      category: "profile",
      id: "state",
      question: "State / Province",
      value: "Texas"
    }]
  });
  const unverifiedOnly = background.sanitizeSessionDraft({
    version: 1,
    expiresAt: expiry,
    verifiedQuestions: [{
      verified: false,
      category: "profile",
      id: "state",
      value: "Texas"
    }]
  });

  assert.equal(verifiedOnly.verifiedQuestions.length, 1);
  assert.equal(unverifiedOnly, null);
});

test("session draft rejects a string as a verified eligibility answer", () => {
  const draft = background.sanitizeSessionDraft({
    version: 1,
    expiresAt: Date.now() + 60_000,
    verifiedQuestions: [{
      verified: true,
      category: "eligibility",
      id: "workAuthorization",
      question: "Are you authorized to work in the United States?",
      value: "Yes"
    }]
  });

  assert.equal(draft, null);
});

test("preview plans preserve required/manual reasons but never make them fillable", () => {
  const url = "http://localhost:4173/workday-demo.html";
  const plan = background.sanitizePlan({
    version: 2,
    nonce: "0123456789abcdef",
    pageUrl: url,
    source: "local-draft",
    detectedCount: 2,
    writableCount: 1,
    requiredCount: 2,
    manualCount: 1,
    blockedCount: 1,
    fields: [],
    manualFields: [{
      key: "terms",
      kind: "checkbox",
      label: "Legal terms",
      question: "I agree to the legal terms and conditions.",
      required: true,
      category: "manual",
      reason: "Legal agreements, consent, attestations, and signatures are always manual.",
      adapter: "generic"
    }]
  }, url);

  assert.equal(plan.fields.length, 0);
  assert.equal(plan.requiredCount, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.manualFields)), [{
    key: "terms",
    kind: "checkbox",
    label: "Legal terms",
    question: "I agree to the legal terms and conditions.",
    category: "manual",
    reason: "Legal agreements, consent, attestations, and signatures are always manual.",
    adapter: "generic",
    required: true
  }]);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  FormAnswerBucket,
  QuestionAction,
  QuestionCategory,
  QuestionKind,
  classifyFormQuestion,
  normalizeFormQuestion,
  resolveFormQuestion,
  resolveFormQuestions,
  resolvePresentFormQuestions,
} from "../../src/domain/index.js";

const profile = Object.freeze({
  id: "candidate-ada",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.test",
  phone: "+1 555 010 0101",
  location: "Chicago, IL",
  city: "Chicago",
  state: "IL",
  country: "United States",
  links: Object.freeze({
    linkedin: "https://www.linkedin.com/in/ada-lovelace",
    github: "https://github.com/ada-lovelace",
    website: "https://ada.example.test",
  }),
  education: Object.freeze([
    Object.freeze({
      id: "edu-northwestern",
      school: "Northwestern University",
      degree: "B.S.",
      fieldOfStudy: "Computer Science",
      graduationDate: "2024-06-15",
      gpa: "3.8",
    }),
  ]),
  workAuthorization: Object.freeze({ authorized: true }),
  requiresSponsorship: false,
  salaryExpectation: "$130,000 base salary",
  startDate: "2026-11-02",
  approvedAnswers: Object.freeze([
    Object.freeze({
      id: "answer-relocation",
      question: "Are you willing to relocate?",
      answer: "Yes, for the right opportunity.",
    }),
  ]),
  demographics: Object.freeze({ gender: "Nonbinary" }),
});

test("normalizes labels, field names, and context before classifying a form question", () => {
  const question = normalizeFormQuestion({
    label: "Will you now or in the future require sponsorship?",
    name: "candidate[requiresSponsorship]",
    context: ["Employment eligibility", { title: "United States" }],
    options: ["Yes", "No"],
  });

  assert.match(question.canonical, /require sponsorship/);
  assert.match(question.canonical, /requires sponsorship/);
  assert.match(question.canonical, /employment eligibility/);
  assert.deepEqual(question.options.map((option) => option.value), ["Yes", "No"]);

  const classification = classifyFormQuestion(question);
  assert.equal(classification.kind, QuestionKind.SPONSORSHIP);
  assert.equal(classification.category, QuestionCategory.VERIFIED_ELIGIBILITY);
  assert.equal(classification.action, QuestionAction.VERIFIED_AUTO_FILL);
  assert.equal(classification.planBucket, FormAnswerBucket.VERIFIED_QUESTIONS);
  assert.equal(classification.sensitive, false);
  assert.equal(classification.unsupported, false);
});

test("resolves high-confidence contact, location, and social fields from direct profile evidence", () => {
  const resolutions = resolveFormQuestions(profile, [
    { label: "First name", name: "firstName" },
    { label: "Email address" },
    { label: "Current city", name: "city" },
    { label: "LinkedIn profile URL", name: "linkedinUrl" },
    { label: "GitHub", name: "github" },
  ]);

  assert.equal(resolutions[0].value, "Ada");
  assert.equal(resolutions[1].value, "ada@example.test");
  assert.equal(resolutions[2].value, "Chicago");
  assert.equal(resolutions[3].value, "https://www.linkedin.com/in/ada-lovelace");
  assert.equal(resolutions[4].value, "https://github.com/ada-lovelace");
  assert.ok(resolutions.every((item) => item.confidence >= 0.97));
  assert.ok(resolutions.every((item) => item.evidenceIds[0].startsWith("profile:candidate-ada:")));
  assert.ok(resolutions.every((item) => item.reviewRequired === false && item.unsupported === false));
  assert.ok(resolutions.every((item) => item.action === QuestionAction.AUTO_FILL && item.planBucket === FormAnswerBucket.FIELDS));
});

test("auto-fills address fields only when the profile contains those explicit address values", () => {
  const profileWithAddress = {
    ...profile,
    address: {
      line1: "12 Analytical Engine Way",
      line2: "Suite 5",
      postalCode: "60601",
    },
  };
  const resolutions = resolveFormQuestions(profileWithAddress, [
    { label: "Address Line 1", required: true },
    { label: "Address Line 2" },
    { label: "Postal code", required: true },
  ]);

  assert.deepEqual(resolutions.map((item) => item.value), [
    "12 Analytical Engine Way",
    "Suite 5",
    "60601",
  ]);
  assert.ok(resolutions.every((item) => item.action === QuestionAction.AUTO_FILL));
  assert.ok(resolutions.every((item) => item.evidenceIds[0].startsWith("profile:candidate-ada:address.")));
});

test("returns education evidence and makes multiple matching records review-only", () => {
  const school = resolveFormQuestion(profile, { label: "University / College" });
  const degree = resolveFormQuestion(profile, { label: "Degree earned" });

  assert.equal(school.kind, QuestionKind.EDUCATION_SCHOOL);
  assert.equal(school.value, "Northwestern University");
  assert.deepEqual(school.evidenceIds, ["edu-northwestern"]);
  assert.equal(degree.value, "B.S.");

  const withTwoSchools = {
    ...profile,
    education: [
      ...profile.education,
      { id: "edu-chicago", school: "University of Chicago", degree: "M.S." },
    ],
  };
  const ambiguous = resolveFormQuestion(withTwoSchools, { label: "School attended" });

  assert.equal(ambiguous.value, null);
  assert.equal(ambiguous.candidates.length, 2);
  assert.equal(ambiguous.reviewRequired, true);
  assert.equal(ambiguous.unsupported, false);
});

test("maps verified authorization and sponsorship booleans to compatible yes/no options for verified automation", () => {
  const authorization = resolveFormQuestion(profile, {
    label: "Are you legally authorized to work in the United States?",
    options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }],
  });
  const sponsorship = resolveFormQuestion(profile, {
    label: "Will you now or in the future require sponsorship?",
    options: ["Yes", "No"],
  });

  assert.equal(authorization.value, "yes");
  assert.equal(authorization.kind, QuestionKind.WORK_AUTHORIZATION);
  assert.equal(authorization.category, QuestionCategory.VERIFIED_ELIGIBILITY);
  assert.equal(authorization.action, QuestionAction.VERIFIED_AUTO_FILL);
  assert.equal(authorization.planBucket, FormAnswerBucket.VERIFIED_QUESTIONS);
  assert.equal(authorization.verified, true);
  assert.equal(authorization.autoFillEligible, true);
  assert.equal(authorization.sensitive, false);
  assert.equal(authorization.reviewRequired, false);
  assert.equal(sponsorship.value, "No");
  assert.equal(sponsorship.kind, QuestionKind.SPONSORSHIP);
  assert.equal(sponsorship.action, QuestionAction.VERIFIED_AUTO_FILL);
  assert.equal(sponsorship.verified, true);
  assert.match(sponsorship.candidates[0].note, /Verified/);
});

test("keeps salary and start-date answers evidence-grounded and review-required", () => {
  const salary = resolveFormQuestion(profile, { label: "What are your salary expectations?" });
  const startDate = resolveFormQuestion(profile, { label: "Earliest available start date" });

  assert.equal(salary.value, "$130,000 base salary");
  assert.equal(salary.sensitive, true);
  assert.equal(salary.reviewRequired, true);
  assert.equal(salary.action, QuestionAction.REQUEST_INPUT);
  assert.equal(salary.planBucket, FormAnswerBucket.PROMPT);
  assert.equal(startDate.value, "2026-11-02");
  assert.equal(startDate.sensitive, false);
  assert.equal(startDate.reviewRequired, true);
  assert.equal(startDate.action, QuestionAction.REQUEST_INPUT);
  assert.ok(startDate.evidenceIds.includes("profile:candidate-ada:startDate"));
});

test("never supplies demographic, legal, unknown, or missing-profile answers", () => {
  const demographic = resolveFormQuestion(profile, { label: "Voluntary self-identification: gender" });
  const legal = resolveFormQuestion(profile, { label: "Social Security Number" });
  const missingGpa = resolveFormQuestion({ id: "empty" }, { label: "GPA" });
  const unknown = resolveFormQuestion(profile, { label: "Describe your most meaningful project" });

  for (const result of [demographic, legal, missingGpa, unknown]) {
    assert.equal(result.value, null);
    assert.equal(result.candidates.length, 0);
    assert.equal(result.unsupported, true);
    assert.equal(result.reviewRequired, true);
  }
  assert.equal(demographic.kind, QuestionKind.DEMOGRAPHIC);
  assert.equal(demographic.sensitive, true);
  assert.equal(legal.kind, QuestionKind.SENSITIVE_LEGAL);
});

test("uses only an exact approved-answer-library match for an otherwise unknown question", () => {
  const approved = resolveFormQuestion(profile, { label: "Are you willing to relocate?", name: "candidateAnswer" });
  const nearMiss = resolveFormQuestion(profile, { label: "Would you relocate for this role?" });

  assert.equal(approved.kind, QuestionKind.APPROVED_ANSWER);
  assert.equal(approved.value, "Yes, for the right opportunity.");
  assert.deepEqual(approved.evidenceIds, ["answer-relocation"]);
  assert.equal(approved.category, QuestionCategory.APPROVED_RESPONSE);
  assert.equal(approved.action, QuestionAction.AUTO_FILL);
  assert.equal(approved.planBucket, FormAnswerBucket.APPROVED_QUESTIONS);
  assert.equal(approved.reviewRequired, false);
  assert.equal(approved.unsupported, false);
  assert.equal(nearMiss.value, null);
  assert.equal(nearMiss.unsupported, true);
});

test("matches an approved free-text answer against the visible label instead of a technical field name", () => {
  const withRoleAnswer = {
    ...profile,
    approvedAnswers: [{
      id: "answer-why-role",
      question: "Why are you interested in this role?",
      answer: "The platform work is a strong match for my TypeScript and reliability experience.",
    }],
  };

  const resolution = resolveFormQuestion(withRoleAnswer, {
    label: "Why are you interested in this role?",
    name: "whyThisRole",
  });

  assert.equal(resolution.kind, QuestionKind.APPROVED_ANSWER);
  assert.equal(resolution.value, "The platform work is a strong match for my TypeScript and reliability experience.");
  assert.equal(resolution.action, QuestionAction.AUTO_FILL);
  assert.equal(resolution.planBucket, FormAnswerBucket.APPROVED_QUESTIONS);
  assert.equal(resolution.reviewRequired, false);
  assert.equal(resolution.unsupported, false);
});

test("does not infer a profile field from a similarly spelled technical identifier or a bare name word", () => {
  const relocation = resolveFormQuestion(profile, {
    label: "Would you relocate for this role?",
    name: "relocationAnswer",
  });
  const formerEmployer = resolveFormQuestion(profile, {
    label: "Former employer name",
    name: "formerEmployerName",
  });
  const school = resolveFormQuestion(profile, {
    label: "School name",
    name: "schoolName",
  });

  assert.equal(relocation.kind, QuestionKind.UNKNOWN);
  assert.equal(relocation.value, null);
  assert.equal(formerEmployer.kind, QuestionKind.UNKNOWN);
  assert.equal(formerEmployer.value, null);
  assert.equal(school.kind, QuestionKind.EDUCATION_SCHOOL);
  assert.equal(school.value, "Northwestern University");
});

test("does not let an approved-answer library weaken a sensitive question classification", () => {
  const libraryOnlyProfile = {
    id: "candidate-library-only",
    approvedAnswers: [
      { id: "answer-work-auth", question: "Are you legally authorized to work in the United States?", answer: "Yes" },
      { id: "answer-salary", question: "What are your salary expectations?", answer: "$130,000" },
    ],
  };

  const authorization = resolveFormQuestion(libraryOnlyProfile, "Are you legally authorized to work in the United States?");
  const salary = resolveFormQuestion(libraryOnlyProfile, "What are your salary expectations?");

  assert.equal(authorization.kind, QuestionKind.WORK_AUTHORIZATION);
  assert.equal(authorization.value, null);
  assert.equal(authorization.action, QuestionAction.REQUEST_INPUT);
  assert.equal(authorization.verified, false);
  assert.equal(authorization.sensitive, false);
  assert.equal(salary.kind, QuestionKind.SALARY);
  assert.equal(salary.value, null);
  assert.equal(salary.sensitive, true);
});

test("does not offer a value when the profile answer does not exactly fit a constrained select", () => {
  const mismatchedSelect = resolveFormQuestion(profile, {
    label: "Current city",
    options: ["Austin", "New York"],
  });

  assert.equal(mismatchedSelect.value, null);
  assert.equal(mismatchedSelect.unsupported, true);
  assert.equal(mismatchedSelect.candidates.length, 0);
});

test("preserves required and conditional metadata from the form rather than assuming a fixed application schema", () => {
  const normalized = normalizeFormQuestion({
    label: "Email address",
    name: "email",
    required: "true",
    conditional: false,
  });
  const resolution = resolveFormQuestion(profile, normalized);
  const classification = classifyFormQuestion(normalized);

  assert.equal(normalized.required, true);
  assert.equal(normalized.present, true);
  assert.equal(normalized.conditional, false);
  assert.equal(classification.required, true);
  assert.equal(resolution.required, true);
  assert.equal(resolution.present, true);
  assert.equal(resolution.action, QuestionAction.AUTO_FILL);
});

test("keeps legal agreements, attestations, consent, and signatures as manual hard stops", () => {
  const questions = [
    { label: "I agree to the Terms and Conditions", inputType: "checkbox", required: true },
    { label: "I certify that the information in this application is accurate", inputType: "checkbox", required: true },
    { label: "I consent to a background check", inputType: "checkbox", required: true },
    { label: "Type your full name as your signature", inputType: "text", required: true },
  ];
  const resolutions = resolveFormQuestions(profile, questions);

  assert.deepEqual(resolutions.map((item) => item.kind), [
    QuestionKind.LEGAL_AGREEMENT,
    QuestionKind.ATTESTATION,
    QuestionKind.CONSENT,
    QuestionKind.SIGNATURE,
  ]);
  for (const result of resolutions) {
    assert.equal(result.category, QuestionCategory.HARD_STOP);
    assert.equal(result.action, QuestionAction.MANUAL_ONLY);
    assert.equal(result.planBucket, FormAnswerBucket.REVIEW_ONLY);
    assert.equal(result.value, null);
    assert.equal(result.manualOnly, true);
    assert.equal(result.required, true);
  }
});

test("prompts for a company-tailored why-role response unless an exact approved answer exists", () => {
  const withoutRoleAnswer = {
    ...profile,
    approvedAnswers: profile.approvedAnswers,
  };
  const resolution = resolveFormQuestion(withoutRoleAnswer, {
    label: "Why are you interested in this role?",
    name: "whyThisRole",
    required: true,
  });

  assert.equal(resolution.kind, QuestionKind.COMPANY_TAILORED);
  assert.equal(resolution.category, QuestionCategory.COMPANY_TAILORED);
  assert.equal(resolution.action, QuestionAction.REQUEST_INPUT);
  assert.equal(resolution.planBucket, FormAnswerBucket.PROMPT);
  assert.equal(resolution.value, null);
  assert.equal(resolution.needsUserInput, true);
  assert.equal(resolution.unsupported, false);
});

test("resolves only fields currently present in the form and prompts for present conditional fields", () => {
  const resolutions = resolvePresentFormQuestions(profile, [
    { label: "First name", required: true },
    { label: "Current city", present: false },
    { label: "Email address", visible: false },
    {
      label: "If yes, identify your previous employer",
      conditional: true,
      required: true,
    },
  ]);

  assert.equal(resolutions.length, 2);
  assert.deepEqual(resolutions.map((item) => item.question.label), [
    "First name",
    "If yes, identify your previous employer",
  ]);
  assert.equal(resolutions[0].action, QuestionAction.AUTO_FILL);
  assert.equal(resolutions[1].kind, QuestionKind.CONDITIONAL);
  assert.equal(resolutions[1].conditional, true);
  assert.equal(resolutions[1].action, QuestionAction.REQUEST_INPUT);
  assert.equal(resolutions[1].value, null);
});

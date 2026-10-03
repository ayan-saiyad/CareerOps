import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_RESUME_INTAKE_FIELDS,
  analyzeResumeIntake,
  extractResumeProfileHints,
} from "../../src/domain/index.js";

const fictionalResume = `
TAYLOR MORGAN
Software Engineer
taylor.morgan@example.test | +1 (555) 010-0199
LinkedIn: https://www.linkedin.com/in/taylor-morgan
GitHub: github.com/taylor-morgan
Portfolio: https://taylor.example.test

Education
Fictional State University — B.S. in Computer Science, May 2024
`;

test("extracts only clear header contact details, public profiles, and education hints", () => {
  const result = extractResumeProfileHints(fictionalResume);

  assert.deepEqual(result.profile, {
    fullName: "Taylor Morgan",
    firstName: "Taylor",
    lastName: "Morgan",
    email: "taylor.morgan@example.test",
    phone: "+1 (555) 010-0199",
    links: {
      linkedin: "https://www.linkedin.com/in/taylor-morgan",
      github: "https://github.com/taylor-morgan",
      website: "https://taylor.example.test",
    },
    education: [{
      school: "Fictional State University",
      degree: "B.S.",
      fieldOfStudy: "Computer Science",
      graduationYear: "2024",
    }],
  });
  assert.deepEqual(result.ambiguousFields, []);
});

test("uses explicit profile values first and turns only missing defaults into clarifying questions", () => {
  const result = analyzeResumeIntake(fictionalResume, {
    email: "taylors-preferred@example.test",
    location: "Chicago, IL",
    links: { website: "https://portfolio.example.test" },
  });

  assert.equal(result.profile.email, "taylors-preferred@example.test");
  assert.equal(result.profile.location, "Chicago, IL");
  assert.equal(result.profile.links.website, "https://portfolio.example.test");
  assert.equal(result.fields.find((field) => field.key === "email").source, "profile");
  assert.equal(result.fields.find((field) => field.key === "location").source, "profile");
  assert.deepEqual(result.missingFields, []);
  assert.deepEqual(result.clarifyingQuestions, []);
});

test("reports required and optional defaults that remain absent without inventing a location", () => {
  const result = analyzeResumeIntake("Taylor Morgan\ntaylor.morgan@example.test");
  const missingByKey = Object.fromEntries(result.missingFields.map((field) => [field.key, field]));

  assert.equal(result.hasResume, true);
  assert.ok(missingByKey.phone?.required);
  assert.ok(missingByKey.location?.required);
  assert.equal(missingByKey.linkedin?.required, false);
  assert.equal(missingByKey.education?.required, false);
  assert.deepEqual(result.clarifyingQuestions, result.missingFields);
  assert.equal(result.profile.location, undefined);
  assert.equal(DEFAULT_RESUME_INTAKE_FIELDS.some((field) => field.key === "requiresSponsorship"), false);
  assert.equal(DEFAULT_RESUME_INTAKE_FIELDS.some((field) => field.key === "salaryExpectation"), false);
});

test("withholds ambiguous contact details and unlabeled generic URLs", () => {
  const result = extractResumeProfileHints(`
Jordan Lee
jordan.one@example.test | jordan.two@example.test
1 (555) 010-0101 | 1 (555) 010-0102
https://company.example.test/careers
`);

  assert.equal(result.profile.email, undefined);
  assert.equal(result.profile.phone, undefined);
  assert.equal(result.profile.links, undefined);
  assert.deepEqual([...result.ambiguousFields].sort(), ["email", "phone"]);
});

test("does not derive sensitive, legal, eligibility, demographic, or compensation facts", () => {
  const result = analyzeResumeIntake(`
Casey Rowan
casey.rowan@example.test

Authorized to work in the United States. I will require sponsorship.
Desired salary: $180,000.
Gender: fictional value. Social Security Number: 999-00-0000.
` , {
    requiresSponsorship: true,
    workAuthorization: { authorized: true },
    salaryExpectation: "$180,000",
    demographics: { gender: "fictional value" },
  });
  const serialized = JSON.stringify(result);

  for (const key of ["requiresSponsorship", "workAuthorization", "salaryExpectation", "demographics"]) {
    assert.equal(Object.hasOwn(result.profile, key), false);
    assert.equal(Object.hasOwn(result.extracted, key), false);
  }
  assert.equal(serialized.includes("180,000"), false);
  assert.equal(serialized.includes("999-00-0000"), false);
  assert.equal(serialized.includes("fictional value"), false);
});

test("does not mistake a resume section heading for a name", () => {
  const result = extractResumeProfileHints(`
Software Engineer
Skills
TypeScript, Node.js
`);

  assert.equal(result.profile.fullName, undefined);
  assert.equal(result.profile.firstName, undefined);
  assert.equal(result.profile.lastName, undefined);
});

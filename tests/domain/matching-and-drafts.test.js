import assert from "node:assert/strict";
import test from "node:test";

import { buildApplicationDraft, evaluateJob, seedJobs, seedProfile } from "../../src/domain/index.js";

test("evaluateJob gives a stronger score to evidence-rich matching roles", () => {
  const strong = evaluateJob(seedProfile, seedJobs.find((job) => job.externalId === "northstar-platform-101"));
  const weak = evaluateJob(seedProfile, seedJobs.find((job) => job.externalId === "orbit-data-452"));

  assert.equal(strong.recommendation, "strong_match");
  assert.equal(strong.match.score, 100);
  assert.ok(strong.match.score > weak.match.score);
  assert.ok(weak.match.missingSkills.includes("python"));
  assert.equal(weak.match.confidence, 100);
});

test("drafts retain profile evidence and leave missing sensitive facts for review", () => {
  const job = seedJobs.find((item) => item.externalId === "northstar-platform-101");
  const draft = buildApplicationDraft(seedProfile, job);

  assert.equal(draft.status, "needs_review");
  assert.match(draft.coverLetter, /Software Engineer, Platform/);
  assert.ok(draft.evidence.every((item) => item.id));
  assert.ok(draft.answers.every((item) => item.requiresReview));
  assert.equal(draft.answers.find((item) => item.key === "work_authorization").sensitive, true);
  assert.ok(draft.guardrails.some((rule) => rule.includes("Review every answer")));
});

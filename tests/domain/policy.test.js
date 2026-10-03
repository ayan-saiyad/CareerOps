import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePolicy, seedJobs, seedProfile } from "../../src/domain/index.js";

const decisionFor = (externalId) =>
  evaluatePolicy(
    seedJobs.find((job) => job.externalId === externalId),
    seedProfile,
    { now: "2026-10-01T00:00:00.000Z" },
  );

test("policy admits a role meeting all hard preferences", () => {
  const decision = decisionFor("northstar-platform-101");

  assert.equal(decision.eligible, true);
  assert.equal(decision.status, "eligible");
  assert.ok(decision.matches.some((item) => item.code === "salary_match"));
  assert.equal(decision.blockers.length, 0);
});

test("policy keeps independent blockers for a role that misses multiple constraints", () => {
  const decision = decisionFor("signal-fullstack-808");
  const codes = decision.blockers.map((item) => item.code);

  assert.equal(decision.eligible, false);
  assert.ok(codes.includes("workplace_mismatch"));
  assert.ok(codes.includes("salary_below_floor"));
});

test("policy exposes a company exclusion instead of silently removing the job", () => {
  const decision = decisionFor("paperkite-software-342");

  assert.equal(decision.eligible, false);
  assert.equal(decision.blockers[0].code, "excluded_company");
});

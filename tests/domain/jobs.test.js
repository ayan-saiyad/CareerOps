import assert from "node:assert/strict";
import test from "node:test";

import {
  EmploymentType,
  JobSource,
  WorkplaceType,
  createDedupeKey,
  normalizeJob,
} from "../../src/domain/index.js";

test("normalizeJob produces a display-friendly, stable record", () => {
  const job = normalizeJob({
    provider: "Greenhouse",
    id: 42,
    title: "Senior Software Engineer",
    companyName: "Acme, Inc.",
    description: "Build TypeScript and React interfaces with Node.js services.",
    location: { city: "Chicago", state: "IL", country: "US" },
    workplace: "Hybrid",
    type: "Full-time",
    salary: "$125k - $150k per year",
    absolute_url: "https://boards.greenhouse.io/acme/jobs/42",
    created_at: "2026-09-20T12:00:00Z",
  });

  assert.equal(job.id, "greenhouse:42");
  assert.equal(job.source, JobSource.GREENHOUSE);
  assert.equal(job.title, "Senior Software Engineer");
  assert.equal(job.company, "Acme, Inc.");
  assert.equal(job.location, "Chicago, IL, US");
  assert.equal(job.workplaceType, WorkplaceType.HYBRID);
  assert.equal(job.employmentType, EmploymentType.FULL_TIME);
  assert.deepEqual(job.compensation, { min: 125000, max: 150000, currency: "USD", period: "year" });
  assert.deepEqual(job.requirements.sort(), ["node.js", "react", "typescript"]);
  assert.equal(job.postedAt, "2026-09-20");
  assert.equal(job.normalizationWarnings.length, 0);
});

test("dedupe keys ignore a feed-specific ID and salary updates", () => {
  const first = normalizeJob({
    source: "lever",
    externalId: "one",
    title: "Backend Engineer",
    company: "Example Co",
    location: "Remote (US)",
    compensation: { min: 100000, max: 120000 },
  });
  const updated = normalizeJob({
    source: "greenhouse",
    externalId: "two",
    title: "Backend Engineer",
    company: "Example Co",
    location: "Remote (US)",
    compensation: { min: 110000, max: 130000 },
  });

  assert.equal(createDedupeKey(first), createDedupeKey(updated));
});

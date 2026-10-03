import { normalizeJobs } from "./jobs.js";
import { deepClone } from "./utils.js";

const seedExperiences = Object.freeze([
  Object.freeze({
    id: "experience-beacon",
    company: "Beacon Logistics",
    title: "Software Engineer",
    skills: Object.freeze(["TypeScript", "React", "Node.js", "PostgreSQL", "AWS"]),
    highlights: Object.freeze([
      Object.freeze({
        id: "highlight-ops-console",
        text: "Built a TypeScript operations console used by dispatch teams to coordinate deliveries.",
        skills: Object.freeze(["TypeScript", "React"]),
      }),
      Object.freeze({
        id: "highlight-api",
        text: "Designed Node.js APIs backed by PostgreSQL for shipment-status workflows.",
        skills: Object.freeze(["Node.js", "PostgreSQL"]),
      }),
      Object.freeze({
        id: "highlight-cloud",
        text: "Maintained CI deployments for an AWS-hosted application with a cross-functional product team.",
        skills: Object.freeze(["AWS", "CI/CD"]),
      }),
    ]),
  }),
]);

/** Entirely fictional data for local demos and tests; it is not user data. */
export const seedProfile = Object.freeze({
  id: "demo-alex-rivera",
  name: "Alex Rivera",
  headline: "Full-stack software engineer",
  location: "Chicago, IL",
  experienceYears: 3,
  skills: Object.freeze(["TypeScript", "React", "Node.js", "PostgreSQL", "AWS", "Docker"]),
  workAuthorization: Object.freeze({
    status: "Authorized to work in the United States without sponsorship.",
    requiresSponsorship: false,
  }),
  requiresSponsorship: false,
  facts: Object.freeze([
    Object.freeze({
      id: "fact-collaboration",
      value: "I enjoy building reliable product features in close collaboration with design and operations partners.",
      skills: Object.freeze(["React", "TypeScript"]),
    }),
  ]),
  experiences: seedExperiences,
  preferences: Object.freeze({
    targetRoles: Object.freeze(["Software Engineer", "Full Stack Engineer", "Backend Engineer"]),
    acceptedLocations: Object.freeze(["Remote", "Chicago, IL", "Austin, TX"]),
    remotePreference: "remote_or_hybrid",
    minimumBaseSalary: 105000,
    excludedCompanies: Object.freeze(["Paper Kite"]),
    maximumJobAgeDays: 45,
  }),
});

export const seedJobs = normalizeJobs([
  {
    source: "demo",
    externalId: "northstar-platform-101",
    title: "Software Engineer, Platform",
    company: "Northstar Commerce",
    description: "Build platform services and interfaces with TypeScript, React, Node.js, PostgreSQL, and AWS.",
    requirements: ["TypeScript", "React", "Node.js", "PostgreSQL", "AWS"],
    location: "Remote (US)",
    workplaceType: "remote",
    employmentType: "full-time",
    compensation: { min: 128000, max: 152000, currency: "USD", period: "year" },
    experience: { minimum: 3 },
    sourceUrl: "https://demo.careerops.local/jobs/northstar-platform-101",
    postedAt: "2026-09-18",
  },
  {
    source: "demo",
    externalId: "lakefront-backend-227",
    title: "Backend Engineer",
    company: "Lakefront Systems",
    description: "Own Node.js services, PostgreSQL data models, Docker images, and observability for a Chicago product team.",
    requirements: ["Node.js", "TypeScript", "PostgreSQL", "Docker"],
    location: "Chicago, IL",
    workplaceType: "hybrid",
    employmentType: "full-time",
    compensation: { min: 115000, max: 140000, currency: "USD", period: "year" },
    experience: { minimum: 3 },
    sourceUrl: "https://demo.careerops.local/jobs/lakefront-backend-227",
    postedAt: "2026-09-22",
  },
  {
    source: "demo",
    externalId: "orbit-data-452",
    title: "Staff Data Engineer",
    company: "Orbit Analytics",
    description: "Develop Python, Spark, Airflow, and AWS data products for an analytics platform.",
    requirements: ["Python", "AWS", "SQL"],
    location: "Remote (US)",
    workplaceType: "remote",
    employmentType: "full-time",
    compensation: { min: 160000, max: 195000, currency: "USD", period: "year" },
    experience: { minimum: 7 },
    sourceUrl: "https://demo.careerops.local/jobs/orbit-data-452",
    postedAt: "2026-09-12",
  },
  {
    source: "demo",
    externalId: "signal-fullstack-808",
    title: "Full Stack Engineer",
    company: "Signal Harbor",
    description: "Build React and Node.js workflows in Austin for a customer-support platform.",
    requirements: ["React", "Node.js", "JavaScript"],
    location: "Austin, TX",
    workplaceType: "onsite",
    employmentType: "full-time",
    compensation: { min: 90000, max: 100000, currency: "USD", period: "year" },
    experience: { minimum: 2 },
    sourceUrl: "https://demo.careerops.local/jobs/signal-fullstack-808",
    postedAt: "2026-09-25",
  },
  {
    source: "demo",
    externalId: "paperkite-software-342",
    title: "Software Engineer",
    company: "Paper Kite",
    description: "Create TypeScript services and React experiences for a remote team.",
    requirements: ["TypeScript", "React", "Node.js"],
    location: "Remote (US)",
    workplaceType: "remote",
    employmentType: "full-time",
    compensation: { min: 120000, max: 145000, currency: "USD", period: "year" },
    experience: { minimum: 3 },
    sourceUrl: "https://demo.careerops.local/jobs/paperkite-software-342",
    postedAt: "2026-09-20",
  },
]);

export function createSeedData() {
  return deepClone({ profile: seedProfile, jobs: seedJobs });
}

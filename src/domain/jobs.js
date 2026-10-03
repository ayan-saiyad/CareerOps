import {
  asArray,
  canonicalText,
  cleanText,
  isRemoteLocation,
  normalizeLocationText,
  normalizeSkill,
  stableHash,
  toFiniteNumber,
  toIsoDate,
  uniqueSkills,
  uniqueStrings,
} from "./utils.js";

export const JobSource = Object.freeze({
  GREENHOUSE: "greenhouse",
  LEVER: "lever",
  ASHBY: "ashby",
  MANUAL: "manual",
  DEMO: "demo",
  UNKNOWN: "unknown",
});

export const WorkplaceType = Object.freeze({
  REMOTE: "remote",
  HYBRID: "hybrid",
  ONSITE: "onsite",
  UNSPECIFIED: "unspecified",
});

export const EmploymentType = Object.freeze({
  FULL_TIME: "full_time",
  PART_TIME: "part_time",
  CONTRACT: "contract",
  INTERNSHIP: "internship",
  TEMPORARY: "temporary",
  UNSPECIFIED: "unspecified",
});

const KNOWN_SOURCE_VALUES = new Set(Object.values(JobSource));
const KNOWN_SKILL_PATTERNS = [
  "javascript",
  "typescript",
  "react",
  "node.js",
  "nodejs",
  "next.js",
  "nextjs",
  "python",
  "java",
  "golang",
  "go",
  "ruby",
  "sql",
  "postgresql",
  "postgres",
  "mysql",
  "mongodb",
  "redis",
  "aws",
  "gcp",
  "azure",
  "docker",
  "kubernetes",
  "terraform",
  "graphql",
  "rest",
  "playwright",
  "cypress",
  "figma",
  "machine learning",
];

function sourceFromUrl(url) {
  const text = canonicalText(url);
  if (text.includes("greenhouse.io")) return JobSource.GREENHOUSE;
  if (text.includes("lever.co")) return JobSource.LEVER;
  if (text.includes("ashbyhq.com")) return JobSource.ASHBY;
  return JobSource.UNKNOWN;
}

export function normalizeSource(value, url = "") {
  const source = canonicalText(value).replace(/[\s_-]+/g, "");
  const aliases = {
    greenhouse: JobSource.GREENHOUSE,
    lever: JobSource.LEVER,
    ashby: JobSource.ASHBY,
    ashbyhq: JobSource.ASHBY,
    manual: JobSource.MANUAL,
    demo: JobSource.DEMO,
  };
  if (aliases[source]) return aliases[source];
  if (KNOWN_SOURCE_VALUES.has(source)) return source;
  return sourceFromUrl(url);
}

export function normalizeWorkplaceType(value, location = "") {
  const text = canonicalText(value);
  if (text.includes("remote") || isRemoteLocation(location)) return WorkplaceType.REMOTE;
  if (text.includes("hybrid")) return WorkplaceType.HYBRID;
  if (text.includes("on-site") || text.includes("onsite") || text.includes("in office")) {
    return WorkplaceType.ONSITE;
  }
  return WorkplaceType.UNSPECIFIED;
}

export function normalizeEmploymentType(value) {
  const text = canonicalText(value).replace(/[\s-]+/g, "_");
  if (text.includes("full")) return EmploymentType.FULL_TIME;
  if (text.includes("part")) return EmploymentType.PART_TIME;
  if (text.includes("contract") || text.includes("freelance")) return EmploymentType.CONTRACT;
  if (text.includes("intern")) return EmploymentType.INTERNSHIP;
  if (text.includes("temp")) return EmploymentType.TEMPORARY;
  return EmploymentType.UNSPECIFIED;
}

function numberFromAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = cleanText(value).toLowerCase();
  if (!text) return null;
  const match = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(k)?/);
  if (!match) return toFiniteNumber(text);
  const number = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(number) ? (match[2] ? number * 1000 : number) : null;
}

function inferCompensationRange(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return { min: null, max: null };
  const amounts = [...text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k)?/g)]
    .map((match) => numberFromAmount(`${match[1]}${match[2] ?? ""}`))
    .filter((amount) => amount !== null);
  return { min: amounts[0] ?? null, max: amounts[1] ?? null };
}

function normalizeCompensationPeriod(value) {
  const text = canonicalText(value);
  if (text.includes("hour")) return "hour";
  if (text.includes("week")) return "week";
  if (text.includes("month")) return "month";
  if (text.includes("day")) return "day";
  return "year";
}

/**
 * Compensation is normalized but never guessed: an absent or unparseable range
 * becomes null and downstream policy can call it out for human review.
 */
export function normalizeCompensation(value, rawJob = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const sourceText = typeof value === "string" ? value : "";
  const inferred = inferCompensationRange(sourceText);
  const min = numberFromAmount(
    source.min ?? source.minimum ?? source.minSalary ?? rawJob.salaryMin ?? rawJob.minimumSalary ?? inferred.min,
  );
  const max = numberFromAmount(
    source.max ?? source.maximum ?? source.maxSalary ?? rawJob.salaryMax ?? rawJob.maximumSalary ?? inferred.max,
  );

  if (min === null && max === null) return null;

  const orderedMin = min !== null && max !== null ? Math.min(min, max) : min;
  const orderedMax = min !== null && max !== null ? Math.max(min, max) : max;
  const currency = cleanText(source.currency ?? rawJob.currency ?? "USD").toUpperCase() || "USD";
  const period = normalizeCompensationPeriod(source.period ?? rawJob.salaryPeriod ?? sourceText);

  return Object.freeze({ min: orderedMin, max: orderedMax, currency, period });
}

export function annualizeCompensation(compensation) {
  if (!compensation) return null;
  const amount = compensation.min ?? compensation.max;
  if (amount === null || amount === undefined) return null;
  const multipliers = { year: 1, month: 12, week: 52, day: 260, hour: 2080 };
  return Math.round(amount * (multipliers[compensation.period] ?? 1));
}

function normalizeLocations(value) {
  const locations = [];
  for (const item of asArray(value)) {
    if (item && typeof item === "object") {
      const parts = [item.city, item.region ?? item.state, item.country]
        .map(cleanText)
        .filter(Boolean);
      const label = cleanText(item.label ?? item.name ?? item.location) || parts.join(", ");
      if (label) locations.push(label);
    } else if (cleanText(item)) {
      locations.push(cleanText(item));
    }
  }
  return uniqueStrings(locations);
}

function extractKnownSkills(text) {
  const haystack = canonicalText(text).replace(/nodejs/g, "node.js").replace(/nextjs/g, "next.js");
  const found = [];
  for (const pattern of KNOWN_SKILL_PATTERNS) {
    const normalized = normalizeSkill(pattern);
    const expression = new RegExp(`(?:^|[^a-z0-9])${pattern.replace(/[.]/g, "\\.")}(?:$|[^a-z0-9])`, "i");
    if (expression.test(haystack)) found.push(normalized);
  }
  return found;
}

function normalizeRequirements(value, description = "") {
  const candidates = [];
  for (const item of asArray(value)) {
    const text = cleanText(typeof item === "object" && item ? item.name ?? item.label ?? item.value : item);
    if (!text) continue;
    const segments = text.split(/[,;|\n]+/).map(cleanText).filter(Boolean);
    if (segments.length > 1) candidates.push(...segments);
    else if (text.length <= 80 && !/[.!?]/.test(text)) candidates.push(text);
    else candidates.push(...extractKnownSkills(text));
  }
  // Description extraction only recognizes the small explicit skill list above.
  candidates.push(...extractKnownSkills(description));
  return uniqueSkills(candidates);
}

function normalizeExperienceYears(raw) {
  const source = raw.experience ?? raw.experienceYears ?? raw.yearsExperience ?? {};
  if (typeof source === "number" || typeof source === "string") {
    const years = toFiniteNumber(source);
    return years === null ? null : { minimum: years, maximum: null };
  }
  const minimum = toFiniteNumber(source.minimum ?? source.min ?? raw.minimumExperienceYears);
  const maximum = toFiniteNumber(source.maximum ?? source.max ?? raw.maximumExperienceYears);
  if (minimum === null && maximum === null) return null;
  return { minimum, maximum };
}

function pickFirst(...values) {
  return values.map(cleanText).find(Boolean) ?? "";
}

/**
 * A stable key for duplicate detection. It deliberately excludes compensation,
 * because ATS feeds often update salary data after a role is first listed.
 */
export function createDedupeKey(job) {
  const company = canonicalText(job.company);
  const title = canonicalText(job.title);
  const locations = (job.locations ?? [job.location]).map(normalizeLocationText).sort().join("|");
  return `${company}|${title}|${locations}`;
}

/**
 * Convert connector-shaped data into a display-friendly, normalized job record.
 * No source fields are mutated and unknown fields are represented as null/empty.
 */
export function normalizeJob(rawJob = {}, options = {}) {
  if (!rawJob || typeof rawJob !== "object") {
    throw new TypeError("normalizeJob expects a job-shaped object");
  }

  const sourceUrl = pickFirst(rawJob.sourceUrl, rawJob.url, rawJob.applyUrl, rawJob.absolute_url);
  const source = normalizeSource(options.source ?? rawJob.source ?? rawJob.provider, sourceUrl);
  const title = pickFirst(rawJob.title, rawJob.name, rawJob.jobTitle);
  const company = pickFirst(rawJob.company, rawJob.companyName, rawJob.organization, rawJob.board);
  const description = pickFirst(rawJob.description, rawJob.content, rawJob.text, rawJob.descriptionPlain);
  const locations = normalizeLocations(rawJob.locations ?? rawJob.location ?? rawJob.locationName);
  const location = locations[0] ?? "Location not listed";
  const workplaceType = normalizeWorkplaceType(
    rawJob.workplaceType ?? rawJob.workplace ?? rawJob.remote,
    locations.join(" "),
  );
  const externalId = pickFirst(rawJob.externalId, rawJob.requisitionId, rawJob.jobId, rawJob.id);
  const identityMaterial = [source, externalId || sourceUrl, company, title, locations.join("|")].join("|");
  const id = cleanText(rawJob.normalizedId) || `${source}:${externalId || stableHash(identityMaterial)}`;
  const requirements = normalizeRequirements(
    rawJob.requirements ?? rawJob.requiredSkills ?? rawJob.skills,
    description,
  );
  const warnings = [];
  if (!title) warnings.push("missing_title");
  if (!company) warnings.push("missing_company");
  if (!sourceUrl) warnings.push("missing_url");

  const normalized = {
    schemaVersion: 1,
    id,
    externalId: externalId || null,
    source,
    title: title || "Untitled role",
    company: company || "Company not listed",
    description,
    requirements,
    location,
    locations: Object.freeze(locations),
    workplaceType,
    employmentType: normalizeEmploymentType(rawJob.employmentType ?? rawJob.type),
    compensation: normalizeCompensation(rawJob.compensation ?? rawJob.salary ?? rawJob.salaryRange, rawJob),
    experience: normalizeExperienceYears(rawJob),
    sourceUrl: sourceUrl || null,
    applyUrl: pickFirst(rawJob.applyUrl, rawJob.url, rawJob.absolute_url) || null,
    postedAt: toIsoDate(rawJob.postedAt ?? rawJob.createdAt ?? rawJob.created_at),
    updatedAt: toIsoDate(rawJob.updatedAt ?? rawJob.updated_at),
    sponsorship: rawJob.sponsorship === true || rawJob.sponsorship === false ? rawJob.sponsorship : null,
    normalizationWarnings: Object.freeze(warnings),
  };

  return Object.freeze({ ...normalized, dedupeKey: createDedupeKey(normalized) });
}

export function normalizeJobs(rawJobs, options = {}) {
  return Object.freeze(asArray(rawJobs).map((job) => normalizeJob(job, options)));
}

export function isNormalizedJob(value) {
  return Boolean(value && value.schemaVersion === 1 && value.id && value.title && value.company);
}

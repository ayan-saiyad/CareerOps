import { annualizeCompensation, isNormalizedJob, normalizeJob, WorkplaceType } from "./jobs.js";
import { asArray, clamp, cleanText, isRemoteLocation, normalizeLocationText, overlap, tokenize, uniqueSkills } from "./utils.js";

export const MatchWeights = Object.freeze({
  SKILLS: 45,
  ROLE: 20,
  WORKPLACE: 10,
  LOCATION: 10,
  EXPERIENCE: 10,
  COMPENSATION: 5,
});

const ROLE_NOISE = new Set([
  "intern",
  "junior",
  "jr",
  "senior",
  "sr",
  "staff",
  "principal",
  "lead",
  "manager",
  "director",
  "associate",
  "level",
  "ii",
  "iii",
]);

function valueFromProfile(profile, key, aliases = []) {
  const sources = [profile?.preferences, profile];
  for (const source of sources) {
    if (!source) continue;
    for (const candidate of [key, ...aliases]) {
      if (source[candidate] !== undefined && source[candidate] !== null) return source[candidate];
    }
  }
  return undefined;
}

function profileSkills(profile) {
  const experienceSkills = asArray(profile?.experiences).flatMap((experience) => asArray(experience?.skills));
  return uniqueSkills([
    ...asArray(profile?.skills),
    ...asArray(profile?.technicalSkills),
    ...experienceSkills,
  ]);
}

function roleTokens(value) {
  return tokenize(value).filter((token) => !ROLE_NOISE.has(token));
}

function roleSimilarity(title, targets) {
  const titleSet = new Set(roleTokens(title));
  let best = { ratio: 0, target: null, shared: [] };
  for (const target of targets) {
    const targetTokens = roleTokens(target);
    if (!targetTokens.length) continue;
    const shared = targetTokens.filter((token) => titleSet.has(token));
    const ratio = shared.length / targetTokens.length;
    if (ratio > best.ratio) best = { ratio, target: cleanText(target), shared };
  }
  return best;
}

function workplaceFit(job, preference) {
  const normalized = cleanText(preference).toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized || job.workplaceType === WorkplaceType.UNSPECIFIED) return null;
  if (normalized === "remote_only") return job.workplaceType === WorkplaceType.REMOTE ? 1 : 0;
  if (normalized === "remote_or_hybrid" || normalized === "remote_hybrid") {
    return [WorkplaceType.REMOTE, WorkplaceType.HYBRID].includes(job.workplaceType) ? 1 : 0;
  }
  if (normalized === "hybrid_only") return job.workplaceType === WorkplaceType.HYBRID ? 1 : 0;
  if (normalized === "onsite_only") return job.workplaceType === WorkplaceType.ONSITE ? 1 : 0;
  return null;
}

function locationFit(job, preferences) {
  if (!preferences.length) return null;
  const locations = (job.locations?.length ? job.locations : [job.location]).map(normalizeLocationText);
  if (!locations.length || locations.every((location) => location === "location not listed")) return null;
  return preferences.some((preference) => {
    const desired = normalizeLocationText(preference);
    if (isRemoteLocation(desired) && job.workplaceType === WorkplaceType.REMOTE) return true;
    return locations.some(
      (actual) => actual === desired || actual.includes(desired) || desired.includes(actual),
    );
  })
    ? 1
    : 0;
}

function salaryFit(job, floor) {
  if (!Number.isFinite(floor) || floor <= 0 || !job.compensation || job.compensation.currency !== "USD") return null;
  const low = annualizeCompensation(job.compensation);
  const high = annualizeCompensation({ ...job.compensation, min: job.compensation.max, max: job.compensation.max });
  if (high === null) return null;
  if (high < floor) return 0;
  if (low !== null && low >= floor) return 1;
  return 0.5;
}

function createDimension(key, label, maximum, ratio, explanation, evidence) {
  const available = ratio !== null && ratio !== undefined;
  const safeRatio = available ? clamp(ratio, 0, 1) : 0;
  return Object.freeze({
    key,
    label,
    maximum,
    score: Math.round(maximum * safeRatio * 10) / 10,
    ratio: Math.round(safeRatio * 100) / 100,
    available,
    explanation,
    evidence: Object.freeze(evidence ?? []),
  });
}

/**
 * Produce an explainable score from only structured, user-reviewable evidence.
 * Score is normalized against available evidence; confidence shows how complete
 * that evidence was, preventing sparse postings from looking deceptively strong.
 */
export function scoreJobMatch(jobInput, profile = {}) {
  const job = isNormalizedJob(jobInput) ? jobInput : normalizeJob(jobInput);
  const candidateSkills = profileSkills(profile);
  const requirements = uniqueSkills(job.requirements);
  const matchedSkills = overlap(requirements, candidateSkills);
  const missingSkills = requirements.filter((skill) => !matchedSkills.includes(skill));
  const skillRatio = requirements.length ? matchedSkills.length / requirements.length : null;

  const targetRoles = asArray(valueFromProfile(profile, "targetRoles", ["roles"]));
  const role = roleSimilarity(job.title, targetRoles);
  const roleRatio = targetRoles.length ? role.ratio : null;
  const remotePreference = valueFromProfile(profile, "remotePreference", ["workplacePreference"]);
  const workplaceRatio = workplaceFit(job, remotePreference);
  const acceptedLocations = asArray(valueFromProfile(profile, "acceptedLocations", ["locations", "preferredLocations"]));
  const locationRatio = locationFit(job, acceptedLocations);
  const experienceYears = Number(profile?.experienceYears ?? profile?.yearsExperience);
  const minimumExperience = job.experience?.minimum;
  const experienceRatio =
    Number.isFinite(experienceYears) && Number.isFinite(minimumExperience)
      ? clamp(experienceYears / Math.max(minimumExperience, 1), 0, 1)
      : null;
  const salaryFloor = Number(valueFromProfile(profile, "minimumBaseSalary", ["salaryFloor"]));
  const compensationRatio = salaryFit(job, salaryFloor);

  const dimensions = [
    createDimension(
      "skills",
      "Required skills",
      MatchWeights.SKILLS,
      skillRatio,
      requirements.length
        ? `${matchedSkills.length} of ${requirements.length} stated requirements appear in your profile.`
        : "The posting does not expose structured requirements.",
      matchedSkills,
    ),
    createDimension(
      "role",
      "Target role",
      MatchWeights.ROLE,
      roleRatio,
      role.target
        ? `${job.title} overlaps with ${role.target}${role.shared.length ? ` (${role.shared.join(", ")})` : ""}.`
        : "No target roles are configured.",
      role.shared,
    ),
    createDimension(
      "workplace",
      "Work arrangement",
      MatchWeights.WORKPLACE,
      workplaceRatio,
      remotePreference
        ? `${job.workplaceType} compared with your ${cleanText(remotePreference).replace(/_/g, " ")} preference.`
        : "No work-arrangement preference is configured.",
    ),
    createDimension(
      "location",
      "Location",
      MatchWeights.LOCATION,
      locationRatio,
      acceptedLocations.length
        ? `${job.location} compared with your accepted locations.`
        : "No accepted locations are configured.",
    ),
    createDimension(
      "experience",
      "Experience",
      MatchWeights.EXPERIENCE,
      experienceRatio,
      Number.isFinite(minimumExperience)
        ? `Role requests ${minimumExperience}+ years; profile lists ${Number.isFinite(experienceYears) ? experienceYears : "an unknown number"}.`
        : "The posting does not list a minimum experience level.",
    ),
    createDimension(
      "compensation",
      "Compensation",
      MatchWeights.COMPENSATION,
      compensationRatio,
      Number.isFinite(salaryFloor)
        ? "Listed compensation compared with your salary floor."
        : "No salary floor is configured.",
    ),
  ];

  const availableDimensions = dimensions.filter((dimension) => dimension.available);
  const possiblePoints = availableDimensions.reduce((total, dimension) => total + dimension.maximum, 0);
  const earnedPoints = availableDimensions.reduce((total, dimension) => total + dimension.score, 0);
  const totalPoints = Object.values(MatchWeights).reduce((total, weight) => total + weight, 0);
  const score = possiblePoints ? Math.round((earnedPoints / possiblePoints) * 100) : 0;
  const confidence = Math.round((possiblePoints / totalPoints) * 100);

  const recommendation =
    confidence < 40
      ? "needs_more_evidence"
      : score >= 75
        ? "strong_match"
        : score >= 50
          ? "consider"
          : "low_match";

  return Object.freeze({
    jobId: job.id,
    score,
    confidence,
    recommendation,
    matchedSkills: Object.freeze(matchedSkills),
    missingSkills: Object.freeze(missingSkills),
    dimensions: Object.freeze(dimensions),
  });
}

export function summarizeMatch(match) {
  const skills = match.matchedSkills.length
    ? `Matched skills: ${match.matchedSkills.join(", ")}.`
    : "No structured skill overlap found.";
  return `${match.score}% match score at ${match.confidence}% evidence confidence. ${skills}`;
}

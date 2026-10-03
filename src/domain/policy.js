import { annualizeCompensation, isNormalizedJob, normalizeJob, WorkplaceType } from "./jobs.js";
import { asArray, canonicalText, cleanText, isRemoteLocation, normalizeLocationText, tokenize } from "./utils.js";

export const PolicyStatus = Object.freeze({
  ELIGIBLE: "eligible",
  INELIGIBLE: "ineligible",
});

const SENIORITY_WORDS = new Set([
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

function reason(code, severity, message) {
  return Object.freeze({ code, severity, message });
}

function preferenceValue(profile, overrides, key, aliases = []) {
  const sources = [overrides, profile?.preferences, profile];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const candidate of [key, ...aliases]) {
      if (source[candidate] !== undefined && source[candidate] !== null) return source[candidate];
    }
  }
  return undefined;
}

function normalizedList(value, mapper = canonicalText) {
  return asArray(value).map(mapper).filter(Boolean);
}

function titleTokens(value) {
  return tokenize(value).filter((token) => !SENIORITY_WORDS.has(token));
}

/** Whether a job title is a direct enough match for an explicit target role. */
export function roleMatchesTarget(title, targetRole) {
  const titleText = canonicalText(title);
  const targetText = canonicalText(targetRole);
  if (!titleText || !targetText) return false;
  if (titleText.includes(targetText) || targetText.includes(titleText)) return true;

  const targetTokens = titleTokens(targetRole);
  const titleSet = new Set(titleTokens(title));
  const shared = targetTokens.filter((token) => titleSet.has(token));
  return targetTokens.length > 0 && shared.length / targetTokens.length >= 0.5;
}

function locationsMatch(job, acceptedLocations) {
  const jobLocations = (job.locations?.length ? job.locations : [job.location])
    .map(normalizeLocationText)
    .filter(Boolean);
  const accepted = acceptedLocations.map(normalizeLocationText).filter(Boolean);

  if (!accepted.length) return { known: false, matches: true };
  if (!jobLocations.length || jobLocations.every((location) => location === "location not listed")) {
    return { known: false, matches: false };
  }

  const matches = accepted.some((desired) => {
    if (isRemoteLocation(desired) && job.workplaceType === WorkplaceType.REMOTE) return true;
    return jobLocations.some(
      (actual) => actual === desired || actual.includes(desired) || desired.includes(actual),
    );
  });
  return { known: true, matches };
}

function daysSince(date, now) {
  if (!date) return null;
  const then = new Date(`${date}T00:00:00.000Z`).getTime();
  const current = new Date(now).getTime();
  if (Number.isNaN(then) || Number.isNaN(current)) return null;
  return Math.max(0, Math.floor((current - then) / 86_400_000));
}

/**
 * Deterministic eligibility gate. It returns explanations instead of silently
 * discarding roles, so a user can change a preference with full context.
 */
export function evaluatePolicy(jobInput, profile = {}, overrides = {}) {
  const job = isNormalizedJob(jobInput) ? jobInput : normalizeJob(jobInput);
  const blockers = [];
  const warnings = [];
  const matches = [];

  const excludedCompanies = normalizedList(
    preferenceValue(profile, overrides, "excludedCompanies", ["companyBlocklist"]),
  );
  const company = canonicalText(job.company);
  if (excludedCompanies.some((blocked) => blocked === company || company.includes(blocked))) {
    blockers.push(reason("excluded_company", "blocker", `${job.company} is on your company exclusion list.`));
  } else if (excludedCompanies.length) {
    matches.push(reason("company_allowed", "match", `${job.company} is not on your exclusion list.`));
  }

  const targetRoles = normalizedList(preferenceValue(profile, overrides, "targetRoles", ["roles"]));
  if (targetRoles.length) {
    const matchedRole = targetRoles.find((target) => roleMatchesTarget(job.title, target));
    const strictRoleMatching = Boolean(preferenceValue(profile, overrides, "strictRoleMatching"));
    if (matchedRole) {
      matches.push(reason("target_role_match", "match", `${job.title} matches your target role: ${cleanText(matchedRole)}.`));
    } else if (strictRoleMatching) {
      blockers.push(reason("target_role_mismatch", "blocker", `${job.title} does not match one of your target roles.`));
    } else {
      warnings.push(reason("target_role_mismatch", "warning", `${job.title} is outside your stated target roles.`));
    }
  }

  const remotePreference = canonicalText(
    preferenceValue(profile, overrides, "remotePreference", ["workplacePreference"]),
  ).replace(/[\s-]+/g, "_");
  if (remotePreference === "remote_only" && job.workplaceType !== WorkplaceType.REMOTE) {
    blockers.push(reason("remote_only", "blocker", "You only want remote roles."));
  } else if (
    (remotePreference === "remote_or_hybrid" || remotePreference === "remote_hybrid") &&
    job.workplaceType === WorkplaceType.ONSITE
  ) {
    blockers.push(reason("workplace_mismatch", "blocker", "You prefer remote or hybrid roles."));
  } else if (remotePreference && job.workplaceType !== WorkplaceType.UNSPECIFIED) {
    matches.push(reason("workplace_match", "match", `${job.workplaceType} work arrangement is compatible with your preference.`));
  }

  const acceptedLocations = asArray(
    preferenceValue(profile, overrides, "acceptedLocations", ["locations", "preferredLocations"]),
  );
  const locationResult = locationsMatch(job, acceptedLocations);
  if (acceptedLocations.length && !locationResult.known) {
    warnings.push(reason("location_unknown", "warning", "The posting does not provide a usable location."));
  } else if (acceptedLocations.length && !locationResult.matches) {
    blockers.push(reason("location_mismatch", "blocker", `${job.location} is outside your accepted locations.`));
  } else if (acceptedLocations.length && locationResult.matches) {
    matches.push(reason("location_match", "match", `${job.location} is within your accepted locations.`));
  }

  const minimumBaseSalary = preferenceValue(profile, overrides, "minimumBaseSalary", ["salaryFloor"]);
  const salaryFloor = typeof minimumBaseSalary === "number" ? minimumBaseSalary : Number(minimumBaseSalary);
  const annualMinimum = annualizeCompensation(job.compensation);
  const annualMaximum = job.compensation
    ? annualizeCompensation({ ...job.compensation, min: job.compensation.max, max: job.compensation.max })
    : null;
  if (Number.isFinite(salaryFloor) && salaryFloor > 0) {
    if (!job.compensation) {
      warnings.push(reason("compensation_unknown", "warning", "The posting does not disclose base compensation."));
    } else if (job.compensation.currency !== "USD") {
      warnings.push(reason("compensation_currency_unknown", "warning", "Compensation is not in USD, so it was not compared with your salary floor."));
    } else if (annualMaximum !== null && annualMaximum < salaryFloor) {
      blockers.push(reason("salary_below_floor", "blocker", "The listed compensation range is below your minimum base salary."));
    } else if (annualMinimum !== null && annualMinimum < salaryFloor) {
      warnings.push(reason("salary_range_overlap", "warning", "Only part of the listed compensation range reaches your salary floor."));
    } else {
      matches.push(reason("salary_match", "match", "The listed compensation reaches your salary floor."));
    }
  }

  const needsSponsorship = Boolean(
    preferenceValue(profile, overrides, "requiresSponsorship", ["needsSponsorship"]) ??
      profile?.workAuthorization?.requiresSponsorship,
  );
  if (needsSponsorship && job.sponsorship === false) {
    blockers.push(reason("sponsorship_unavailable", "blocker", "This role states that sponsorship is unavailable."));
  } else if (needsSponsorship && job.sponsorship === null) {
    warnings.push(reason("sponsorship_unknown", "warning", "Sponsorship availability is not listed."));
  } else if (needsSponsorship && job.sponsorship === true) {
    matches.push(reason("sponsorship_available", "match", "The posting indicates sponsorship may be available."));
  }

  const profileExperience = Number(profile?.experienceYears ?? profile?.yearsExperience);
  if (job.experience?.minimum !== null && job.experience?.minimum !== undefined && Number.isFinite(profileExperience)) {
    if (profileExperience < job.experience.minimum) {
      const strictExperience = Boolean(preferenceValue(profile, overrides, "strictExperienceMatching"));
      const target = strictExperience ? blockers : warnings;
      target.push(
        reason(
          "experience_gap",
          strictExperience ? "blocker" : "warning",
          `The role lists ${job.experience.minimum}+ years of experience; your profile lists ${profileExperience}.`,
        ),
      );
    } else {
      matches.push(reason("experience_match", "match", "Your listed experience meets the posting's minimum."));
    }
  }

  const maximumJobAgeDays = Number(preferenceValue(profile, overrides, "maximumJobAgeDays"));
  const age = daysSince(job.postedAt, overrides.now ?? new Date().toISOString());
  if (Number.isFinite(maximumJobAgeDays) && maximumJobAgeDays >= 0 && age !== null && age > maximumJobAgeDays) {
    warnings.push(reason("posting_may_be_stale", "warning", `The role was posted ${age} days ago.`));
  }

  const status = blockers.length ? PolicyStatus.INELIGIBLE : PolicyStatus.ELIGIBLE;
  return Object.freeze({
    status,
    eligible: status === PolicyStatus.ELIGIBLE,
    jobId: job.id,
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(warnings),
    matches: Object.freeze(matches),
    reasons: Object.freeze([...blockers, ...warnings, ...matches]),
  });
}

export function summarizePolicy(decision) {
  if (!decision.eligible) return decision.blockers.map((item) => item.message).join(" ");
  if (decision.warnings.length) return decision.warnings.map((item) => item.message).join(" ");
  return "Matches all of your configured hard requirements.";
}

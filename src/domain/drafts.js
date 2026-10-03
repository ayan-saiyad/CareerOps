import { isNormalizedJob, normalizeJob } from "./jobs.js";
import { scoreJobMatch } from "./matching.js";
import { asArray, cleanText, overlap, tokenize, uniqueSkills } from "./utils.js";

function idFor(record, prefix, index) {
  return cleanText(record?.id) || `${prefix}-${index + 1}`;
}

function profileSkills(profile) {
  return uniqueSkills([
    ...asArray(profile?.skills),
    ...asArray(profile?.technicalSkills),
    ...asArray(profile?.experiences).flatMap((experience) => asArray(experience?.skills)),
  ]);
}

function factRecords(profile) {
  const facts = [];
  for (const [index, fact] of asArray(profile?.facts).entries()) {
    const text = cleanText(typeof fact === "string" ? fact : fact?.value ?? fact?.text);
    if (!text) continue;
    facts.push({
      id: idFor(fact, "fact", index),
      type: "profile_fact",
      text,
      skills: uniqueSkills(typeof fact === "object" ? fact.skills ?? fact.tags : []),
    });
  }
  for (const [experienceIndex, experience] of asArray(profile?.experiences).entries()) {
    const experienceSkills = uniqueSkills(experience?.skills);
    for (const [highlightIndex, highlight] of asArray(experience?.highlights ?? experience?.achievements).entries()) {
      const text = cleanText(typeof highlight === "string" ? highlight : highlight?.text ?? highlight?.value);
      if (!text) continue;
      facts.push({
        id: idFor(highlight, `experience-${experienceIndex + 1}-highlight`, highlightIndex),
        type: "experience_highlight",
        text,
        skills: uniqueSkills([
          ...experienceSkills,
          ...asArray(typeof highlight === "object" ? highlight.skills ?? highlight.tags : []),
        ]),
      });
    }
  }
  return facts;
}

function chooseEvidence(profile, job, match) {
  const requirements = new Set(job.requirements);
  const titleWords = new Set(tokenize(job.title));
  const ranked = factRecords(profile)
    .map((fact, index) => {
      const skillHits = overlap(fact.skills, [...requirements]).length;
      const titleHits = tokenize(fact.text).filter((word) => titleWords.has(word)).length;
      return { ...fact, ranking: skillHits * 10 + titleHits + (fact.type === "experience_highlight" ? 1 : 0), index };
    })
    .sort((left, right) => right.ranking - left.ranking || left.index - right.index);

  const evidence = ranked.filter((fact) => fact.ranking > 0).slice(0, 3);
  if (evidence.length) return evidence;

  // If the profile has no tagged facts, preserve an explicit profile fact rather
  // than fabricating a new accomplishment from the role description.
  return ranked.slice(0, match.matchedSkills.length ? 2 : 1);
}

function answer(key, label, value, evidenceIds, options = {}) {
  return Object.freeze({
    key,
    label,
    value: value || null,
    status: value ? "drafted" : "needs_human",
    requiresReview: true,
    sensitive: Boolean(options.sensitive),
    evidenceIds: Object.freeze(evidenceIds),
    note: options.note ?? null,
  });
}

function salaryAnswer(profile) {
  const direct = cleanText(profile?.salaryExpectation ?? profile?.compensationExpectation);
  if (direct) return direct;
  const floor = Number(profile?.preferences?.minimumBaseSalary ?? profile?.minimumBaseSalary);
  if (Number.isFinite(floor) && floor > 0) {
    return `I am targeting a base salary starting at $${floor.toLocaleString("en-US")}, depending on the total compensation package and role scope.`;
  }
  return null;
}

function authorizationAnswer(profile) {
  const direct = cleanText(profile?.workAuthorization?.answer ?? profile?.workAuthorization?.status);
  if (direct) return direct;
  if (typeof profile?.requiresSponsorship === "boolean") {
    return profile.requiresSponsorship ? "I will require employment sponsorship." : "I do not require employment sponsorship.";
  }
  return null;
}

/**
 * Build a review-only application packet. It uses verbatim approved profile
 * evidence and templates; it never infers education, eligibility, outcomes, or
 * credentials that the profile does not contain.
 */
export function buildApplicationDraft(profile = {}, jobInput) {
  const job = isNormalizedJob(jobInput) ? jobInput : normalizeJob(jobInput);
  const match = scoreJobMatch(job, profile);
  const evidence = chooseEvidence(profile, job, match);
  const evidenceIds = evidence.map((item) => item.id);
  const evidenceText = evidence.map((item) => item.text);
  const skills = match.matchedSkills.length ? match.matchedSkills : profileSkills(profile).slice(0, 3);
  const skillClause = skills.length ? `My profile highlights work with ${skills.join(", ")}.` : "";
  const relevantExperience = evidenceText[0] ? `Relevant experience includes: ${evidenceText[0]}` : "";
  const companyName = job.company || "your team";
  const coverLetter = [
    `Dear ${companyName} hiring team,`,
    `I am interested in the ${job.title} role.`,
    skillClause,
    relevantExperience,
    "I would welcome the chance to discuss how this experience could support the team.",
    "Thank you for your consideration.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const interestAnswer = [
    `I am interested in the ${job.title} role at ${companyName}.`,
    skillClause,
    relevantExperience,
  ]
    .filter(Boolean)
    .join(" ");

  const answers = [
    answer("why_this_role", "Why are you interested in this role?", interestAnswer, evidenceIds),
    answer("work_authorization", "Work authorization", authorizationAnswer(profile), [], {
      sensitive: true,
      note: "Confirm the exact legal wording before using it in an application.",
    }),
    answer("salary_expectations", "Salary expectations", salaryAnswer(profile), [], {
      sensitive: true,
      note: "Confirm compensation language before using it in an application.",
    }),
  ];

  const unresolved = answers
    .filter((item) => item.status === "needs_human")
    .map((item) => ({ key: item.key, label: item.label, reason: "No approved profile fact is available." }));

  return Object.freeze({
    version: 1,
    status: "needs_review",
    jobId: job.id,
    jobTitle: job.title,
    company: job.company,
    match,
    tailoredSummary: [skillClause, relevantExperience].filter(Boolean).join(" ") || "No approved matching evidence was found.",
    coverLetter,
    answers: Object.freeze(answers),
    evidence: Object.freeze(evidence.map(({ id, type, text, skills: evidenceSkills }) => Object.freeze({ id, type, text, skills: evidenceSkills }))),
    missingRequirements: Object.freeze(match.missingSkills),
    unresolved: Object.freeze(unresolved.map(Object.freeze)),
    guardrails: Object.freeze([
      "Review every answer before it is copied into an application.",
      "Do not use a draft to answer a question that is not represented by approved profile evidence.",
      "Sensitive eligibility and compensation answers always require individual confirmation.",
    ]),
  });
}

import { asArray, canonicalText, cleanText, uniqueStrings } from "./utils.js";

/**
 * A deliberately small vocabulary for form questions. The resolver does not
 * attempt to answer arbitrary prose from a resume; it recognizes a bounded
 * set of common application fields and only returns values explicitly present
 * in the supplied profile or approved answer library.
 */
export const QuestionKind = Object.freeze({
  UNKNOWN: "unknown",
  COMPANY_TAILORED: "company_tailored",
  CONDITIONAL: "conditional",
  APPROVED_ANSWER: "approved_answer",
  FIRST_NAME: "first_name",
  LAST_NAME: "last_name",
  FULL_NAME: "full_name",
  PREFERRED_NAME: "preferred_name",
  EMAIL: "email",
  PHONE: "phone",
  WEBSITE: "website",
  LINKEDIN: "linkedin",
  GITHUB: "github",
  ADDRESS_LINE1: "address_line1",
  ADDRESS_LINE2: "address_line2",
  POSTAL_CODE: "postal_code",
  LOCATION: "location",
  CITY: "city",
  STATE: "state",
  COUNTRY: "country",
  EDUCATION_SCHOOL: "education_school",
  EDUCATION_DEGREE: "education_degree",
  EDUCATION_FIELD_OF_STUDY: "education_field_of_study",
  EDUCATION_GRADUATION_DATE: "education_graduation_date",
  EDUCATION_GPA: "education_gpa",
  WORK_AUTHORIZATION: "work_authorization",
  SPONSORSHIP: "sponsorship",
  SALARY: "salary",
  START_DATE: "start_date",
  DEMOGRAPHIC: "demographic",
  LEGAL_AGREEMENT: "legal_agreement",
  ATTESTATION: "attestation",
  CONSENT: "consent",
  SIGNATURE: "signature",
  SENSITIVE_LEGAL: "sensitive_legal",
  DOCUMENT_UPLOAD: "document_upload",
});

/**
 * Categories describe why a question receives its handling. They are stable
 * enough for an application adapter to build a dynamic, form-derived plan
 * without assuming that every employer asks the same fields.
 */
export const QuestionCategory = Object.freeze({
  PROFILE: "profile",
  VERIFIED_ELIGIBILITY: "verified_eligibility",
  REUSABLE_PREFERENCE: "reusable_preference",
  APPROVED_RESPONSE: "approved_response",
  COMPANY_TAILORED: "company_tailored",
  CONDITIONAL: "conditional",
  HARD_STOP: "hard_stop",
  UNKNOWN: "unknown",
});

/** The next step an adapter should offer for a resolved form question. */
export const QuestionAction = Object.freeze({
  AUTO_FILL: "auto_fill",
  VERIFIED_AUTO_FILL: "verified_auto_fill",
  REQUEST_INPUT: "request_input",
  MANUAL_ONLY: "manual_only",
});

/** Buckets used by a FillPlan: routine fields, verified facts, exact approved responses, prompts, and hard stops. */
export const FormAnswerBucket = Object.freeze({
  FIELDS: "fields",
  VERIFIED_QUESTIONS: "verifiedQuestions",
  APPROVED_QUESTIONS: "approvedQuestions",
  PROMPT: "prompt",
  REVIEW_ONLY: "reviewOnly",
});

const YES_OPTIONS = new Set(["yes", "y", "true"]);
const NO_OPTIONS = new Set(["no", "n", "false"]);

const DEMOGRAPHIC_PATTERN = /\b(?:eeo|equal employment|gender|sex(?:ual)?|race|ethnic(?:ity|ity)|veteran|disab(?:ility|led)|self[ -]?identif|pronoun|sexual orientation|religion|marital status|date of birth|birth date|\bdob\b|age)\b/;
const SENSITIVE_LEGAL_PATTERN = /\b(?:social security|\bssn\b|passport|national id|tax id|driver'?s license|criminal history|background check|security clearance|password|passcode|credential|log[ -]?in|sign[ -]?in)\b/;
const DOCUMENT_PATTERN = /\b(?:resume|résumé|curriculum vitae|\bcv\b|cover letter|portfolio upload|attachment|upload)\b/;
const LEGAL_AGREEMENT_PATTERN = /\b(?:terms (?:and|&) conditions|terms of (?:use|service)|privacy (?:policy|notice)|i agree|agreement|acknowledg(?:e|ement)|waiver|release of claims)\b/;
const ATTESTATION_PATTERN = /\b(?:attest(?:ation)?|certif(?:y|ication)|declare(?:d)? (?:that|the)|swear|affirm)\b/;
const CONSENT_PATTERN = /\b(?:consent|authorize|authorization|permission|opt[ -]?in|opt[ -]?out)\b/;
const SIGNATURE_PATTERN = /\b(?:signature|sign here|electronic signature|typed signature)\b/;
const COMPANY_TAILORED_PATTERN = /\b(?:why (?:are|do) you (?:interested|want)|why (?:this|our) (?:role|company|position|team)|what (?:interests|excites|attracts) you|why should we hire|what makes you (?:a |the )?(?:good )?fit|how did you hear about us|tell us (?:about|why)|describe (?:your|a|an) (?:experience|project|achievement)|what (?:experience|skills).*(?:relevant|fit|bring))\b/;

function canonicalQuestionText(value) {
  return cleanText(value)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")
    .replace(/[_./\\[\]()-]+/g, " ")
    .replace(/[^\p{L}\p{N}+#]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalQuestionValue(value) {
  return canonicalText(canonicalQuestionText(value));
}

function atomicValue(value) {
  if (typeof value === "string") return cleanText(value) || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value;
  return null;
}

function normalizeOptions(options) {
  const seen = new Set();
  const result = [];

  for (const option of asArray(options)) {
    const isRecord = option && typeof option === "object";
    const label = cleanText(isRecord ? option.label ?? option.text ?? option.name : option);
    const value = cleanText(isRecord ? option.value ?? option.id ?? option.key ?? label : option);
    const display = label || value;
    if (!display) continue;

    const key = `${canonicalQuestionValue(display)}\u0000${canonicalQuestionValue(value || display)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(Object.freeze({ label: display, value: value || display }));
  }

  return Object.freeze(result);
}

function contextText(value) {
  if (typeof value === "string" || typeof value === "number") return cleanText(value);
  if (Array.isArray(value)) return value.map(contextText).filter(Boolean).join(" ");
  if (!value || typeof value !== "object") return "";
  return [value.label, value.title, value.name, value.text, value.description]
    .map(contextText)
    .filter(Boolean)
    .join(" ");
}

function firstText(record, paths) {
  for (const path of paths) {
    let value = record;
    for (const segment of path.split(".")) {
      if (!value || typeof value !== "object" || !(segment in value)) {
        value = undefined;
        break;
      }
      value = value[segment];
    }
    const text = atomicValue(value);
    if (text !== null) return { path, value: text };
  }
  return null;
}

function sourceId(profile, path) {
  const profileId = cleanText(profile?.id) || "profile";
  return `profile:${profileId}:${path}`;
}

function sourceFromPaths(profile, paths) {
  const found = firstText(profile, paths);
  if (!found) return null;
  return Object.freeze({
    value: found.value,
    evidenceIds: Object.freeze([sourceId(profile, found.path)]),
    source: found.path,
  });
}

function uniqueEvidenceIds(values) {
  return Object.freeze(uniqueStrings(values, cleanText));
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  const text = canonicalQuestionValue(value);
  if (YES_OPTIONS.has(text)) return true;
  if (NO_OPTIONS.has(text)) return false;
  return null;
}

function booleanMetadata(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = canonicalQuestionValue(value);
  if (["true", "yes", "required", "mandatory", "1"].includes(text)) return true;
  if (["false", "no", "optional", "0", ""].includes(text)) return false;
  return null;
}

function firstMetadataBoolean(record, keys) {
  for (const key of keys) {
    if (!record || typeof record !== "object" || !(key in record)) continue;
    const value = booleanMetadata(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function hasQuestionDependency(record) {
  if (!record || typeof record !== "object") return false;
  const explicit = firstMetadataBoolean(record, ["conditional", "isConditional"]);
  if (explicit !== null) return explicit;
  return ["dependsOn", "condition", "showWhen", "parentQuestionId", "parentFieldId"]
    .some((key) => {
      const value = record[key];
      if (Array.isArray(value)) return value.length > 0;
      if (value && typeof value === "object") return Object.keys(value).length > 0;
      return Boolean(cleanText(value));
    });
}

function isQuestionPresent(record) {
  const present = firstMetadataBoolean(record, ["present", "isPresent", "rendered", "isRendered", "visible", "isVisible"]);
  if (present === false) return false;
  const hidden = firstMetadataBoolean(record, ["hidden", "isHidden"]);
  return hidden !== true;
}

function optionForValue(question, value) {
  const text = atomicValue(value);
  if (text === null) return null;
  if (question.options.length === 0) return { value: text };

  const target = canonicalQuestionValue(text);
  const matchingOption = question.options.find(
    (option) => canonicalQuestionValue(option.label) === target || canonicalQuestionValue(option.value) === target,
  );
  return matchingOption ? { value: matchingOption.value } : null;
}

function optionForBoolean(question, value) {
  if (typeof value !== "boolean") return null;
  if (question.options.length === 0) return { value: value ? "Yes" : "No" };

  const expected = value ? YES_OPTIONS : NO_OPTIONS;
  const matchingOption = question.options.find(
    (option) => expected.has(canonicalQuestionValue(option.label)) || expected.has(canonicalQuestionValue(option.value)),
  );
  return matchingOption ? { value: matchingOption.value } : null;
}

function candidate({
  kind,
  value,
  confidence,
  evidenceIds,
  source,
  note = null,
  reviewRequired = false,
  sensitive = false,
  verified = false,
}) {
  const text = atomicValue(value);
  if (text === null) return null;
  return Object.freeze({
    kind,
    value: text,
    confidence,
    evidenceIds: uniqueEvidenceIds(evidenceIds),
    source,
    note,
    reviewRequired: Boolean(reviewRequired || sensitive),
    sensitive: Boolean(sensitive),
    verified: Boolean(verified),
    unsupported: false,
  });
}

function candidateFromSource(question, kind, source, options = {}) {
  if (!source) return null;
  const fitted = optionForValue(question, source.value);
  if (!fitted) return null;
  return candidate({
    kind,
    value: fitted.value,
    confidence: options.confidence ?? 0.97,
    evidenceIds: source.evidenceIds,
    source: source.source,
    note: options.note,
    reviewRequired: options.reviewRequired,
    sensitive: options.sensitive,
    verified: options.verified,
  });
}

function candidateFromBoolean(question, kind, source, options = {}) {
  if (!source) return null;
  const boolean = normalizeBoolean(source.value);
  if (boolean === null) return null;
  const fitted = optionForBoolean(question, boolean);
  if (!fitted) return null;
  return candidate({
    kind,
    value: fitted.value,
    confidence: options.confidence ?? 0.97,
    evidenceIds: source.evidenceIds,
    source: source.source,
    note: options.note,
    reviewRequired: options.reviewRequired,
    sensitive: options.sensitive,
    verified: options.verified,
  });
}

function contactSource(profile, field) {
  const paths = {
    firstName: ["firstName", "givenName", "contact.firstName", "contact.givenName", "personal.firstName"],
    lastName: ["lastName", "familyName", "surname", "contact.lastName", "contact.familyName", "personal.lastName"],
    fullName: ["fullName", "name", "contact.fullName", "contact.name", "personal.fullName"],
    preferredName: ["preferredName", "contact.preferredName", "personal.preferredName"],
    email: ["email", "emailAddress", "contact.email", "contact.emailAddress", "personal.email"],
    phone: ["phone", "phoneNumber", "mobile", "contact.phone", "contact.phoneNumber", "contact.mobile"],
    website: ["website", "portfolio", "personalWebsite", "links.website", "links.portfolio", "contact.website"],
    linkedin: ["linkedin", "linkedIn", "links.linkedin", "links.linkedIn", "social.linkedin", "contact.linkedin"],
    github: ["github", "gitHub", "links.github", "links.gitHub", "social.github", "contact.github"],
    addressLine1: ["addressLine1", "address.line1", "address.street1", "streetAddress", "contact.addressLine1", "contact.address.line1", "location.addressLine1"],
    addressLine2: ["addressLine2", "address.line2", "address.street2", "contact.addressLine2", "contact.address.line2", "location.addressLine2"],
    postalCode: ["postalCode", "zip", "zipCode", "address.postalCode", "address.zip", "address.zipCode", "contact.postalCode", "location.postalCode"],
    location: ["location", "contact.location", "personal.location"],
    city: ["city", "contact.city", "location.city", "address.city"],
    state: ["state", "region", "contact.state", "location.state", "address.state"],
    country: ["country", "contact.country", "location.country", "address.country"],
  };
  return sourceFromPaths(profile, paths[field] ?? []);
}

function fullNameSource(profile) {
  const direct = contactSource(profile, "fullName");
  if (direct) return direct;

  const firstName = contactSource(profile, "firstName");
  const lastName = contactSource(profile, "lastName");
  if (!firstName || !lastName) return null;
  return Object.freeze({
    value: `${firstName.value} ${lastName.value}`,
    evidenceIds: uniqueEvidenceIds([...firstName.evidenceIds, ...lastName.evidenceIds]),
    source: "firstName + lastName",
  });
}

function educationRecords(profile) {
  return asArray(profile?.education ?? profile?.educations ?? profile?.educationHistory)
    .filter((record) => record && typeof record === "object")
    .map((record, index) => Object.freeze({ record, index }));
}

function educationCandidates(profile, question, kind) {
  const fields = {
    [QuestionKind.EDUCATION_SCHOOL]: ["school", "schoolName", "institution", "institutionName", "university", "college"],
    [QuestionKind.EDUCATION_DEGREE]: ["degree", "degreeName", "qualification"],
    [QuestionKind.EDUCATION_FIELD_OF_STUDY]: ["fieldOfStudy", "major", "field", "concentration"],
    [QuestionKind.EDUCATION_GRADUATION_DATE]: ["graduationDate", "graduation", "graduatedAt", "endDate"],
    [QuestionKind.EDUCATION_GPA]: ["gpa", "gradePointAverage"],
  };

  const candidates = [];
  for (const { record, index } of educationRecords(profile)) {
    const found = firstText(record, fields[kind] ?? []);
    if (!found) continue;
    const fitted = optionForValue(question, found.value);
    if (!fitted) continue;
    const recordId = cleanText(record.id) || `education-${index + 1}`;
    const evidenceId = cleanText(record.id) || sourceId(profile, `education.${index}.${found.path}`);
    const educationCandidate = candidate({
      kind,
      value: fitted.value,
      confidence: 0.94,
      evidenceIds: [evidenceId],
      source: `education:${recordId}.${found.path}`,
      reviewRequired: false,
    });
    if (educationCandidate) candidates.push(educationCandidate);
  }
  return candidates;
}

function approvedAnswerCandidates(profile, question) {
  // A DOM-derived canonical question may concatenate a visible label with a
  // technical field name and surrounding context. An approved library answer
  // may match one of those user-visible prompts exactly without matching the
  // entire concatenated string. We still require an exact equality with at
  // least one individual label/ARIA/name fragment—never fuzzy similarity.
  const questionKeys = new Set(
    [question.canonical, question.label, question.ariaLabel, question.name]
      .map(canonicalQuestionValue)
      .filter(Boolean),
  );
  if (questionKeys.size === 0) return [];

  const answers = [
    ...asArray(profile?.answerLibrary),
    ...asArray(profile?.approvedAnswers),
    ...asArray(profile?.screeningAnswers),
  ];
  const candidates = [];
  const seen = new Set();

  for (const [index, answer] of answers.entries()) {
    if (!answer || typeof answer !== "object") continue;
    const prompts = [answer.question, answer.label, answer.prompt, ...asArray(answer.aliases)]
      .map(canonicalQuestionValue)
      .filter(Boolean);
    if (!prompts.some((prompt) => questionKeys.has(prompt))) continue;

    const value = firstText(answer, ["value", "answer", "text"]);
    if (!value) continue;
    const fitted = optionForValue(question, value.value);
    if (!fitted) continue;
    const id = cleanText(answer.id) || `approved-answer-${index + 1}`;
    const dedupeKey = `${canonicalQuestionValue(fitted.value)}\u0000${id}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const approved = candidate({
      kind: QuestionKind.APPROVED_ANSWER,
      value: fitted.value,
      confidence: 0.9,
      evidenceIds: [id],
      source: `approvedAnswer:${id}`,
      note: "Exact match from the approved answer library.",
    });
    if (approved) candidates.push(approved);
  }
  return candidates;
}

function words(question) {
  return ` ${question.canonical} `;
}

function hasExactPhrase(value, phrase) {
  const normalizedValue = canonicalQuestionValue(value);
  const normalizedPhrase = canonicalQuestionValue(phrase);
  return Boolean(normalizedPhrase) && ` ${normalizedValue} `.includes(` ${normalizedPhrase} `);
}

function visibleQuestionText(question) {
  return [question.label, question.ariaLabel]
    .map(canonicalQuestionValue)
    .filter(Boolean)
    .join(" ");
}

const PROFILE_KINDS = new Set([
  QuestionKind.FIRST_NAME,
  QuestionKind.LAST_NAME,
  QuestionKind.FULL_NAME,
  QuestionKind.PREFERRED_NAME,
  QuestionKind.EMAIL,
  QuestionKind.PHONE,
  QuestionKind.WEBSITE,
  QuestionKind.LINKEDIN,
  QuestionKind.GITHUB,
  QuestionKind.ADDRESS_LINE1,
  QuestionKind.ADDRESS_LINE2,
  QuestionKind.POSTAL_CODE,
  QuestionKind.LOCATION,
  QuestionKind.CITY,
  QuestionKind.STATE,
  QuestionKind.COUNTRY,
  QuestionKind.EDUCATION_SCHOOL,
  QuestionKind.EDUCATION_DEGREE,
  QuestionKind.EDUCATION_FIELD_OF_STUDY,
  QuestionKind.EDUCATION_GRADUATION_DATE,
  QuestionKind.EDUCATION_GPA,
]);

const HARD_STOP_KINDS = new Set([
  QuestionKind.DEMOGRAPHIC,
  QuestionKind.LEGAL_AGREEMENT,
  QuestionKind.ATTESTATION,
  QuestionKind.CONSENT,
  QuestionKind.SIGNATURE,
  QuestionKind.SENSITIVE_LEGAL,
  QuestionKind.DOCUMENT_UPLOAD,
]);

function decisionForKind(kind) {
  if (PROFILE_KINDS.has(kind)) {
    return {
      category: QuestionCategory.PROFILE,
      action: QuestionAction.AUTO_FILL,
      planBucket: FormAnswerBucket.FIELDS,
      unsupported: false,
    };
  }
  if (kind === QuestionKind.WORK_AUTHORIZATION || kind === QuestionKind.SPONSORSHIP) {
    return {
      category: QuestionCategory.VERIFIED_ELIGIBILITY,
      action: QuestionAction.VERIFIED_AUTO_FILL,
      planBucket: FormAnswerBucket.VERIFIED_QUESTIONS,
      unsupported: false,
    };
  }
  if (kind === QuestionKind.SALARY || kind === QuestionKind.START_DATE) {
    return {
      category: QuestionCategory.REUSABLE_PREFERENCE,
      action: QuestionAction.REQUEST_INPUT,
      planBucket: FormAnswerBucket.PROMPT,
      unsupported: false,
    };
  }
  if (kind === QuestionKind.APPROVED_ANSWER) {
    return {
      category: QuestionCategory.APPROVED_RESPONSE,
      action: QuestionAction.AUTO_FILL,
      // A tailored response is never a reusable profile field. It can only
      // travel in the exact-question approval channel after the candidate has
      // authored and approved that answer for this prompt.
      planBucket: FormAnswerBucket.APPROVED_QUESTIONS,
      unsupported: false,
    };
  }
  if (kind === QuestionKind.CONDITIONAL) {
    return {
      category: QuestionCategory.CONDITIONAL,
      action: QuestionAction.REQUEST_INPUT,
      planBucket: FormAnswerBucket.PROMPT,
      unsupported: false,
    };
  }
  if (kind === QuestionKind.COMPANY_TAILORED) {
    return {
      category: QuestionCategory.COMPANY_TAILORED,
      action: QuestionAction.REQUEST_INPUT,
      planBucket: FormAnswerBucket.PROMPT,
      unsupported: false,
    };
  }
  if (HARD_STOP_KINDS.has(kind)) {
    return {
      category: QuestionCategory.HARD_STOP,
      action: QuestionAction.MANUAL_ONLY,
      planBucket: FormAnswerBucket.REVIEW_ONLY,
      unsupported: true,
    };
  }
  return {
    category: QuestionCategory.UNKNOWN,
    action: QuestionAction.REQUEST_INPUT,
    planBucket: FormAnswerBucket.PROMPT,
    unsupported: true,
  };
}

function classified(kind, options = {}) {
  const decision = decisionForKind(kind);
  return {
    kind,
    category: options.category ?? decision.category,
    action: options.action ?? decision.action,
    planBucket: options.planBucket ?? decision.planBucket,
    sensitive: Boolean(options.sensitive),
    unsupported: options.unsupported ?? decision.unsupported,
    reason: options.reason ?? null,
  };
}

function classifyNormalizedQuestion(question) {
  const text = words(question);
  const fieldName = canonicalQuestionValue(question.name);
  const visibleText = visibleQuestionText(question);

  if (DEMOGRAPHIC_PATTERN.test(text)) {
    return classified(QuestionKind.DEMOGRAPHIC, { sensitive: true, reason: "Demographic and EEO questions are always completed by the applicant." });
  }
  if (DOCUMENT_PATTERN.test(text) || (/\bfile\b/.test(text) && /\bresume\b|\bcv\b|\bcover letter\b/.test(text))) {
    return classified(QuestionKind.DOCUMENT_UPLOAD, { sensitive: true, reason: "Document uploads are handled outside the answer resolver." });
  }
  if (SIGNATURE_PATTERN.test(text) || question.inputType === "signature") {
    return classified(QuestionKind.SIGNATURE, { sensitive: true, reason: "Signatures are always completed by the applicant." });
  }
  if (LEGAL_AGREEMENT_PATTERN.test(text)) {
    return classified(QuestionKind.LEGAL_AGREEMENT, { sensitive: true, reason: "Legal agreements and acknowledgements always require the applicant's action." });
  }
  if (ATTESTATION_PATTERN.test(text)) {
    return classified(QuestionKind.ATTESTATION, { sensitive: true, reason: "Attestations and certifications always require the applicant's action." });
  }
  if (/\b(?:sponsor(?:ship)?|visa)\b/.test(text) && /\b(?:require|need|future|now)\b/.test(text)) {
    return classified(QuestionKind.SPONSORSHIP);
  }
  if (/\b(?:work authori[sz]ation|authorized to work|eligible to work|right to work|legally (?:authorized|allowed) to work)\b/.test(text)) {
    return classified(QuestionKind.WORK_AUTHORIZATION);
  }
  if (CONSENT_PATTERN.test(text)) {
    return classified(QuestionKind.CONSENT, { sensitive: true, reason: "Consent and permission choices always require the applicant's action." });
  }
  if (SENSITIVE_LEGAL_PATTERN.test(text)) {
    return classified(QuestionKind.SENSITIVE_LEGAL, { sensitive: true, reason: "This credential, identity, or sensitive legal field is never auto-answered." });
  }
  if (question.conditional) {
    return classified(QuestionKind.CONDITIONAL, { reason: "This question is conditional on another response and needs applicant input." });
  }
  if (/\b(?:salary|compensation|desired pay|pay expectation|pay rate|hourly rate|base pay)\b/.test(text)) {
    return classified(QuestionKind.SALARY, { sensitive: true });
  }
  if (/\b(?:start date|available to start|availability|notice period|earliest start)\b/.test(text)) {
    return classified(QuestionKind.START_DATE);
  }
  if (COMPANY_TAILORED_PATTERN.test(text)) {
    return classified(QuestionKind.COMPANY_TAILORED, { reason: "This company-tailored prompt needs an applicant-specific response." });
  }
  if (/\blinkedin\b/.test(text) || fieldName.includes("linkedin")) {
    return classified(QuestionKind.LINKEDIN);
  }
  if (/\bgithub\b|\bgit hub\b/.test(text) || fieldName.includes("github") || fieldName.includes("gith ub")) {
    return classified(QuestionKind.GITHUB);
  }
  if (/\b(?:website|portfolio|personal site)\b/.test(text) || fieldName.includes("website") || fieldName.includes("portfolio")) {
    return classified(QuestionKind.WEBSITE);
  }
  if (/\b(?:address line ?2|street address 2|apt(?:artment)?|suite|unit)\b/.test(text) || /(?:addressline2|street2|apartment|suite|unit)/.test(fieldName)) {
    return classified(QuestionKind.ADDRESS_LINE2);
  }
  if (/\b(?:address line ?1|street address|street line|mailing address)\b/.test(text) || /(?:addressline1|streetaddress|street1)/.test(fieldName)) {
    return classified(QuestionKind.ADDRESS_LINE1);
  }
  if (/\b(?:postal code|zip code|\bzip\b)\b/.test(text) || /(?:postalcode|zipcode|\bzip\b)/.test(fieldName)) {
    return classified(QuestionKind.POSTAL_CODE);
  }
  if (/\b(?:email|e mail)\b/.test(text) || fieldName.includes("email")) {
    return classified(QuestionKind.EMAIL);
  }
  if (/\b(?:phone|mobile|telephone)\b/.test(text) || fieldName.includes("phone") || fieldName.includes("mobile")) {
    return classified(QuestionKind.PHONE);
  }
  if (/\b(?:first|given) name\b/.test(text) || /(?:first|given)name/.test(fieldName)) {
    return classified(QuestionKind.FIRST_NAME);
  }
  if (/\b(?:last|family) name\b|\bsurname\b/.test(text) || /(?:last|family)name|surname/.test(fieldName)) {
    return classified(QuestionKind.LAST_NAME);
  }
  if (/\bpreferred name\b/.test(text) || fieldName.includes("preferredname")) {
    return classified(QuestionKind.PREFERRED_NAME);
  }
  if (/\b(?:full name|your name)\b/.test(text) || ["name", "full name", "fullname"].includes(fieldName) || ["name", "your name", "full name", "legal name"].includes(visibleText)) {
    if (hasExactPhrase(visibleText, "legal name")) {
      return classified(QuestionKind.SENSITIVE_LEGAL, { sensitive: true, reason: "Legal-name fields require individual confirmation." });
    }
    return classified(QuestionKind.FULL_NAME);
  }
  if (/\b(?:field of study|major|concentration)\b/.test(text) || fieldName.includes("fieldofstudy") || fieldName.includes("major")) {
    return classified(QuestionKind.EDUCATION_FIELD_OF_STUDY);
  }
  if (/\b(?:graduation|graduate(?:d)?|degree completion)\b/.test(text) || fieldName.includes("graduation")) {
    return classified(QuestionKind.EDUCATION_GRADUATION_DATE);
  }
  if (/\b(?:gpa|grade point average)\b/.test(text) || fieldName === "gpa") {
    return classified(QuestionKind.EDUCATION_GPA);
  }
  if (/\bdegree\b/.test(text) || fieldName.includes("degree")) {
    return classified(QuestionKind.EDUCATION_DEGREE);
  }
  if (/\b(?:school|university|college|institution)\b/.test(text) || fieldName.includes("school") || fieldName.includes("university")) {
    return classified(QuestionKind.EDUCATION_SCHOOL);
  }
  if (/\bcity\b/.test(text) || fieldName === "city") {
    return classified(QuestionKind.CITY);
  }
  if (/\b(?:state|province|region)\b/.test(text) || /(?:state|province|region)/.test(fieldName)) {
    return classified(QuestionKind.STATE);
  }
  if (/\bcountry\b/.test(text) || fieldName === "country") {
    return classified(QuestionKind.COUNTRY);
  }
  if (/\b(?:location|where (?:are|do) you (?:live|located)|current address)\b/.test(text) || ["location", "current location"].includes(fieldName)) {
    return classified(QuestionKind.LOCATION);
  }

  return classified(QuestionKind.UNKNOWN, { reason: "No deterministic, approved answer rule matches this question." });
}

function candidatesForKind(profile, question, kind) {
  switch (kind) {
    case QuestionKind.FIRST_NAME:
      return [candidateFromSource(question, kind, contactSource(profile, "firstName"))].filter(Boolean);
    case QuestionKind.LAST_NAME:
      return [candidateFromSource(question, kind, contactSource(profile, "lastName"))].filter(Boolean);
    case QuestionKind.FULL_NAME:
      return [candidateFromSource(question, kind, fullNameSource(profile))].filter(Boolean);
    case QuestionKind.PREFERRED_NAME:
      return [candidateFromSource(question, kind, contactSource(profile, "preferredName"))].filter(Boolean);
    case QuestionKind.EMAIL:
      return [candidateFromSource(question, kind, contactSource(profile, "email"))].filter(Boolean);
    case QuestionKind.PHONE:
      return [candidateFromSource(question, kind, contactSource(profile, "phone"))].filter(Boolean);
    case QuestionKind.WEBSITE:
      return [candidateFromSource(question, kind, contactSource(profile, "website"))].filter(Boolean);
    case QuestionKind.LINKEDIN:
      return [candidateFromSource(question, kind, contactSource(profile, "linkedin"))].filter(Boolean);
    case QuestionKind.GITHUB:
      return [candidateFromSource(question, kind, contactSource(profile, "github"))].filter(Boolean);
    case QuestionKind.ADDRESS_LINE1:
      return [candidateFromSource(question, kind, contactSource(profile, "addressLine1"))].filter(Boolean);
    case QuestionKind.ADDRESS_LINE2:
      return [candidateFromSource(question, kind, contactSource(profile, "addressLine2"))].filter(Boolean);
    case QuestionKind.POSTAL_CODE:
      return [candidateFromSource(question, kind, contactSource(profile, "postalCode"))].filter(Boolean);
    case QuestionKind.LOCATION:
      return [candidateFromSource(question, kind, contactSource(profile, "location"))].filter(Boolean);
    case QuestionKind.CITY:
      return [candidateFromSource(question, kind, contactSource(profile, "city"))].filter(Boolean);
    case QuestionKind.STATE:
      return [candidateFromSource(question, kind, contactSource(profile, "state"))].filter(Boolean);
    case QuestionKind.COUNTRY:
      return [candidateFromSource(question, kind, contactSource(profile, "country"))].filter(Boolean);
    case QuestionKind.EDUCATION_SCHOOL:
    case QuestionKind.EDUCATION_DEGREE:
    case QuestionKind.EDUCATION_FIELD_OF_STUDY:
    case QuestionKind.EDUCATION_GRADUATION_DATE:
    case QuestionKind.EDUCATION_GPA:
      return educationCandidates(profile, question, kind);
    case QuestionKind.WORK_AUTHORIZATION:
      return authorizationCandidates(profile, question);
    case QuestionKind.SPONSORSHIP:
      return sponsorshipCandidates(profile, question);
    case QuestionKind.SALARY:
      return salaryCandidates(profile, question);
    case QuestionKind.START_DATE:
      return startDateCandidates(profile, question);
    default:
      return [];
  }
}

function authorizationCandidates(profile, question) {
  const booleanSource = sourceFromPaths(profile, [
    "authorizedToWork",
    "workAuthorized",
    "workAuthorization.authorized",
    "workAuthorization.isAuthorized",
    "workAuthorization.authorizedToWork",
  ]);
  const booleanCandidate = candidateFromBoolean(question, QuestionKind.WORK_AUTHORIZATION, booleanSource, {
    verified: true,
    note: "Verified from the applicant's reusable work-authorization profile field.",
  });
  if (booleanCandidate) return [booleanCandidate];

  const answerSource = sourceFromPaths(profile, ["workAuthorization.answer", "workAuthorization.status", "workAuthorizationAnswer"]);
  return [
    candidateFromSource(question, QuestionKind.WORK_AUTHORIZATION, answerSource, {
      confidence: 0.9,
      reviewRequired: true,
      note: "A free-text authorization statement needs applicant confirmation before use.",
    }),
  ].filter(Boolean);
}

function sponsorshipCandidates(profile, question) {
  const booleanSource = sourceFromPaths(profile, [
    "requiresSponsorship",
    "workAuthorization.requiresSponsorship",
    "workAuthorization.needsSponsorship",
    "sponsorshipRequired",
  ]);
  const booleanCandidate = candidateFromBoolean(question, QuestionKind.SPONSORSHIP, booleanSource, {
    verified: true,
    note: "Verified from the applicant's reusable sponsorship profile field.",
  });
  if (booleanCandidate) return [booleanCandidate];

  const answerSource = sourceFromPaths(profile, ["sponsorshipAnswer", "workAuthorization.sponsorshipAnswer"]);
  return [
    candidateFromSource(question, QuestionKind.SPONSORSHIP, answerSource, {
      confidence: 0.9,
      reviewRequired: true,
      note: "A free-text sponsorship statement needs applicant confirmation before use.",
    }),
  ].filter(Boolean);
}

function salaryCandidates(profile, question) {
  const direct = sourceFromPaths(profile, [
    "salaryExpectation",
    "compensationExpectation",
    "desiredSalary",
    "salary.answer",
    "compensation.answer",
  ]);
  const fallback = sourceFromPaths(profile, ["preferences.minimumBaseSalary", "minimumBaseSalary"]);
  const source = direct ?? fallback;
  const result = candidateFromSource(question, QuestionKind.SALARY, source, {
    confidence: direct ? 0.94 : 0.72,
    sensitive: true,
    reviewRequired: true,
    note: direct ? "Confirm compensation wording before use." : "This is a minimum base-salary preference, not a complete compensation answer.",
  });
  return result ? [result] : [];
}

function startDateCandidates(profile, question) {
  const source = sourceFromPaths(profile, [
    "startDate",
    "availableStartDate",
    "availability",
    "startDateAnswer",
    "employmentAvailability",
  ]);
  const result = candidateFromSource(question, QuestionKind.START_DATE, source, {
    confidence: 0.92,
    reviewRequired: true,
    note: "Availability can change; confirm before use.",
  });
  return result ? [result] : [];
}

function promptDecision(classification) {
  return {
    ...classification,
    action: QuestionAction.REQUEST_INPUT,
    planBucket: FormAnswerBucket.PROMPT,
  };
}

function decisionForResolution(classification, candidates, selected) {
  if (classification.action === QuestionAction.MANUAL_ONLY || classification.kind === QuestionKind.CONDITIONAL) {
    return classification;
  }
  if (!selected || candidates.length !== 1) return promptDecision(classification);

  if (
    (classification.kind === QuestionKind.WORK_AUTHORIZATION || classification.kind === QuestionKind.SPONSORSHIP) &&
    !selected.verified
  ) {
    return promptDecision(classification);
  }
  if (selected.reviewRequired || selected.sensitive) return promptDecision(classification);
  return classification;
}

function resolution(question, classification, candidates) {
  const sortedCandidates = Object.freeze([...candidates].sort((left, right) => right.confidence - left.confidence));
  const unambiguous = sortedCandidates.length === 1;
  const selected = unambiguous ? sortedCandidates[0] : null;
  const decision = decisionForResolution(classification, sortedCandidates, selected);
  const evidenceIds = uniqueEvidenceIds(sortedCandidates.flatMap((item) => item.evidenceIds));
  const sensitive = Boolean(classification.sensitive || sortedCandidates.some((item) => item.sensitive));
  const acceptsPromptWithoutCandidate = classification.kind === QuestionKind.COMPANY_TAILORED || classification.kind === QuestionKind.CONDITIONAL;
  const unsupported = Boolean(classification.unsupported || (sortedCandidates.length === 0 && !acceptsPromptWithoutCandidate));
  const autoFillEligible = decision.action === QuestionAction.AUTO_FILL || decision.action === QuestionAction.VERIFIED_AUTO_FILL;
  const reviewRequired = !autoFillEligible;

  let reason = classification.reason ?? null;
  if (!reason && sortedCandidates.length === 0) {
    reason = acceptsPromptWithoutCandidate
      ? "This application-specific question needs input from the applicant."
      : "No approved profile value matched this question and its available options.";
  } else if (!reason && sortedCandidates.length > 1) {
    reason = "Multiple approved profile values match; select one during review.";
  } else if (!reason && decision.action === QuestionAction.REQUEST_INPUT) {
    reason = "This answer needs applicant input or confirmation before use.";
  }

  return Object.freeze({
    version: 1,
    question,
    kind: classification.kind,
    category: decision.category,
    action: decision.action,
    planBucket: decision.planBucket,
    required: question.required,
    present: question.present,
    conditional: question.conditional,
    candidates: sortedCandidates,
    value: selected?.value ?? null,
    confidence: selected?.confidence ?? 0,
    evidenceIds,
    verified: Boolean(selected?.verified),
    autoFillEligible,
    needsUserInput: decision.action === QuestionAction.REQUEST_INPUT,
    manualOnly: decision.action === QuestionAction.MANUAL_ONLY,
    reviewRequired,
    sensitive,
    unsupported,
    status: decision.action === QuestionAction.MANUAL_ONLY
      ? "manual_only"
      : decision.action === QuestionAction.REQUEST_INPUT
        ? "needs_input"
        : "resolved",
    reason,
  });
}

function normalizedQuestion(value) {
  return Boolean(value && typeof value === "object" && typeof value.canonical === "string" && Array.isArray(value.options));
}

/**
 * Normalize labels, DOM names/ids, ARIA labels, placeholders, and surrounding
 * context into one comparison-safe question. This function does not inspect
 * current form values, credentials, or arbitrary page content.
 */
export function normalizeFormQuestion(questionInput = {}) {
  if (normalizedQuestion(questionInput)) return questionInput;
  const source = typeof questionInput === "string" ? { label: questionInput } : questionInput && typeof questionInput === "object" ? questionInput : {};
  const label = cleanText(source.label ?? source.question ?? source.title ?? source.text);
  const name = cleanText(source.name ?? source.fieldName ?? source.field);
  const id = cleanText(source.id ?? source.fieldId);
  const ariaLabel = cleanText(source.ariaLabel ?? source["aria-label"]);
  const placeholder = cleanText(source.placeholder);
  const context = contextText(source.context ?? source.section ?? source.groupLabel ?? source.description ?? source.helpText);
  const inputType = cleanText(source.inputType ?? source.type ?? source.controlType).toLowerCase();
  const required = firstMetadataBoolean(source, ["required", "isRequired", "ariaRequired", "aria-required", "mandatory"]) ?? false;
  const present = isQuestionPresent(source);
  const conditional = hasQuestionDependency(source);
  const fragments = [label, name, id, ariaLabel, placeholder, context].map(canonicalQuestionText).filter(Boolean);
  const text = fragments.join(" ");

  return Object.freeze({
    label,
    name,
    id,
    ariaLabel,
    placeholder,
    context,
    inputType,
    required,
    present,
    conditional,
    text,
    canonical: canonicalQuestionValue(text),
    tokens: Object.freeze(canonicalQuestionValue(text).split(" ").filter(Boolean)),
    options: normalizeOptions(source.options ?? source.choices ?? source.values),
  });
}

/** Classify a normalized form question without looking at applicant data. */
export function classifyFormQuestion(questionInput = {}) {
  const question = normalizeFormQuestion(questionInput);
  const classification = classifyNormalizedQuestion(question);
  return Object.freeze({
    question,
    kind: classification.kind,
    category: classification.category,
    action: classification.action,
    planBucket: classification.planBucket,
    required: question.required,
    present: question.present,
    conditional: question.conditional,
    sensitive: Boolean(classification.sensitive),
    unsupported: Boolean(classification.unsupported),
    reason: classification.reason ?? null,
  });
}

/**
 * Resolve one application question against explicit profile fields. A resolved
 * answer is not a permission to write a form: callers must honor the returned
 * reviewRequired, sensitive, and unsupported flags.
 */
export function resolveFormQuestion(profile = {}, questionInput = {}) {
  const question = normalizeFormQuestion(questionInput);
  const classification = classifyNormalizedQuestion(question);

  // Binding legal choices, identity/credential fields, demographics, and
  // uploads are intentionally never supplied by profile data. Conditional
  // prompts also wait for the applicant, even when their label resembles a
  // reusable field.
  if (classification.action === QuestionAction.MANUAL_ONLY || classification.kind === QuestionKind.CONDITIONAL) {
    return resolution(question, classification, []);
  }

  const candidates = candidatesForKind(profile, question, classification.kind);
  if (candidates.length > 0) return resolution(question, classification, candidates);

  // A library entry cannot turn a consequential prompt into an ordinary
  // autofillable field. When direct evidence is absent, leave sensitive
  // questions unresolved for an individual review instead of falling back to
  // a stored free-text answer.
  if (classification.sensitive) return resolution(question, classification, []);

  // An approved answer library is an exact-question escape hatch for a
  // recurring company prompt. It is not fuzzy matching; an unlisted or
  // reworded question remains a user prompt.
  if ([QuestionKind.UNKNOWN, QuestionKind.COMPANY_TAILORED].includes(classification.kind)) {
    const approved = approvedAnswerCandidates(profile, question);
    if (approved.length > 0) {
      return resolution(question, classified(QuestionKind.APPROVED_ANSWER), approved);
    }
  }

  return resolution(question, classification, []);
}

/** Resolve a list of form questions independently, preserving input order. */
export function resolveFormQuestions(profile = {}, questions = []) {
  return Object.freeze(
    asArray(questions)
      .map((question) => normalizeFormQuestion(question))
      .filter((question) => question.present)
      .map((question) => resolveFormQuestion(profile, question)),
  );
}

/** Alias emphasizing that adapters should pass only currently rendered fields. */
export function resolvePresentFormQuestions(profile = {}, questions = []) {
  return resolveFormQuestions(profile, questions);
}

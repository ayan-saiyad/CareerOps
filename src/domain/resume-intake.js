/**
 * Resume intake is intentionally a small, deterministic parser. It extracts
 * only information that is both public and plainly labeled in a resume; it is
 * not a general resume-to-profile inference engine.
 *
 * In particular, this module never reads, stores, or derives work
 * authorization, sponsorship, compensation, demographics, legal answers, or
 * identity-document facts. Those remain explicit, per-application questions.
 */

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_PATTERN = /https?:\/\/[^\s<>()\[\]{}]+/gi;
const BARE_PUBLIC_LINK_PATTERN = /\b(?:www\.)?(?:linkedin\.com\/in\/[^\s,;|]+|github\.com\/[^\s,;|]+)/gi;
const PHONE_PATTERN = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?/gi;

const TOP_CONTACT_LINE_LIMIT = 12;
const EDUCATION_LINE_LIMIT = 12;

const SECTION_END_PATTERN = /^(?:experience|employment|work history|professional experience|skills|projects|certifications|publications|volunteer(?:ing)?|activities|interests|references)\b/i;
const EDUCATION_HEADING_PATTERN = /^(?:education|academic background|academics|education and training)\b/i;
const NAME_BLOCKLIST = new Set([
  "about",
  "academic",
  "activities",
  "career",
  "contact",
  "curriculum",
  "education",
  "engineer",
  "experience",
  "information",
  "objective",
  "professional",
  "profile",
  "projects",
  "resume",
  "skills",
  "software",
  "summary",
  "work",
]);

/**
 * The reusable, non-sensitive defaults CareerOps can ask for during intake.
 * `required` determines prompt priority; optional fields are still useful on
 * many application forms, but their absence never blocks the initial profile.
 */
export const DEFAULT_RESUME_INTAKE_FIELDS = Object.freeze([
  Object.freeze({
    key: "resume",
    label: "Résumé",
    required: true,
    question: "Paste your résumé text or choose a résumé file.",
  }),
  Object.freeze({
    key: "firstName",
    label: "First name",
    required: true,
    question: "What is your first name?",
  }),
  Object.freeze({
    key: "lastName",
    label: "Last name",
    required: true,
    question: "What is your last name?",
  }),
  Object.freeze({
    key: "email",
    label: "Email address",
    required: true,
    question: "Which email address should applications use?",
  }),
  Object.freeze({
    key: "phone",
    label: "Phone number",
    required: true,
    question: "Which phone number should applications use?",
  }),
  Object.freeze({
    key: "location",
    label: "Current location",
    required: true,
    question: "What city and state or country should applications use for your location?",
  }),
  Object.freeze({
    key: "linkedin",
    label: "LinkedIn profile",
    required: false,
    question: "What is your public LinkedIn profile URL?",
  }),
  Object.freeze({
    key: "github",
    label: "GitHub profile",
    required: false,
    question: "What is your public GitHub profile URL?",
  }),
  Object.freeze({
    key: "website",
    label: "Portfolio or personal website",
    required: false,
    question: "What public portfolio or personal website should applications use?",
  }),
  Object.freeze({
    key: "education",
    label: "Education",
    required: false,
    question: "What school, degree, and field of study should applications use?",
  }),
]);

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function canonical(value) {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = cleanText(value);
    const key = canonical(text);
    if (text && !seen.has(key)) {
      seen.add(key);
      result.push(text);
    }
  }
  return result;
}

function lineList(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function safelyFreeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(safelyFreeze));
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safelyFreeze(item)])));
  }
  return value;
}

function normalizeEmail(value) {
  const email = cleanText(value).toLowerCase();
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email) ? email : null;
}

function normalizePhone(value) {
  const phone = cleanText(value);
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? phone : null;
}

function trimUrl(value) {
  return cleanText(value).replace(/[.,;:!?]+$/, "").replace(/[)\]}]+$/, "");
}

function normalizePublicUrl(value, { allowBare = false } = {}) {
  let source = trimUrl(value);
  if (allowBare && !/^https?:\/\//i.test(source)) source = `https://${source}`;
  if (!/^https?:\/\//i.test(source)) return null;

  try {
    const url = new URL(source);
    if (!/^https?:$/.test(url.protocol) || !url.hostname || url.hostname === "localhost") return null;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function hostOf(urlValue) {
  try {
    return new URL(urlValue).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function isLinkedinProfile(urlValue) {
  try {
    const url = new URL(urlValue);
    const parts = url.pathname.split("/").filter(Boolean);
    return hostOf(urlValue) === "linkedin.com" && parts.length === 2 && parts[0].toLowerCase() === "in";
  } catch {
    return false;
  }
}

function isGithubProfile(urlValue) {
  try {
    const url = new URL(urlValue);
    const parts = url.pathname.split("/").filter(Boolean);
    return hostOf(urlValue) === "github.com" && parts.length === 1;
  } catch {
    return false;
  }
}

function publicUrlsFromLines(lines) {
  const values = [];
  for (const line of lines) {
    URL_PATTERN.lastIndex = 0;
    for (const match of line.matchAll(URL_PATTERN)) {
      const url = normalizePublicUrl(match[0]);
      if (url) values.push(url);
    }
    BARE_PUBLIC_LINK_PATTERN.lastIndex = 0;
    for (const match of line.matchAll(BARE_PUBLIC_LINK_PATTERN)) {
      const url = normalizePublicUrl(match[0], { allowBare: true });
      if (url) values.push(url);
    }
  }
  return unique(values);
}

function chooseOnly(candidates) {
  const values = unique(candidates);
  return Object.freeze({ value: values.length === 1 ? values[0] : null, ambiguous: values.length > 1 });
}

function readEmails(lines) {
  const values = [];
  for (const line of lines) {
    EMAIL_PATTERN.lastIndex = 0;
    for (const match of line.matchAll(EMAIL_PATTERN)) {
      const email = normalizeEmail(match[0]);
      if (email) values.push(email);
    }
  }
  return chooseOnly(values);
}

function readPhones(lines) {
  const values = [];
  for (const line of lines) {
    PHONE_PATTERN.lastIndex = 0;
    for (const match of line.matchAll(PHONE_PATTERN)) {
      const phone = normalizePhone(match[0]);
      if (phone) values.push(phone);
    }
  }
  return chooseOnly(values);
}

function titleCaseIfUppercase(value) {
  const text = cleanText(value);
  if (text && text === text.toUpperCase()) {
    return text
      .toLowerCase()
      .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  }
  return text;
}

function looksLikeName(value) {
  const text = cleanText(value);
  if (!text || text.length > 56 || /[@/:\\\d]/.test(text)) return false;
  const words = text.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  if (words.some((word) => NAME_BLOCKLIST.has(canonical(word).replace(/[^a-z]/g, "")))) return false;
  return words.every((word) => /^[\p{L}][\p{L}'’-]*\.?$/u.test(word));
}

function splitName(fullName) {
  const words = cleanText(fullName).split(/\s+/).filter(Boolean);
  if (words.length < 2) return {};
  return { firstName: words[0].replace(/\.$/, ""), lastName: words.slice(1).join(" ").replace(/\.$/, "") };
}

function namePart(value) {
  const text = cleanText(value);
  return /^[\p{L}][\p{L}'’-]{0,48}$/u.test(text) ? text : null;
}

function findHeaderName(lines) {
  for (const originalLine of lines.slice(0, 5)) {
    const explicit = /^(?:name|full name)\s*[:\-]\s*(.+)$/i.exec(originalLine);
    const candidate = explicit ? explicit[1] : originalLine.split(/[|•]/, 1)[0];
    if (!looksLikeName(candidate)) continue;
    const fullName = titleCaseIfUppercase(candidate);
    return Object.freeze({ fullName, ...splitName(fullName) });
  }
  return Object.freeze({});
}

function educationLines(lines) {
  const start = lines.findIndex((line) => EDUCATION_HEADING_PATTERN.test(line));
  if (start < 0) return [];
  const section = [];
  for (const line of lines.slice(start + 1, start + 1 + EDUCATION_LINE_LIMIT)) {
    if (SECTION_END_PATTERN.test(line)) break;
    section.push(line);
  }
  return section;
}

function institutionFromLine(line) {
  const pieces = line
    .replace(/^education\s*[:\-]?\s*/i, "")
    .split(/[—–|]/)
    .flatMap((piece) => piece.split(/\s+-\s+/))
    .map(cleanText)
    .filter(Boolean);

  for (const piece of pieces) {
    if (!/\b(?:university|college|institute|polytechnic|conservatory|academy)\b/i.test(piece)) continue;
    const school = cleanText(piece.replace(/,\s*(?:[A-Z][a-z]+\s+)?\d{4}.*$/, "").replace(/,\s*[A-Z][A-Za-z .'-]+,?\s*[A-Z]{2}\b.*$/, ""));
    if (school && school.length <= 100) return school;
  }
  return null;
}

function degreeFromLine(line) {
  const match = /\b(B\.?\s?(?:S|A|Sc|Eng)\.?|M\.?\s?(?:S|A|Sc|Eng)\.?|MBA|Ph\.?D\.?|Associate(?:'s)?(?:\s+Degree)?|Bachelor(?:'s)?(?:\s+of\s+[A-Za-z ]+)?|Master(?:'s)?(?:\s+of\s+[A-Za-z ]+)?|Doctor(?:ate)?(?:\s+of\s+[A-Za-z ]+)?)\b/i.exec(line);
  if (!match) return null;

  const degree = cleanText(match[1]);
  const compact = degree.replace(/\s/g, "").replace(/\./g, "").toUpperCase();
  const abbreviations = {
    BS: "B.S.",
    BA: "B.A.",
    BSC: "B.Sc.",
    BENG: "B.Eng.",
    MS: "M.S.",
    MA: "M.A.",
    MSC: "M.Sc.",
    MENG: "M.Eng.",
    MBA: "MBA",
    PHD: "Ph.D.",
  };
  return abbreviations[compact] ?? degree;
}

function fieldOfStudyFromLine(line) {
  const match = /\b(?:in|field of study\s*[:\-])\s+([A-Za-z][A-Za-z&/' -]{1,80}?)(?=\s*(?:[,|—–]|\b(?:expected|graduat(?:ed|ion)|class of)\b|\d{4}|$))/i.exec(line);
  if (!match) return null;
  const field = cleanText(match[1]);
  return field && !/^(?:the|a|an)$/i.test(field) ? field : null;
}

function graduationYearFromLine(line) {
  const explicit = /\b(?:expected|graduat(?:ed|ion)|class of)\s*[:\-]?\s*(?:[A-Za-z]+\s+)?((?:19|20)\d{2})\b/i.exec(line);
  if (explicit) return explicit[1];
  const year = /\b((?:19|20)\d{2})\b/.exec(line);
  return year ? year[1] : null;
}

function extractEducation(lines) {
  const records = [];
  for (const line of educationLines(lines)) {
    const school = institutionFromLine(line);
    const degree = degreeFromLine(line);
    const fieldOfStudy = degree ? fieldOfStudyFromLine(line) : null;
    const graduationYear = degree || school ? graduationYearFromLine(line) : null;
    if (!school && !degree) continue;
    records.push({
      ...(school ? { school } : {}),
      ...(degree ? { degree } : {}),
      ...(fieldOfStudy ? { fieldOfStudy } : {}),
      ...(graduationYear ? { graduationYear } : {}),
    });
  }

  const seen = new Set();
  return records.filter((record) => {
    const key = canonical([record.school, record.degree, record.fieldOfStudy, record.graduationYear].filter(Boolean).join("|"));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizedEducation(records) {
  const result = [];
  const seen = new Set();
  const input = Array.isArray(records) ? records : records ? [records] : [];
  for (const record of input) {
    if (!record || typeof record !== "object") continue;
    const school = cleanText(record.school ?? record.institution);
    const degree = cleanText(record.degree);
    const fieldOfStudy = cleanText(record.fieldOfStudy ?? record.major ?? record.field);
    const graduationYear = cleanText(record.graduationYear ?? record.year);
    if (!school && !degree && !fieldOfStudy) continue;
    const normalized = {
      ...(school ? { school } : {}),
      ...(degree ? { degree } : {}),
      ...(fieldOfStudy ? { fieldOfStudy } : {}),
      ...(graduationYear && /^(?:19|20)\d{2}$/.test(graduationYear) ? { graduationYear } : {}),
    };
    const key = canonical([normalized.school, normalized.degree, normalized.fieldOfStudy, normalized.graduationYear].filter(Boolean).join("|"));
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result;
}

function linkFromProfile(profile, key) {
  const aliases = {
    linkedin: [profile?.links?.linkedin, profile?.linkedin, profile?.linkedinUrl],
    github: [profile?.links?.github, profile?.github, profile?.githubUrl],
    website: [profile?.links?.website, profile?.website, profile?.portfolio, profile?.portfolioUrl],
  };
  for (const candidate of aliases[key] ?? []) {
    const url = normalizePublicUrl(candidate, { allowBare: true });
    if (!url) continue;
    if (key === "linkedin" && !isLinkedinProfile(url)) continue;
    if (key === "github" && !isGithubProfile(url)) continue;
    return url;
  }
  return null;
}

function profileText(profile, keys, validator = (value) => cleanText(value) || null) {
  for (const key of keys) {
    const value = validator(profile?.[key]);
    if (value) return value;
  }
  return null;
}

function publicProfile(profile) {
  const providedName = profileText(profile, ["fullName", "name"]);
  const explicitName = providedName && looksLikeName(providedName) ? providedName : null;
  const inferredName = explicitName ? splitName(explicitName) : {};
  const firstName = profileText(profile, ["firstName"], namePart) ?? inferredName.firstName ?? null;
  const lastName = profileText(profile, ["lastName"], (value) => {
    const text = cleanText(value);
    return text.split(/\s+/).every((part) => namePart(part)) ? text : null;
  }) ?? inferredName.lastName ?? null;
  const fullName = explicitName ?? (firstName && lastName ? `${firstName} ${lastName}` : null);
  const email = profileText(profile, ["email", "emailAddress"], normalizeEmail);
  const phone = profileText(profile, ["phone", "phoneNumber"], normalizePhone);
  const location = profileText(profile, ["location", "currentLocation"]);
  const links = Object.fromEntries(
    ["linkedin", "github", "website"]
      .map((key) => [key, linkFromProfile(profile, key)])
      .filter(([, value]) => Boolean(value)),
  );
  const education = normalizedEducation(profile?.education ?? profile?.educations ?? profile?.educationHistory);

  return {
    ...(fullName ? { fullName } : {}),
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(location ? { location } : {}),
    ...(Object.keys(links).length ? { links } : {}),
    ...(education.length ? { education } : {}),
  };
}

function profileWithSources({ supplied, extracted }) {
  const profile = {};
  const sources = {};
  const directKeys = ["fullName", "firstName", "lastName", "email", "phone", "location"];

  for (const key of directKeys) {
    if (supplied[key]) {
      profile[key] = supplied[key];
      sources[key] = "profile";
    } else if (extracted[key]) {
      profile[key] = extracted[key];
      sources[key] = "resume";
    }
  }

  const links = {};
  for (const key of ["linkedin", "github", "website"]) {
    if (supplied.links?.[key]) {
      links[key] = supplied.links[key];
      sources[key] = "profile";
    } else if (extracted.links?.[key]) {
      links[key] = extracted.links[key];
      sources[key] = "resume";
    }
  }
  if (Object.keys(links).length) profile.links = links;

  if (supplied.education?.length) {
    profile.education = supplied.education;
    sources.education = "profile";
  } else if (extracted.education?.length) {
    profile.education = extracted.education;
    sources.education = "resume";
  }

  return { profile, sources };
}

function valueForField(profile, key, hasResume) {
  if (key === "resume") return hasResume;
  if (key === "linkedin" || key === "github" || key === "website") return profile.links?.[key] ?? null;
  if (key === "education") return Array.isArray(profile.education) && profile.education.length > 0;
  return profile[key] ?? null;
}

/**
 * Extract conservative, reusable hints from résumé text. The return value is
 * safe to save as a draft profile: it deliberately omits all sensitive,
 * legal, eligibility, and compensation categories.
 */
export function extractResumeProfileHints(resumeText = "") {
  const lines = lineList(resumeText);
  const contactLines = lines.slice(0, TOP_CONTACT_LINE_LIMIT);
  const ambiguousFields = [];
  const name = findHeaderName(lines);
  const email = readEmails(contactLines);
  const phone = readPhones(contactLines);
  const urls = publicUrlsFromLines(contactLines);
  const linkedin = chooseOnly(urls.filter(isLinkedinProfile));
  const github = chooseOnly(urls.filter(isGithubProfile));
  const labeledWebsiteCandidates = contactLines
    .filter((line) => /\b(?:portfolio|personal (?:site|website)|website)\b\s*[:\-]/i.test(line))
    .flatMap((line) => publicUrlsFromLines([line]))
    .filter((url) => !isLinkedinProfile(url) && !isGithubProfile(url));
  const website = chooseOnly(labeledWebsiteCandidates);

  if (email.ambiguous) ambiguousFields.push("email");
  if (phone.ambiguous) ambiguousFields.push("phone");
  if (linkedin.ambiguous) ambiguousFields.push("linkedin");
  if (github.ambiguous) ambiguousFields.push("github");
  if (website.ambiguous) ambiguousFields.push("website");

  const links = {
    ...(linkedin.value ? { linkedin: linkedin.value } : {}),
    ...(github.value ? { github: github.value } : {}),
    ...(website.value ? { website: website.value } : {}),
  };
  const education = extractEducation(lines);
  const profile = {
    ...name,
    ...(email.value ? { email: email.value } : {}),
    ...(phone.value ? { phone: phone.value } : {}),
    ...(Object.keys(links).length ? { links } : {}),
    ...(education.length ? { education } : {}),
  };

  return safelyFreeze({ profile, ambiguousFields: unique(ambiguousFields) });
}

/**
 * Combine supplied, reusable details with conservative résumé hints and
 * generate the exact default follow-up questions still needed. Explicit user
 * profile values always take precedence over parsed resume data.
 */
export function analyzeResumeIntake(resumeText = "", suppliedProfile = {}) {
  const hints = extractResumeProfileHints(resumeText);
  const supplied = publicProfile(suppliedProfile);
  const { profile, sources } = profileWithSources({ supplied, extracted: hints.profile });
  const hasResume = Boolean(cleanText(resumeText));
  const fields = [];
  const missingFields = [];

  for (const definition of DEFAULT_RESUME_INTAKE_FIELDS) {
    const value = valueForField(profile, definition.key, hasResume);
    if (value) {
      fields.push({
        key: definition.key,
        label: definition.label,
        value: definition.key === "resume" || definition.key === "education" ? undefined : value,
        source: definition.key === "resume" ? "resume" : sources[definition.key] ?? "profile",
      });
    } else {
      missingFields.push({
        key: definition.key,
        label: definition.label,
        required: definition.required,
        question: definition.question,
      });
    }
  }

  return safelyFreeze({
    profile,
    extracted: hints.profile,
    fields,
    missingFields,
    clarifyingQuestions: missingFields,
    ambiguousFields: hints.ambiguousFields,
    hasResume,
  });
}

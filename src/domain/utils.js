/**
 * Small, browser-safe helpers shared by the CareerOps domain modules.
 * The domain layer deliberately has no framework, database, or AI dependency.
 */

const SKILL_ALIAS_ENTRIES = [
  ["js", "javascript"],
  ["javascript", "javascript"],
  ["ts", "typescript"],
  ["typescript", "typescript"],
  ["reactjs", "react"],
  ["react.js", "react"],
  ["react", "react"],
  ["node", "node.js"],
  ["nodejs", "node.js"],
  ["node.js", "node.js"],
  ["next", "next.js"],
  ["nextjs", "next.js"],
  ["next.js", "next.js"],
  ["postgres", "postgresql"],
  ["postgresql", "postgresql"],
  ["k8s", "kubernetes"],
  ["kubernetes", "kubernetes"],
  ["aws", "aws"],
  ["amazon web services", "aws"],
  ["gcp", "gcp"],
  ["google cloud", "gcp"],
  ["c#", "csharp"],
  ["csharp", "csharp"],
  ["c++", "cpp"],
  ["cpp", "cpp"],
  ["ci/cd", "ci cd"],
  ["ci cd", "ci cd"],
];

export const SKILL_ALIASES = Object.freeze(Object.fromEntries(SKILL_ALIAS_ENTRIES));

/** Return a trimmed string or an empty string for non-string-like values. */
export function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

/** A comparison-safe representation that remains readable in logs. */
export function canonicalText(value) {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Convert a scalar or array into an array without leaking null values. */
export function asArray(value) {
  if (value === null || value === undefined || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

export function uniqueStrings(values, mapper = cleanText) {
  const seen = new Set();
  const result = [];

  for (const value of asArray(values)) {
    const mapped = mapper(value);
    const key = canonicalText(mapped);
    if (mapped && !seen.has(key)) {
      seen.add(key);
      result.push(mapped);
    }
  }

  return result;
}

/**
 * Normalize a skill while retaining enough punctuation for familiar skill names.
 * It is intentionally a modest alias map rather than an inferred skills taxonomy.
 */
export function normalizeSkill(value) {
  const raw = typeof value === "object" && value ? value.name ?? value.label ?? value.value : value;
  const normalized = canonicalText(raw)
    .replace(/\bnode\s*\.\s*js\b/g, "node.js")
    .replace(/\bnext\s*\.\s*js\b/g, "next.js")
    .replace(/\s+/g, " ");

  return SKILL_ALIASES[normalized] ?? normalized;
}

export function displaySkill(value) {
  const skill = normalizeSkill(value);
  const labels = {
    aws: "AWS",
    gcp: "GCP",
    javascript: "JavaScript",
    typescript: "TypeScript",
    "node.js": "Node.js",
    "next.js": "Next.js",
    postgresql: "PostgreSQL",
    kubernetes: "Kubernetes",
    csharp: "C#",
    cpp: "C++",
    "ci cd": "CI/CD",
  };
  return labels[skill] ?? cleanText(value);
}

export function uniqueSkills(values) {
  const seen = new Set();
  const skills = [];
  for (const value of asArray(values)) {
    const skill = normalizeSkill(value);
    if (skill && !seen.has(skill)) {
      seen.add(skill);
      skills.push(skill);
    }
  }
  return skills;
}

/** Lightweight word tokenization for deterministic role and text comparisons. */
export function tokenize(value) {
  return canonicalText(value)
    .replace(/[^a-z0-9+#.]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

export function overlap(left, right) {
  const leftSet = new Set(left);
  const matches = [];
  for (const value of right) {
    if (leftSet.has(value) && !matches.includes(value)) matches.push(value);
  }
  return matches;
}

export function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Return an ISO calendar date when a value can safely be parsed, otherwise null. */
export function toIsoDate(value) {
  if (!value) return null;
  const text = cleanText(value);
  const exactDate = /^\d{4}-\d{2}-\d{2}$/.exec(text);
  if (exactDate) {
    const date = new Date(`${text}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : text;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** A stable non-cryptographic ID suffix suitable for client-side normalized records. */
export function stableHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function deepClone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function normalizeLocationText(value) {
  return canonicalText(value)
    .replace(/\bunited states\b|\bu\.s\.a?\b/g, "us")
    .replace(/\bremote[- ]?us\b/g, "remote us")
    .replace(/\s*,\s*/g, ", ");
}

export function isRemoteLocation(value) {
  return /\bremote\b/.test(normalizeLocationText(value));
}

/*
 * CareerOps Safe Fill Demo service worker.
 *
 * This worker is the extension's policy boundary. The popup never sends a
 * selector or a value to a page: it can only preview a plan constructed by the
 * content script, then request a subset of that exact short-lived plan.
 */

const ALLOWED_ORIGINS = new Set([
  "http://localhost:4173",
  "http://127.0.0.1:4173"
]);

const PLAN_TTL_MS = 5 * 60 * 1000;
const MAX_PLAN_FIELDS = 16;
const MAX_REQUIREMENTS = 48;
const PLAN_VERSION = 2;
const SESSION_DRAFT_TTL_MS = 5 * 60 * 1000;
const PLAN_KINDS = new Set(["text", "select", "radio", "checkbox"]);
const PLAN_SOURCES = new Set(["routine profile", "verified profile", "verified eligibility", "approved question", "synthetic demo"]);
const PLAN_ADAPTERS = new Set(["generic", "workday-like"]);
const ROUTINE_DRAFT_KEYS = new Set([
  "firstName", "lastName", "fullName", "preferredName", "email", "phone",
  "city", "state", "addressLine1", "addressLine2", "postalCode", "country",
  "website", "linkedin", "github", "school", "degree", "major", "graduation"
]);

// Memory-only by design. A candidate can explicitly sync a normalized local
// FillPlan for a future optional-host flow, but it is not written to
// chrome.storage and disappears when this worker is restarted or expires.
const pendingPlans = new Map();
let syncedDraft = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only extension pages may initiate privileged preview/fill messages. A
  // local page cannot use chrome.runtime without explicit external messaging,
  // but this keeps the service-worker boundary explicit as well.
  if (!isTrustedExtensionSender(sender) || !message || typeof message.type !== "string") {
    return undefined;
  }

  if (message.type === "CAREEROPS_PAGE_STATUS") {
    getPageStatus(message.tabId).then(sendResponse, (error) => {
      sendResponse({ ok: false, error: userFacingError(error) });
    });
    return true;
  }

  if (message.type === "CAREEROPS_PREVIEW_REQUEST") {
    createPreview(message.tabId).then(sendResponse, (error) => {
      sendResponse({ ok: false, error: userFacingError(error) });
    });
    return true;
  }

  if (message.type === "CAREEROPS_FILL_REQUEST") {
    applyPreview(message.tabId, message.nonce, message.fieldIds).then(sendResponse, (error) => {
      sendResponse({ ok: false, error: userFacingError(error) });
    });
    return true;
  }

  if (message.type === "CAREEROPS_SYNC_LOCAL_DRAFT") {
    syncLocalDraft(message.tabId).then(sendResponse, (error) => {
      sendResponse({ ok: false, error: userFacingError(error) });
    });
    return true;
  }

  return undefined;
});

async function getPageStatus(tabId) {
  const tab = await getTab(tabId);
  const allowed = isAllowedUrl(tab.url);
  const draft = getSyncedDraft();

  return {
    ok: true,
    allowed,
    local: allowed,
    canSync: allowed,
    syncedDraftExpiresAt: draft?.expiresAt ?? null,
    origin: safeOrigin(tab.url),
    message: allowed
      ? "This local page is eligible for a reviewed CareerOps preview."
      : "Open a local CareerOps fixture at http://localhost:4173 to use this demo."
  };
}

async function syncLocalDraft(tabId) {
  const tab = await getTab(tabId);
  if (!isAllowedUrl(tab.url)) {
    throw new Error("Open the local CareerOps dashboard or fixture before syncing a reviewed FillPlan.");
  }

  const contentResponse = await sendToTab(tab.id, { type: "CAREEROPS_EXPORT_DRAFT" });
  if (!contentResponse || contentResponse.ok !== true) {
    throw new Error(contentResponse?.error || "CareerOps could not read the local reviewed FillPlan.");
  }

  const draft = sanitizeSessionDraft(contentResponse.draft);
  if (!draft) {
    throw new Error("The local FillPlan was invalid, expired, or contained no transferable reviewed answers.");
  }
  syncedDraft = draft;

  return {
    ok: true,
    expiresAt: draft.expiresAt,
    routineFieldCount: Object.keys(draft.values).length,
    approvedQuestionCount: draft.approvedQuestions.length,
    verifiedQuestionCount: draft.verifiedQuestions.length
  };
}

async function createPreview(tabId) {
  const tab = await getAllowedTab(tabId);
  const contentResponse = await sendToTab(tab.id, { type: "CAREEROPS_BUILD_PLAN" });

  if (!contentResponse || contentResponse.ok !== true) {
    throw new Error(contentResponse?.error || "CareerOps could not inspect this page.");
  }

  const plan = sanitizePlan(contentResponse.plan, tab.url);
  if (!plan) {
    throw new Error("The page returned an invalid fill plan.");
  }

  pendingPlans.set(tab.id, {
    nonce: plan.nonce,
    pageUrl: stripHash(tab.url),
    fieldIds: new Set(plan.fields.map((field) => field.id)),
    expiresAt: Date.now() + PLAN_TTL_MS
  });
  removeExpiredPlans();

  return { ok: true, plan };
}

async function applyPreview(tabId, nonce, requestedFieldIds) {
  const tab = await getAllowedTab(tabId);
  const pending = pendingPlans.get(tab.id);

  if (!pending || pending.nonce !== nonce || pending.expiresAt < Date.now()) {
    pendingPlans.delete(tab.id);
    throw new Error("This preview expired. Preview the fields again before filling.");
  }

  if (stripHash(tab.url) !== pending.pageUrl) {
    pendingPlans.delete(tab.id);
    throw new Error("The page changed after preview. Review a new plan before filling.");
  }

  const fieldIds = uniqueStrings(requestedFieldIds)
    .filter((fieldId) => pending.fieldIds.has(fieldId))
    .slice(0, MAX_PLAN_FIELDS);

  if (fieldIds.length === 0) {
    throw new Error("Select at least one eligible field to fill.");
  }

  // The content script keeps the actual values and element references. Passing
  // only IDs prevents the popup (or a stale page) from choosing a new target.
  const result = await sendToTab(tab.id, {
    type: "CAREEROPS_APPLY_PLAN",
    nonce: pending.nonce,
    fieldIds
  });

  // A plan is single-use whether filling succeeds or fails. A new preview is
  // required before any later write.
  pendingPlans.delete(tab.id);

  if (!result || result.ok !== true) {
    throw new Error(result?.error || "CareerOps could not fill the reviewed fields.");
  }

  return {
    ok: true,
    applied: Array.isArray(result.applied) ? result.applied.slice(0, MAX_PLAN_FIELDS) : [],
    skipped: Array.isArray(result.skipped) ? result.skipped.slice(0, MAX_PLAN_FIELDS) : []
  };
}

async function getAllowedTab(tabId) {
  const tab = await getTab(tabId);
  if (!isAllowedUrl(tab.url)) {
    throw new Error("CareerOps Safe Fill works only on the local fake ATS at port 4173.");
  }
  return tab;
}

async function getTab(tabId) {
  if (!Number.isInteger(tabId)) {
    throw new Error("No active browser tab was available.");
  }
  return chrome.tabs.get(tabId);
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    throw new Error(
      "The CareerOps page helper is not ready. Refresh the local fake ATS and try again."
    );
  }
}

function sanitizePlan(candidate, expectedUrl) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  if (candidate.version !== PLAN_VERSION) {
    return null;
  }

  if (typeof candidate.nonce !== "string" || candidate.nonce.length < 16) {
    return null;
  }

  if (stripHash(candidate.pageUrl) !== stripHash(expectedUrl)) {
    return null;
  }

  const fields = Array.isArray(candidate.fields)
    ? candidate.fields.slice(0, MAX_PLAN_FIELDS).map(sanitizeField).filter(Boolean)
    : [];
  const manualFields = Array.isArray(candidate.manualFields)
    ? candidate.manualFields.slice(0, MAX_REQUIREMENTS).map(sanitizeManualField).filter(Boolean)
    : [];

  return {
    version: PLAN_VERSION,
    nonce: candidate.nonce,
    pageUrl: stripHash(expectedUrl),
    source: candidate.source === "local-draft" ? "local-draft" : "synthetic-demo",
    detectedCount: boundedNumber(candidate.detectedCount, 0, 100),
    writableCount: boundedNumber(candidate.writableCount, 0, 100),
    requiredCount: boundedNumber(candidate.requiredCount, 0, 100),
    manualCount: boundedNumber(candidate.manualCount, 0, MAX_REQUIREMENTS),
    blockedCount: boundedNumber(candidate.blockedCount, 0, 100),
    manualFields,
    fields
  };
}

function sanitizeSessionDraft(candidate) {
  if (!candidate || typeof candidate !== "object" || candidate.version !== 1) return null;
  if (!Number.isFinite(candidate.expiresAt) || candidate.expiresAt <= Date.now()) return null;

  const expiresAt = Math.min(candidate.expiresAt, Date.now() + SESSION_DRAFT_TTL_MS);
  const values = {};
  if (candidate.values && typeof candidate.values === "object" && !Array.isArray(candidate.values)) {
    for (const [key, value] of Object.entries(candidate.values)) {
      if (!ROUTINE_DRAFT_KEYS.has(key)) continue;
      const compact = boundedString(value, 500);
      if (compact) values[key] = compact;
    }
  }

  const approvedQuestions = Array.isArray(candidate.approvedQuestions)
    ? candidate.approvedQuestions.slice(0, MAX_PLAN_FIELDS).map(sanitizeApprovedQuestion).filter(Boolean)
    : [];
  const verifiedQuestions = Array.isArray(candidate.verifiedQuestions)
    ? candidate.verifiedQuestions.slice(0, MAX_PLAN_FIELDS).map(sanitizeVerifiedQuestion).filter(Boolean)
    : [];
  const reviewOnly = Array.isArray(candidate.reviewOnly)
    ? candidate.reviewOnly.slice(0, MAX_PLAN_FIELDS).map(sanitizeReviewOnly).filter(Boolean)
    : [];

  if (!Object.keys(values).length && !approvedQuestions.length && !verifiedQuestions.length) return null;
  return { version: 1, expiresAt, values, approvedQuestions, verifiedQuestions, reviewOnly };
}

function sanitizeApprovedQuestion(entry) {
  if (!entry || typeof entry !== "object" || entry.approved !== true) return null;
  const id = boundedString(entry.id, 160) || "";
  const question = boundedString(entry.question, 300) || "";
  const value = typeof entry.value === "boolean" ? entry.value : boundedString(entry.value, 1500);
  if ((!id && !question) || value === null || value === "") return null;
  return { approved: true, id, question, value };
}

function sanitizeVerifiedQuestion(entry) {
  if (!entry || typeof entry !== "object" || entry.verified !== true) return null;
  const category = (boundedString(entry.category, 24) || "").toLowerCase();
  if (!new Set(["eligibility", "profile"]).has(category)) return null;

  const id = boundedString(entry.id, 160) || "";
  const question = boundedString(entry.question, 300) || "";
  if (category === "eligibility" && typeof entry.value !== "boolean") return null;
  const value = typeof entry.value === "boolean" ? entry.value : boundedString(entry.value, 1500);
  if ((!id && !question) || value === null || value === "") return null;
  return { verified: true, category, id, question, value };
}

function sanitizeReviewOnly(entry) {
  if (!entry || typeof entry !== "object") return null;
  const key = boundedString(entry.key, 80) || "";
  const id = boundedString(entry.id, 160) || "";
  const question = boundedString(entry.question, 300) || "";
  return key || id || question ? { key, id, question } : null;
}

function sanitizeField(field) {
  if (!field || typeof field !== "object") {
    return null;
  }

  const id = boundedString(field.id, 160);
  const key = boundedString(field.key, 40);
  const kind = boundedString(field.kind, 20);
  const label = boundedString(field.label, 140);
  const question = boundedString(field.question, 260);
  const value = boundedString(field.value, 500);
  const source = boundedString(field.source, 40);
  const adapter = boundedString(field.adapter, 40);
  const required = field.required === true;

  if (!id || !key || !kind || !label || !question || value === null || !source || !adapter) {
    return null;
  }
  if (!PLAN_KINDS.has(kind) || !PLAN_SOURCES.has(source) || !PLAN_ADAPTERS.has(adapter)) return null;

  return { id, key, kind, label, question, value, source, adapter, required };
}

function sanitizeManualField(field) {
  if (!field || typeof field !== "object") return null;

  const key = boundedString(field.key, 80);
  const kind = boundedString(field.kind, 20);
  const label = boundedString(field.label, 140);
  const question = boundedString(field.question, 260);
  const category = boundedString(field.category, 40);
  const reason = boundedString(field.reason, 320);
  const adapter = boundedString(field.adapter, 40);
  const required = field.required === true;

  if (!key || !kind || !label || !question || !category || !reason || !adapter) return null;
  if (![...PLAN_KINDS, "unsupported"].includes(kind)) return null;
  if (!new Set(["manual", "profile", "eligibility", "company-specific"]).has(category)) return null;
  if (!PLAN_ADAPTERS.has(adapter)) return null;

  return { key, kind, label, question, category, reason, adapter, required };
}

function boundedString(value, maximumLength) {
  if (typeof value !== "string") {
    return null;
  }
  const compact = value.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  return compact.length <= maximumLength ? compact : compact.slice(0, maximumLength);
}

function boundedNumber(value, minimum, maximum) {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : minimum;
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values.filter((value) => typeof value === "string" && value.length <= 160))];
}

function isAllowedUrl(value) {
  try {
    return ALLOWED_ORIGINS.has(new URL(value).origin);
  } catch {
    return false;
  }
}

function isTrustedExtensionSender(sender) {
  return sender?.id === chrome.runtime.id && !sender.tab;
}

function safeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "unknown page";
  }
}

function stripHash(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function removeExpiredPlans() {
  const now = Date.now();
  for (const [tabId, plan] of pendingPlans) {
    if (plan.expiresAt < now) {
      pendingPlans.delete(tabId);
    }
  }
  getSyncedDraft();
}

function getSyncedDraft() {
  if (syncedDraft && syncedDraft.expiresAt <= Date.now()) {
    syncedDraft = null;
  }
  return syncedDraft;
}

function userFacingError(error) {
  return error instanceof Error ? error.message : "An unexpected extension error occurred.";
}

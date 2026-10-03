import {
  FormAnswerBucket,
  QuestionAction,
  QuestionCategory,
  QuestionKind,
  normalizeFormQuestion,
} from "./form-answer-resolver.js";
import { asArray, cleanText, stableHash, uniqueStrings } from "./utils.js";

/** A queue item is either a prompt for the candidate or a protected manual step. */
export const ClarificationDisposition = Object.freeze({
  NEEDS_INPUT: "needs_input",
  MANUAL_ONLY: "manual_only",
});

/** Why a current application field is in the clarification queue. */
export const ClarificationKind = Object.freeze({
  COMPANY_TAILORED: "company_tailored",
  UNKNOWN: "unknown",
  MISSING_PROFILE_DATA: "missing_profile_data",
  COMPENSATION: "compensation",
  AVAILABILITY: "availability",
  UNVERIFIED_ELIGIBILITY: "unverified_eligibility",
  CONDITIONAL: "conditional",
  PROTECTED: "protected",
});

function booleanValue(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = cleanText(value).toLowerCase();
  if (["true", "yes", "required", "mandatory", "1"].includes(text)) return true;
  if (["false", "no", "optional", "0"].includes(text)) return false;
  return fallback;
}

function scalarValue(value) {
  if (typeof value === "string") return cleanText(value) || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value;
  return null;
}

function questionFor(resolution) {
  return normalizeFormQuestion(resolution?.question ?? {});
}

function currentFormSnapshot(question, resolution) {
  const required = Boolean(question.required || booleanValue(resolution?.required, question.required));
  // A task must never be created for a field the current question snapshot
  // says is absent, even if stale resolution metadata claims otherwise.
  const present = Boolean(question.present && booleanValue(resolution?.present, true));
  const conditional = Boolean(question.conditional || booleanValue(resolution?.conditional, false));

  return Object.freeze({
    id: question.id || null,
    name: question.name || null,
    label: question.label || null,
    ariaLabel: question.ariaLabel || null,
    inputType: question.inputType || null,
    required,
    present,
    conditional,
    options: Object.freeze(
      question.options.map((option) => Object.freeze({
        label: option.label,
        value: option.value,
      })),
    ),
  });
}

function isManualOnly(resolution) {
  return Boolean(
    resolution?.manualOnly
      || resolution?.action === QuestionAction.MANUAL_ONLY
      || resolution?.planBucket === FormAnswerBucket.REVIEW_ONLY
      || resolution?.category === QuestionCategory.HARD_STOP,
  );
}

function needsUserInput(resolution) {
  return Boolean(
    resolution?.needsUserInput
      || resolution?.action === QuestionAction.REQUEST_INPUT
      || resolution?.status === "needs_input",
  );
}

function isProfileResolution(resolution) {
  return resolution?.category === QuestionCategory.PROFILE;
}

function isEligibilityResolution(resolution) {
  return resolution?.category === QuestionCategory.VERIFIED_ELIGIBILITY
    || resolution?.kind === QuestionKind.WORK_AUTHORIZATION
    || resolution?.kind === QuestionKind.SPONSORSHIP;
}

function hasVerifiedEligibilityAnswer(resolution) {
  return Boolean(
    resolution?.verified
      && resolution?.action === QuestionAction.VERIFIED_AUTO_FILL
      && resolution?.autoFillEligible
      && scalarValue(resolution?.value) !== null,
  );
}

function isChangingPreference(resolution) {
  return resolution?.kind === QuestionKind.SALARY
    || resolution?.kind === QuestionKind.START_DATE
    || resolution?.category === QuestionCategory.REUSABLE_PREFERENCE;
}

function taskKindFor(resolution) {
  if (isManualOnly(resolution)) return ClarificationKind.PROTECTED;
  if (isEligibilityResolution(resolution) && !hasVerifiedEligibilityAnswer(resolution)) return ClarificationKind.UNVERIFIED_ELIGIBILITY;
  if (resolution?.kind === QuestionKind.SALARY) return ClarificationKind.COMPENSATION;
  if (resolution?.kind === QuestionKind.START_DATE) return ClarificationKind.AVAILABILITY;
  if (resolution?.kind === QuestionKind.CONDITIONAL || resolution?.category === QuestionCategory.CONDITIONAL) {
    return ClarificationKind.CONDITIONAL;
  }
  if (resolution?.kind === QuestionKind.COMPANY_TAILORED || resolution?.category === QuestionCategory.COMPANY_TAILORED) {
    return ClarificationKind.COMPANY_TAILORED;
  }
  if (isProfileResolution(resolution) && scalarValue(resolution?.value) === null) {
    return ClarificationKind.MISSING_PROFILE_DATA;
  }
  return ClarificationKind.UNKNOWN;
}

function shouldQueueResolution(resolution) {
  if (!resolution || typeof resolution !== "object") return false;
  if (isManualOnly(resolution)) return true;

  // Eligibility cannot be treated as verified merely because a value happens
  // to be present. A verified boolean record is required before it is omitted.
  if (isEligibilityResolution(resolution) && !hasVerifiedEligibilityAnswer(resolution)) return true;

  // Compensation and availability are current decisions, so their stored
  // profile values are optional context for a prompt, never an auto-answer.
  if (isChangingPreference(resolution)) return true;

  if (isProfileResolution(resolution) && scalarValue(resolution.value) === null) return true;
  if (needsUserInput(resolution)) return true;
  return false;
}

function defaultReason(kind) {
  const reasons = {
    [ClarificationKind.COMPANY_TAILORED]: "This company-specific prompt needs your response.",
    [ClarificationKind.UNKNOWN]: "This question does not have a deterministic profile mapping.",
    [ClarificationKind.MISSING_PROFILE_DATA]: "A reusable profile value is missing or needs your selection.",
    [ClarificationKind.COMPENSATION]: "Compensation can change; confirm or provide your current answer.",
    [ClarificationKind.AVAILABILITY]: "Availability can change; confirm or provide your current answer.",
    [ClarificationKind.UNVERIFIED_ELIGIBILITY]: "Verify this employment-eligibility answer before it is used.",
    [ClarificationKind.CONDITIONAL]: "This follow-up depends on your current application response.",
    [ClarificationKind.PROTECTED]: "This protected question must be completed directly in the application.",
  };
  return reasons[kind];
}

function promptFor(question) {
  return question.label || question.ariaLabel || question.name || "Application question";
}

function uniqueEvidenceIds(resolution) {
  return Object.freeze(uniqueStrings(asArray(resolution?.evidenceIds), cleanText));
}

function taskFromResolution(profile, resolution, index) {
  const question = questionFor(resolution);
  const form = currentFormSnapshot(question, resolution);
  if (!form.present || !shouldQueueResolution(resolution)) return null;

  const manualOnly = isManualOnly(resolution);
  const kind = taskKindFor(resolution);
  const candidateId = cleanText(profile?.id) || "candidate";
  const identity = [candidateId, question.id, question.name, question.label, index].join("\u0000");
  const existingValue = manualOnly ? null : scalarValue(resolution.value);

  return Object.freeze({
    version: 1,
    id: `clarification-${stableHash(identity)}`,
    disposition: manualOnly ? ClarificationDisposition.MANUAL_ONLY : ClarificationDisposition.NEEDS_INPUT,
    kind,
    prompt: promptFor(question),
    required: form.required,
    present: form.present,
    conditional: form.conditional,
    form,
    questionKind: cleanText(resolution.kind) || null,
    category: cleanText(resolution.category) || null,
    reason: cleanText(resolution.reason) || defaultReason(kind),
    // This is existing, explicit profile-derived context only. It is never a
    // generated answer and never makes a clarification task auto-fillable.
    existingValue,
    evidenceIds: manualOnly ? Object.freeze([]) : uniqueEvidenceIds(resolution),
    canAutoFill: false,
  });
}

/**
 * Build an immutable queue from questions that are currently present in an
 * application. Resolutions remain the source of truth: this function does not
 * infer new facts from the profile or generate any answer text. The profile is
 * used only to make task IDs stable within the candidate's local workspace.
 */
export function buildClarificationQueue(profile = {}, resolutions = []) {
  const tasks = asArray(resolutions)
    .map((resolution, index) => taskFromResolution(profile, resolution, index))
    .filter(Boolean);
  const frozenTasks = Object.freeze(tasks);
  const needsInput = Object.freeze(
    frozenTasks.filter((task) => task.disposition === ClarificationDisposition.NEEDS_INPUT),
  );
  const manualOnly = Object.freeze(
    frozenTasks.filter((task) => task.disposition === ClarificationDisposition.MANUAL_ONLY),
  );

  return Object.freeze({
    version: 1,
    candidateId: cleanText(profile?.id) || null,
    tasks: frozenTasks,
    needsInput,
    manualOnly,
    counts: Object.freeze({
      total: frozenTasks.length,
      needsInput: needsInput.length,
      manualOnly: manualOnly.length,
      required: frozenTasks.filter((task) => task.required).length,
    }),
  });
}

export {
  EmploymentType,
  JobSource,
  WorkplaceType,
  annualizeCompensation,
  createDedupeKey,
  isNormalizedJob,
  normalizeCompensation,
  normalizeEmploymentType,
  normalizeJob,
  normalizeJobs,
  normalizeSource,
  normalizeWorkplaceType,
} from "./jobs.js";

export { PolicyStatus, evaluatePolicy, roleMatchesTarget, summarizePolicy } from "./policy.js";
export { MatchWeights, scoreJobMatch, summarizeMatch } from "./matching.js";
export { buildApplicationDraft } from "./drafts.js";
export {
  FormAnswerBucket,
  QuestionAction,
  QuestionCategory,
  QuestionKind,
  classifyFormQuestion,
  normalizeFormQuestion,
  resolveFormQuestion,
  resolveFormQuestions,
  resolvePresentFormQuestions,
} from "./form-answer-resolver.js";
export {
  DEFAULT_RESUME_INTAKE_FIELDS,
  analyzeResumeIntake,
  extractResumeProfileHints,
} from "./resume-intake.js";
export {
  ClarificationDisposition,
  ClarificationKind,
  buildClarificationQueue,
} from "./clarification-queue.js";
export {
  ApplicationState,
  ApplicationTransitions,
  InvalidApplicationTransitionError,
  applicationTimeline,
  canTransitionApplication,
  createApplication,
  isTerminalApplicationState,
  nextApplicationStates,
  transitionApplication,
} from "./application-state.js";
export { createSeedData, seedJobs, seedProfile } from "./seed.js";

import { isNormalizedJob, normalizeJob } from "./jobs.js";
import { scoreJobMatch } from "./matching.js";
import { evaluatePolicy } from "./policy.js";

/**
 * The dashboard-friendly façade: normalize once, evaluate policy and fit, then
 * expose a single recommendation without hiding the underlying explanations.
 */
export function evaluateJob(profile = {}, jobInput, options = {}) {
  const job = isNormalizedJob(jobInput) ? jobInput : normalizeJob(jobInput);
  const policy = evaluatePolicy(job, profile, options.policy ?? {});
  const match = scoreJobMatch(job, profile);
  const recommendation = policy.eligible ? match.recommendation : "blocked";

  return Object.freeze({
    job,
    policy,
    match,
    recommendation,
    readyForDraft: policy.eligible && match.confidence >= 40,
  });
}

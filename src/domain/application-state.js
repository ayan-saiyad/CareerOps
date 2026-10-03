import { cleanText, deepClone, stableHash } from "./utils.js";

export const ApplicationState = Object.freeze({
  DISCOVERED: "discovered",
  ELIGIBLE: "eligible",
  DRAFT_READY: "draft_ready",
  IN_REVIEW: "in_review",
  READY_TO_FILL: "ready_to_fill",
  FILLED: "filled",
  USER_SUBMITTED: "user_submitted",
  CONFIRMED: "confirmed",
  SKIPPED: "skipped",
  NEEDS_HUMAN: "needs_human",
  BLOCKED: "blocked",
  UNKNOWN: "unknown",
});

const transitionEntries = {
  [ApplicationState.DISCOVERED]: [
    ApplicationState.ELIGIBLE,
    ApplicationState.SKIPPED,
    ApplicationState.BLOCKED,
    ApplicationState.NEEDS_HUMAN,
  ],
  [ApplicationState.ELIGIBLE]: [
    ApplicationState.DRAFT_READY,
    ApplicationState.SKIPPED,
    ApplicationState.BLOCKED,
    ApplicationState.NEEDS_HUMAN,
  ],
  [ApplicationState.DRAFT_READY]: [
    ApplicationState.IN_REVIEW,
    ApplicationState.SKIPPED,
    ApplicationState.BLOCKED,
    ApplicationState.NEEDS_HUMAN,
  ],
  [ApplicationState.IN_REVIEW]: [
    ApplicationState.DRAFT_READY,
    ApplicationState.READY_TO_FILL,
    ApplicationState.NEEDS_HUMAN,
    ApplicationState.BLOCKED,
    ApplicationState.SKIPPED,
  ],
  [ApplicationState.READY_TO_FILL]: [
    ApplicationState.IN_REVIEW,
    ApplicationState.FILLED,
    ApplicationState.NEEDS_HUMAN,
    ApplicationState.BLOCKED,
    ApplicationState.SKIPPED,
  ],
  [ApplicationState.FILLED]: [
    ApplicationState.USER_SUBMITTED,
    ApplicationState.READY_TO_FILL,
    ApplicationState.NEEDS_HUMAN,
    ApplicationState.BLOCKED,
    ApplicationState.UNKNOWN,
    ApplicationState.SKIPPED,
  ],
  [ApplicationState.USER_SUBMITTED]: [
    ApplicationState.CONFIRMED,
    ApplicationState.UNKNOWN,
    ApplicationState.NEEDS_HUMAN,
  ],
  [ApplicationState.NEEDS_HUMAN]: [
    ApplicationState.DISCOVERED,
    ApplicationState.ELIGIBLE,
    ApplicationState.DRAFT_READY,
    ApplicationState.IN_REVIEW,
    ApplicationState.READY_TO_FILL,
    ApplicationState.FILLED,
    ApplicationState.BLOCKED,
    ApplicationState.SKIPPED,
  ],
  [ApplicationState.BLOCKED]: [
    ApplicationState.DISCOVERED,
    ApplicationState.ELIGIBLE,
    ApplicationState.DRAFT_READY,
    ApplicationState.IN_REVIEW,
    ApplicationState.READY_TO_FILL,
    ApplicationState.NEEDS_HUMAN,
    ApplicationState.SKIPPED,
  ],
  [ApplicationState.UNKNOWN]: [
    ApplicationState.CONFIRMED,
    ApplicationState.NEEDS_HUMAN,
    ApplicationState.READY_TO_FILL,
    ApplicationState.SKIPPED,
  ],
  [ApplicationState.CONFIRMED]: [],
  [ApplicationState.SKIPPED]: [],
};

export const ApplicationTransitions = Object.freeze(
  Object.fromEntries(
    Object.entries(transitionEntries).map(([state, nextStates]) => [state, Object.freeze([...nextStates])]),
  ),
);

export class InvalidApplicationTransitionError extends Error {
  constructor(from, to) {
    super(`Cannot transition an application from "${from}" to "${to}".`);
    this.name = "InvalidApplicationTransitionError";
  }
}

function isKnownState(state) {
  return Object.values(ApplicationState).includes(state);
}

function normalizeTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new TypeError("Application event timestamps must be valid dates.");
  return date.toISOString();
}

function freezeValue(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeValue(child);
  return Object.freeze(value);
}

function freezeEvent(event) {
  return Object.freeze({
    ...event,
    metadata: event.metadata ? freezeValue(deepClone(event.metadata)) : null,
  });
}

export function canTransitionApplication(from, to) {
  return Boolean(ApplicationTransitions[from]?.includes(to));
}

export function isTerminalApplicationState(state) {
  return isKnownState(state) && ApplicationTransitions[state].length === 0;
}

export function nextApplicationStates(state) {
  return ApplicationTransitions[state] ?? Object.freeze([]);
}

/**
 * Create a ledger-backed application aggregate. `created` is itself an event so
 * callers can render a complete timeline without special cases.
 */
export function createApplication(input = {}) {
  const state = input.state ?? ApplicationState.DISCOVERED;
  if (!isKnownState(state)) throw new TypeError(`Unknown application state: ${state}`);
  const createdAt = normalizeTimestamp(input.createdAt);
  const jobId = cleanText(input.jobId);
  if (!jobId) throw new TypeError("An application requires a jobId.");
  const id = cleanText(input.id) || `application-${stableHash(`${jobId}|${createdAt}`)}`;
  const createdEvent = freezeEvent({
    id: `${id}:event-1`,
    type: "application_created",
    from: null,
    to: state,
    at: createdAt,
    actor: cleanText(input.actor) || "user",
    note: cleanText(input.note) || null,
    metadata: input.metadata ?? null,
  });

  return Object.freeze({
    schemaVersion: 1,
    id,
    jobId,
    state,
    createdAt,
    updatedAt: createdAt,
    events: Object.freeze([createdEvent]),
    metadata: input.metadata ? freezeValue(deepClone(input.metadata)) : null,
  });
}

/**
 * Return a new aggregate with one immutable transition event appended. The
 * function never submits an application; `user_submitted` is merely the user's
 * recorded confirmation that they clicked the site's native submit control.
 */
export function transitionApplication(application, nextState, details = {}) {
  if (!application || typeof application !== "object") {
    throw new TypeError("transitionApplication expects an application object.");
  }
  if (!isKnownState(nextState)) throw new TypeError(`Unknown application state: ${nextState}`);
  if (!canTransitionApplication(application.state, nextState)) {
    throw new InvalidApplicationTransitionError(application.state, nextState);
  }

  const at = normalizeTimestamp(details.at);
  const events = Array.isArray(application.events) ? application.events : [];
  const event = freezeEvent({
    id: `${application.id}:event-${events.length + 1}`,
    type: "state_transitioned",
    from: application.state,
    to: nextState,
    at,
    actor: cleanText(details.actor) || "user",
    note: cleanText(details.note) || null,
    metadata: details.metadata ?? null,
  });

  return Object.freeze({
    ...application,
    state: nextState,
    updatedAt: at,
    events: Object.freeze([...events, event]),
  });
}

export function applicationTimeline(application) {
  return Object.freeze([...(application?.events ?? [])]);
}

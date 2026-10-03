import assert from "node:assert/strict";
import test from "node:test";

import {
  ApplicationState,
  InvalidApplicationTransitionError,
  canTransitionApplication,
  createApplication,
  transitionApplication,
} from "../../src/domain/index.js";

test("application state follows a human-confirmed submission path immutably", () => {
  const application = createApplication({
    id: "application-demo",
    jobId: "demo:northstar-platform-101",
    createdAt: "2026-10-01T09:00:00.000Z",
  });
  const eligible = transitionApplication(application, ApplicationState.ELIGIBLE, {
    at: "2026-10-01T09:01:00.000Z",
    note: "Passed preferences.",
  });

  assert.equal(application.state, ApplicationState.DISCOVERED);
  assert.equal(eligible.state, ApplicationState.ELIGIBLE);
  assert.equal(eligible.events.length, 2);
  assert.equal(eligible.events[1].from, ApplicationState.DISCOVERED);
  assert.equal(eligible.events[1].to, ApplicationState.ELIGIBLE);
  assert.ok(Object.isFrozen(eligible));
});

test("application state rejects skipped review and browser-submit shortcuts", () => {
  const application = createApplication({ jobId: "demo:job", createdAt: "2026-10-01T09:00:00.000Z" });

  assert.equal(canTransitionApplication(ApplicationState.FILLED, ApplicationState.USER_SUBMITTED), true);
  assert.equal(canTransitionApplication(ApplicationState.READY_TO_FILL, ApplicationState.USER_SUBMITTED), false);
  assert.throws(
    () => transitionApplication(application, ApplicationState.USER_SUBMITTED),
    InvalidApplicationTransitionError,
  );
});

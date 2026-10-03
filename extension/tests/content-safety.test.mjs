import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadContentSafetyHooks() {
  const hooks = {};
  const context = {
    globalThis: {
      __CAREEROPS_CONTENT_TEST_HOOKS__: hooks
    }
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL("../content.js", import.meta.url), "utf8"), context, {
    filename: "content.js"
  });
  return hooks;
}

const hooks = loadContentSafetyHooks();

test("chooses only an unambiguous application-form candidate instead of combining form scopes", () => {
  const newsletterScore = hooks.applicationScopeScore({
    controlCount: 12,
    requiredCount: 0,
    scopeText: "newsletter signup"
  });
  const applicationScore = hooks.applicationScopeScore({
    controlCount: 1,
    requiredCount: 1,
    scopeText: "candidate job application",
    applicationMarkerCount: 2
  });

  const chosen = hooks.selectScopeCandidate([
    {
      scope: "newsletter",
      index: 0,
      controlCount: 12,
      requiredCount: 0,
      applicationEvidence: hooks.applicationScopeEvidence("newsletter signup", 0),
      score: newsletterScore
    },
    {
      scope: "application",
      index: 1,
      controlCount: 1,
      requiredCount: 1,
      applicationEvidence: hooks.applicationScopeEvidence("candidate job application", 2),
      score: applicationScore
    }
  ]);
  assert.equal(chosen.scope, "application");

  const ambiguousGenericForms = hooks.selectScopeCandidate([
    { scope: "first", index: 0, controlCount: 2, requiredCount: 1, applicationEvidence: 1, score: 42 },
    { scope: "second", index: 1, controlCount: 2, requiredCount: 1, applicationEvidence: 1, score: 42 }
  ]);
  assert.equal(ambiguousGenericForms, null);

  const singleGenericForm = hooks.selectScopeCandidate([
    { scope: "only", index: 0, controlCount: 2, requiredCount: 1, applicationEvidence: 0, score: 42 }
  ]);
  assert.equal(singleGenericForm.scope, "only");
});

test("marks conditional and dependent metadata or instructions for direct review", () => {
  const conditionalContainer = hooks.conditionalMetadataReason([
    { name: "class", value: "wd-control is-conditional" }
  ]);
  const dependencyAttribute = hooks.conditionalMetadataReason([
    { name: "data-show-if", value: "formerEmployee=yes" }
  ]);
  const conditionalInstruction = hooks.conditionalMetadataReason([], "Only shown if you answered Yes to the previous question.");
  const routineField = hooks.conditionalMetadataReason([
    { name: "name", value: "firstName" }
  ], "First name");

  assert.match(conditionalContainer, /conditional or dependent/i);
  assert.match(dependencyAttribute, /conditional or dependent/i);
  assert.match(conditionalInstruction, /conditional instruction/i);
  assert.equal(routineField, "");
});

const state = {
  tabId: null,
  allowed: false,
  local: false,
  plan: null
};

const elements = {
  statusDot: document.getElementById("statusDot"),
  statusTitle: document.getElementById("statusTitle"),
  statusMessage: document.getElementById("statusMessage"),
  syncButton: document.getElementById("syncButton"),
  previewButton: document.getElementById("previewButton"),
  planSection: document.getElementById("planSection"),
  planSource: document.getElementById("planSource"),
  planSummary: document.getElementById("planSummary"),
  planList: document.getElementById("planList"),
  requirementsSection: document.getElementById("requirementsSection"),
  requirementsCount: document.getElementById("requirementsCount"),
  requirementsSummary: document.getElementById("requirementsSummary"),
  requirementsList: document.getElementById("requirementsList"),
  fillButton: document.getElementById("fillButton"),
  resultMessage: document.getElementById("resultMessage")
};

document.addEventListener("DOMContentLoaded", initialize);
elements.previewButton.addEventListener("click", previewPlan);
elements.syncButton.addEventListener("click", syncLocalDraft);
elements.fillButton.addEventListener("click", fillSelectedFields);

async function initialize() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active browser tab was available.");
    }

    state.tabId = tab.id;
    const response = await sendMessage({ type: "CAREEROPS_PAGE_STATUS", tabId: tab.id });
    if (!response?.ok) {
      throw new Error(response?.error || "CareerOps could not check this page.");
    }

    state.allowed = response.allowed === true;
    state.local = response.local === true;
    setStatus(state.allowed ? "ready" : "blocked", state.allowed ? "Local form adapter ready" : "Unsupported page", response.message);
    elements.previewButton.disabled = !state.allowed;
    elements.syncButton.hidden = !state.local;
    elements.syncButton.disabled = !state.local;
  } catch (error) {
    setStatus("blocked", "Could not inspect this page", messageFor(error));
  }
}

async function syncLocalDraft() {
  if (!state.local || !state.tabId) return;

  setBusy(elements.syncButton, true, "Syncing reviewed plan…");
  clearResult();
  try {
    const response = await sendMessage({ type: "CAREEROPS_SYNC_LOCAL_DRAFT", tabId: state.tabId });
    if (!response?.ok) throw new Error(response?.error || "CareerOps could not sync the local FillPlan.");

    const expiresAt = new Date(response.expiresAt);
    const expiry = Number.isNaN(expiresAt.getTime())
      ? "its expiry"
      : `until ${expiresAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    const routine = response.routineFieldCount || 0;
    const questions = response.approvedQuestionCount || 0;
    const verified = response.verifiedQuestionCount || 0;
    showResult(`Synced ${routine} reusable profile field${routine === 1 ? "" : "s"}, ${verified} verified standard answer${verified === 1 ? "" : "s"}, and ${questions} candidate-approved question${questions === 1 ? "" : "s"} ${expiry}. It remains only in extension memory.`);
  } catch (error) {
    showResult(messageFor(error), true);
  } finally {
    setBusy(elements.syncButton, false, "Sync reviewed FillPlan for this browser session");
  }
}

async function previewPlan() {
  if (!state.allowed || !state.tabId) {
    return;
  }

  setBusy(elements.previewButton, true, "Creating preview…");
  clearResult();
  try {
    const response = await sendMessage({ type: "CAREEROPS_PREVIEW_REQUEST", tabId: state.tabId });
    if (!response?.ok) {
      throw new Error(response?.error || "CareerOps could not create a fill plan.");
    }

    state.plan = response.plan;
    renderPlan(response.plan);
  } catch (error) {
    state.plan = null;
    elements.planSection.hidden = true;
    showResult(messageFor(error), true);
  } finally {
    setBusy(elements.previewButton, false, "Preview reviewed fields");
  }
}

async function fillSelectedFields() {
  if (!state.plan || !state.tabId) {
    return;
  }

  const fieldIds = selectedFieldIds();
  if (fieldIds.length === 0) {
    showResult("Select at least one eligible field before filling.", true);
    return;
  }

  setBusy(elements.fillButton, true, "Filling reviewed fields…");
  clearResult();
  try {
    const response = await sendMessage({
      type: "CAREEROPS_FILL_REQUEST",
      tabId: state.tabId,
      nonce: state.plan.nonce,
      fieldIds
    });
    if (!response?.ok) {
      throw new Error(response?.error || "CareerOps could not fill the selected fields.");
    }

    const appliedCount = response.applied?.length || 0;
    const skippedCount = response.skipped?.length || 0;
    const skippedMessage = skippedCount ? ` ${skippedCount} field${skippedCount === 1 ? "" : "s"} changed or was skipped.` : "";
    showResult(`Filled ${appliedCount} reviewed field${appliedCount === 1 ? "" : "s"}. The form was not submitted.${skippedMessage}`);
    state.plan = null;
    elements.planSection.hidden = true;
  } catch (error) {
    showResult(messageFor(error), true);
  } finally {
    setBusy(elements.fillButton, false, "Fill selected fields — never submit");
  }
}

function renderPlan(plan) {
  elements.planSection.hidden = false;
  elements.planList.replaceChildren();
  const sourceLabel = plan.source === "local-draft" ? "Local draft" : "Synthetic demo";
  elements.planSource.textContent = sourceLabel;

  const count = plan.fields.length;
  const requirements = Array.isArray(plan.manualFields) ? plan.manualFields : [];
  renderRequirements(requirements);

  if (count === 0) {
    elements.planSummary.textContent = emptyPlanSummary(plan);
    elements.fillButton.disabled = true;
    return;
  }

  const required = plan.requiredCount ? ` ${plan.requiredCount} currently rendered field${plan.requiredCount === 1 ? " is" : "s are"} marked required by the page.` : "";
  const manual = requirements.length ? ` ${requirements.length} current-form requirement${requirements.length === 1 ? " needs" : "s need"} your attention below.` : "";
  elements.planSummary.textContent = `${count} reviewed answer${count === 1 ? " is" : "s are"} ready from ${plan.writableCount} writable native control${plan.writableCount === 1 ? "" : "s"}. Deselect anything you do not want changed.${required}${manual}`;
  for (const field of plan.fields) {
    elements.planList.append(createFieldChoice(field));
  }
  elements.fillButton.disabled = false;
}

function createFieldChoice(field) {
  const item = document.createElement("li");
  const label = document.createElement("label");
  label.className = "choice";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = true;
  checkbox.dataset.fieldId = field.id;
  checkbox.addEventListener("change", updateFillButton);

  const content = document.createElement("span");
  const displayLabel = document.createElement("span");
  displayLabel.className = "field-label";
  displayLabel.textContent = field.label;
  const key = document.createElement("span");
  key.className = "field-key";
  key.textContent = `${field.kind} · ${field.source}${field.required ? " · required" : ""}`;
  displayLabel.append(key);
  const question = document.createElement("span");
  question.className = "field-question";
  question.textContent = field.question;
  const value = document.createElement("code");
  value.textContent = field.value;
  content.append(displayLabel, question, value);
  label.append(checkbox, content);
  item.append(label);
  return item;
}

function renderRequirements(requirements) {
  elements.requirementsList.replaceChildren();
  elements.requirementsSection.hidden = requirements.length === 0;
  if (!requirements.length) return;

  const requiredCount = requirements.filter((field) => field.required).length;
  elements.requirementsCount.textContent = `${requirements.length}`;
  elements.requirementsSummary.textContent = requiredCount
    ? `${requiredCount} of these fields are marked required by the current page. CareerOps does not invent answers.`
    : "These currently rendered fields need an answer or a manual action before you continue.";

  for (const field of requirements) {
    elements.requirementsList.append(createRequirement(field));
  }
}

function createRequirement(field) {
  const item = document.createElement("li");
  item.className = "requirement";

  const heading = document.createElement("span");
  heading.className = "requirement-label";
  heading.textContent = field.label;

  const state = document.createElement("span");
  state.className = `requirement-state${field.required ? " required" : ""}`;
  state.textContent = field.required ? "Required" : "Optional";
  heading.append(state);

  const question = document.createElement("span");
  question.className = "requirement-question";
  question.textContent = field.question;

  const reason = document.createElement("span");
  reason.className = "requirement-reason";
  reason.textContent = field.reason;

  item.append(heading, question, reason);
  return item;
}

function emptyPlanSummary(plan) {
  if (!plan.detectedCount) {
    return "No visible native or accessible form controls are currently rendered on this page.";
  }
  if (plan.manualFields?.length) {
    return "No current-form field is ready to fill. Review the required and manual items below; unknown questions stay empty.";
  }
  if (plan.writableCount) {
    return "Writable native controls were found, but this FillPlan has no verified values for them.";
  }
  return "Only manual or unsupported controls are currently rendered, so nothing can be filled.";
}

function selectedFieldIds() {
  return Array.from(elements.planList.querySelectorAll("input[data-field-id]:checked"), (input) => input.dataset.fieldId);
}

function updateFillButton() {
  elements.fillButton.disabled = selectedFieldIds().length === 0;
}

function setStatus(kind, title, message) {
  elements.statusDot.className = `status-dot ${kind}`;
  elements.statusTitle.textContent = title;
  elements.statusMessage.textContent = message;
}

function showResult(message, isError = false) {
  elements.resultMessage.textContent = message;
  elements.resultMessage.classList.toggle("error", isError);
}

function clearResult() {
  showResult("");
}

function setBusy(button, busy, label) {
  const unavailable = button === elements.previewButton
    ? !state.allowed
    : button === elements.syncButton
      ? !state.local
      : !state.plan || selectedFieldIds().length === 0;
  button.disabled = busy || unavailable;
  button.textContent = label;
}

function messageFor(error) {
  return error instanceof Error ? error.message : "An unexpected extension error occurred.";
}

async function sendMessage(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch {
    throw new Error("The CareerOps extension service worker is unavailable. Close and reopen the popup.");
  }
}

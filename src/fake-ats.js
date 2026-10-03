const draftStorageKey = "careerops.activeDraft";

function loadDraft() {
  try {
    return JSON.parse(window.localStorage.getItem(draftStorageKey) ?? "null");
  } catch {
    return null;
  }
}

const draft = loadDraft();
const jobTitle = document.querySelector("#ats-job-title");
const company = document.querySelector("#ats-company");
const preview = document.querySelector("#fill-plan-preview");
const previewButton = document.querySelector("#preview-fill");
const form = document.querySelector("#demo-application-form");

if (draft?.job) {
  jobTitle.textContent = draft.job.title ?? jobTitle.textContent;
  company.textContent = draft.job.company ?? company.textContent;
}

function safeText(value) {
  return String(value ?? "").trim();
}

function getFields(activeDraft) {
  return activeDraft?.fields ?? activeDraft?.candidate ?? activeDraft?.answers ?? {};
}

previewButton.addEventListener("click", () => {
  const fields = getFields(draft);
  const available = Object.entries(fields).filter(([, value]) => safeText(value));

  if (!available.length) {
    preview.hidden = false;
    preview.textContent = "No approved FillPlan is available. Return to CareerOps and open a reviewed application workspace first.";
    return;
  }

  for (const [name, value] of available) {
    const field = document.querySelector(`[data-careerops-field="${CSS.escape(name)}"]`);
    if (field && !(field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) {
      field.value = safeText(value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  preview.hidden = false;
  preview.replaceChildren();
  const summary = document.createElement("span");
  summary.textContent = "Previewed ordinary, approved fields. Review-required fields remain intentionally empty.";
  const list = document.createElement("ul");
  for (const [name] of available) {
    if (document.querySelector(`[data-careerops-field="${CSS.escape(name)}"]`)) {
      const item = document.createElement("li");
      item.textContent = name;
      list.append(item);
    }
  }
  preview.append(summary, list);
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!form.reportValidity()) return;

  document.querySelector("#application-stage").hidden = true;
  document.querySelector("#confirmation-stage").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
});

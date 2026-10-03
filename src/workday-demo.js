const planKey = "careerops.activeDraft";
const status = document.querySelector("#wd-plan-status");
const form = document.querySelector("#wd-fixture-form");
const conditional = document.querySelector("#wd-former-employer-detail");

function readPlan() {
  try {
    const plan = JSON.parse(window.localStorage.getItem(planKey) ?? "null");
    if (!plan?.fields || !plan?.job || typeof plan.expiresAt !== "string") return null;
    const expiresAt = Date.parse(plan.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt > Date.now() ? plan : null;
  } catch {
    return null;
  }
}

function requiredControlCount() {
  return form.querySelectorAll("[required]").length;
}

const plan = readPlan();
if (plan) {
  const reusableProfileCount = Object.keys(plan.fields).length;
  const verifiedEligibilityCount = Array.isArray(plan.verifiedQuestions) ? plan.verifiedQuestions.length : 0;
  const approvedCompanyCount = Array.isArray(plan.approvedQuestions) ? plan.approvedQuestions.length : 0;
  status.textContent = `A reviewed FillPlan for ${plan.job.title} at ${plan.job.company} is available: ${reusableProfileCount} reusable profile value${reusableProfileCount === 1 ? "" : "s"} and ${verifiedEligibilityCount} verified eligibility answer${verifiedEligibilityCount === 1 ? "" : "s"} can be previewed.${approvedCompanyCount ? ` ${approvedCompanyCount} exact candidate-authored company response${approvedCompanyCount === 1 ? " is" : "s are"} also available for Preview.` : ""} This fixture has ${requiredControlCount()} required controls; unapproved company-tailored prompts and the legal attestation remain manual.`;
  status.dataset.ready = "true";
} else {
  status.textContent = `No local FillPlan detected. This synthetic fixture currently exposes ${requiredControlCount()} required controls; create a reviewed plan in CareerOps before opening the browser companion.`;
}

document.querySelectorAll("input[name='formerEmployee']").forEach((control) => {
  control.addEventListener("change", () => {
    conditional.hidden = !document.querySelector("input[name='formerEmployee'][value='yes']")?.checked;
  });
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  document.querySelector("#wd-application").hidden = true;
  document.querySelector("#wd-confirmation").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
});

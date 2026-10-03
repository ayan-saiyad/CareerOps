import {
  ClarificationDisposition,
  ClarificationKind,
  FormAnswerBucket,
  QuestionAction,
  analyzeResumeIntake,
  buildClarificationQueue,
  resolvePresentFormQuestions,
} from "./domain/index.js";

const appRoot = document.querySelector("#app");
const toastRegion = document.querySelector("#toast-region");
const activeDraftStorageKey = "careerops.activeDraft";
const maxAnswerLength = 1_500;
let planExpiryTimer = null;

// This local-only sample mirrors the questions visible in workday-demo.html.
// The browser companion remains the runtime source of truth: it scans the
// actual rendered form and will not assume every application asks these.
const localDemoQuestions = Object.freeze([
  { key: "firstName", label: "First name", name: "firstName", required: true },
  { key: "lastName", label: "Last name", name: "lastName", required: true },
  { key: "email", label: "Email address", name: "email", required: true },
  { key: "phone", label: "Phone number", name: "phone", required: true },
  { key: "city", label: "City", name: "city", required: true },
  { key: "state", label: "State / province", name: "state" },
  { key: "linkedin", label: "LinkedIn profile", name: "linkedin" },
  { key: "github", label: "GitHub URL", name: "github" },
  { key: "website", label: "Portfolio or personal website", name: "website" },
  { key: "school", label: "School / university", name: "school" },
  {
    key: "degree",
    label: "Degree",
    name: "degree",
    options: [
      { label: "Bachelor's", value: "bachelors" },
      { label: "Master's", value: "masters" },
      { label: "PhD", value: "phd" },
      { label: "Other", value: "other" },
    ],
  },
  { key: "major", label: "Field of study / major", name: "major" },
  { key: "graduation", label: "Expected graduation date", name: "graduation" },
  {
    key: "workAuthorization",
    label: "Are you legally authorized to work in the United States?",
    name: "workAuthorization",
    required: true,
    options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }],
  },
  {
    key: "sponsorship",
    label: "Will you now or in the future require sponsorship for employment visa status?",
    name: "sponsorship",
    required: true,
    options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }],
  },
  { key: "startDate", label: "Earliest available start date", name: "startDate" },
  { key: "salary", label: "Desired base salary", name: "salary" },
  {
    key: "formerEmployee",
    label: "Have you previously worked for this company?",
    name: "formerEmployee",
    options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }],
  },
  {
    key: "formerEmployerDetail",
    label: "Please identify the former employer record",
    name: "formerEmployerDetail",
    conditional: true,
    present: false,
  },
  { key: "whyThisRole", label: "Why are you interested in this role?", name: "whyThisRole", required: true },
  {
    key: "companySpecificMotivation",
    label: "What aspect of this company's mission motivates you?",
    name: "companySpecificMotivation",
    required: true,
  },
  { key: "gender", label: "Voluntary self-identification: gender", name: "gender" },
  { key: "disability", label: "Voluntary self-identification: disability status", name: "disability" },
  {
    key: "legalAttestation",
    label: "I certify that the information in this application is complete and accurate.",
    name: "legalAttestation",
    inputType: "checkbox",
    required: true,
  },
]);

const state = {
  resumeText: "",
  resumeFileName: "",
  profile: {
    id: "local-candidate",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    location: "",
    links: { linkedin: "", github: "", website: "" },
    education: [],
    authorizedToWork: null,
    requiresSponsorship: null,
  },
  analysis: null,
  answers: new Map(),
  applicationLinks: [],
  lastPlan: readActivePlan(),
};

schedulePlanExpiry(state.lastPlan);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function compactList(values, fallback = "nothing yet") {
  const visible = values.filter(Boolean);
  return visible.length ? visible.join(", ") : fallback;
}

function booleanFromSelect(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function readActivePlan() {
  try {
    const plan = JSON.parse(window.localStorage.getItem(activeDraftStorageKey) ?? "null");
    const expiresAt = Date.parse(plan?.expiresAt ?? "");
    const valid = plan?.version === 1
      && typeof plan.id === "string"
      && plan.id.startsWith("fill-plan-")
      && plan.fields
      && typeof plan.fields === "object"
      && !Array.isArray(plan.fields)
      && plan.job
      && typeof plan.job === "object"
      && Number.isFinite(expiresAt)
      && expiresAt > Date.now();
    if (!valid) {
      window.localStorage.removeItem(activeDraftStorageKey);
      return null;
    }
    return plan;
  } catch {
    return null;
  }
}

function invalidateFillPlan() {
  if (planExpiryTimer !== null) {
    window.clearTimeout(planExpiryTimer);
    planExpiryTimer = null;
  }
  if (!state.lastPlan) return;
  try {
    const stored = JSON.parse(window.localStorage.getItem(activeDraftStorageKey) ?? "null");
    if (stored?.id === state.lastPlan.id) window.localStorage.removeItem(activeDraftStorageKey);
  } catch {
    // A malformed or unavailable local draft is never a reason to retain a
    // potentially stale in-memory plan.
  }
  state.lastPlan = null;
}

function schedulePlanExpiry(plan) {
  if (planExpiryTimer !== null) {
    window.clearTimeout(planExpiryTimer);
    planExpiryTimer = null;
  }
  if (!plan?.id) return;
  const delay = Date.parse(plan.expiresAt) - Date.now();
  if (!Number.isFinite(delay) || delay <= 0) {
    invalidateFillPlan();
    return;
  }
  const planId = plan.id;
  planExpiryTimer = window.setTimeout(() => {
    if (state.lastPlan?.id !== planId) return;
    invalidateFillPlan();
    toast("The temporary FillPlan expired and was cleared from this browser.");
    render();
  }, delay + 20);
}

function locationParts(location) {
  const parts = cleanText(location).split(",").map(cleanText).filter(Boolean);
  return {
    city: parts[0] ?? "",
    // Do not turn a city, province, country string into an incorrect state
    // answer. City can remain reusable; the extra location parts are asked
    // for on the current form instead.
    state: parts.length === 2 ? parts[1] : "",
  };
}

function resolverProfile() {
  const location = locationParts(state.profile.location);
  const education = state.profile.education.map((record) => ({
    ...record,
    ...(record.graduationYear && !record.graduationDate ? { graduationDate: record.graduationYear } : {}),
  }));

  return {
    id: state.profile.id,
    firstName: cleanText(state.profile.firstName),
    lastName: cleanText(state.profile.lastName),
    email: cleanText(state.profile.email),
    phone: cleanText(state.profile.phone),
    location: cleanText(state.profile.location),
    city: location.city,
    state: location.state,
    links: {
      linkedin: cleanText(state.profile.links.linkedin),
      github: cleanText(state.profile.links.github),
      website: cleanText(state.profile.links.website),
    },
    education,
    ...(typeof state.profile.authorizedToWork === "boolean"
      ? { workAuthorization: { authorized: state.profile.authorizedToWork } }
      : {}),
    ...(typeof state.profile.requiresSponsorship === "boolean"
      ? { requiresSponsorship: state.profile.requiresSponsorship }
      : {}),
  };
}

function currentResolutions() {
  return resolvePresentFormQuestions(resolverProfile(), localDemoQuestions);
}

function currentClarifications() {
  return buildClarificationQueue(resolverProfile(), currentResolutions());
}

function resumeAnalysis() {
  return state.analysis ?? analyzeResumeIntake(state.resumeText, resumeSafeProfile());
}

function resumeSafeProfile() {
  return {
    firstName: state.profile.firstName,
    lastName: state.profile.lastName,
    email: state.profile.email,
    phone: state.profile.phone,
    location: state.profile.location,
    links: state.profile.links,
    education: state.profile.education,
  };
}

function mergeResumeHints(extracted) {
  for (const key of ["firstName", "lastName", "email", "phone", "location"]) {
    if (!cleanText(state.profile[key]) && cleanText(extracted?.[key])) {
      state.profile[key] = extracted[key];
    }
  }
  for (const key of ["linkedin", "github", "website"]) {
    if (!cleanText(state.profile.links[key]) && cleanText(extracted?.links?.[key])) {
      state.profile.links[key] = extracted.links[key];
    }
  }
  if (!state.profile.education.length && Array.isArray(extracted?.education)) {
    state.profile.education = extracted.education;
  }
}

function analyzeAndApplyResume() {
  if (!cleanText(state.resumeText)) {
    toast("Paste résumé text first. This local demo does not send it anywhere.");
    return;
  }
  invalidateFillPlan();
  const firstPass = analyzeResumeIntake(state.resumeText, resumeSafeProfile());
  mergeResumeHints(firstPass.extracted);
  state.analysis = analyzeResumeIntake(state.resumeText, resumeSafeProfile());
  toast("Clear reusable details were added to your editable defaults. Review them before making a FillPlan.");
  render();
}

function questionAnswer(taskId) {
  return state.answers.get(taskId) ?? { value: "", approved: false };
}

function saveQuestionAnswer(taskId, value) {
  const normalized = String(value ?? "").slice(0, maxAnswerLength);
  const previous = questionAnswer(taskId);
  if (previous.value !== normalized) invalidateFillPlan();
  const next = { value: normalized, approved: previous.approved && previous.value === normalized };
  state.answers.set(taskId, next);
  return next;
}

function isApprovableTask(task) {
  return task.disposition === ClarificationDisposition.NEEDS_INPUT
    && !task.conditional
    && [ClarificationKind.COMPANY_TAILORED, ClarificationKind.UNKNOWN].includes(task.kind);
}

function isManualResponseTask(task) {
  return task.disposition === ClarificationDisposition.MANUAL_ONLY
    || task.conditional
    || [
      ClarificationKind.COMPENSATION,
      ClarificationKind.AVAILABILITY,
      ClarificationKind.UNVERIFIED_ELIGIBILITY,
      ClarificationKind.MISSING_PROFILE_DATA,
    ].includes(task.kind);
}

function verifiedBoolean(resolution) {
  if (typeof resolution.value === "boolean") return resolution.value;
  const normalized = String(resolution.value ?? "").trim().toLowerCase();
  if (["yes", "true", "y"].includes(normalized)) return true;
  if (["no", "false", "n"].includes(normalized)) return false;
  return null;
}

function questionIdentity(resolution) {
  return resolution.question.name || resolution.question.id || resolution.question.label;
}

function questionStableKeys(question) {
  return [question?.id, question?.name].map(cleanText).filter(Boolean);
}

function taskMatchesResolution(task, resolution) {
  const taskStableKeys = questionStableKeys(task.form);
  const resolutionStableKeys = questionStableKeys(resolution.question);
  if (taskStableKeys.length || resolutionStableKeys.length) {
    return resolutionStableKeys.some((key) => taskStableKeys.includes(key));
  }
  const taskPrompts = [task.form.label, task.prompt].map(cleanText).filter(Boolean);
  const resolutionPrompts = [resolution.question.label].map(cleanText).filter(Boolean);
  return resolutionPrompts.some((prompt) => taskPrompts.includes(prompt));
}

function isRoutineResolution(resolution) {
  return resolution.planBucket === FormAnswerBucket.FIELDS
    && resolution.action === QuestionAction.AUTO_FILL
    && resolution.autoFillEligible
    && resolution.value
    && !resolution.sensitive
    && !resolution.unsupported;
}

function isVerifiedResolution(resolution) {
  return resolution.planBucket === FormAnswerBucket.VERIFIED_QUESTIONS
    && resolution.action === QuestionAction.VERIFIED_AUTO_FILL
    && resolution.autoFillEligible
    && resolution.verified === true
    && verifiedBoolean(resolution) !== null;
}

function createFillPlan() {
  const resolutions = currentResolutions();
  const clarification = buildClarificationQueue(resolverProfile(), resolutions);
  const routines = resolutions.filter(isRoutineResolution);
  const verified = resolutions.filter(isVerifiedResolution);
  const approvedTasks = clarification.needsInput.filter((task) => {
    const answer = questionAnswer(task.id);
    return isApprovableTask(task) && answer.approved && cleanText(answer.value);
  });
  const fields = Object.fromEntries(routines.map((resolution) => [questionIdentity(resolution), resolution.value]));
  const verifiedQuestions = verified.map((resolution) => ({
    verified: true,
    category: "eligibility",
    id: resolution.question.name || resolution.question.id || "",
    question: resolution.question.label,
    value: verifiedBoolean(resolution),
    evidenceIds: resolution.evidenceIds,
  }));
  const approvedQuestions = approvedTasks.map((task) => ({
    approved: true,
    id: task.form.name || task.form.id || "",
    question: task.prompt,
    value: questionAnswer(task.id).value,
    evidenceIds: [`candidate-input:${task.id}`],
  }));
  const reviewOnly = [...new Set(resolutions
    .filter((resolution) => {
      return !isRoutineResolution(resolution)
        && !isVerifiedResolution(resolution)
        && !approvedTasks.some((task) => taskMatchesResolution(task, resolution));
    })
    .flatMap((resolution) => [
      resolution.question.name,
      resolution.question.id,
      resolution.question.label,
    ])
    .filter(Boolean))];
  const plan = {
    version: 1,
    id: `fill-plan-local-${Date.now()}`,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    job: {
      id: "local-workday-fixture",
      title: "Local Workday-style application",
      company: "CareerOps demo",
    },
    fields,
    verifiedQuestions,
    approvedQuestions,
    reviewOnly,
  };
  window.localStorage.setItem(activeDraftStorageKey, JSON.stringify(plan));
  state.lastPlan = plan;
  schedulePlanExpiry(plan);
  toast(`Reviewed FillPlan ready: ${Object.keys(fields).length} defaults, ${verifiedQuestions.length} verified answers, and ${approvedQuestions.length} approved company response${approvedQuestions.length === 1 ? "" : "s"}.`);
  render();
}

function formatPlanExpiry(plan) {
  if (!plan?.expiresAt) return "";
  const date = new Date(plan.expiresAt);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function renderIntakeSummary(analysis) {
  if (!analysis.hasResume) {
    return `<div class="intake-result"><strong>Your résumé stays local.</strong><p>Paste text, then CareerOps will copy only clear, reusable details into the editable defaults below. It will not infer eligibility, compensation, legal, or demographic answers.</p></div>`;
  }
  const extracted = analysis.fields
    .filter((field) => field.key !== "resume")
    .map((field) => `${field.label}<span class="source-chip">${field.source}</span>`);
  const missingRequired = analysis.missingFields.filter((field) => field.required).map((field) => field.label);
  const ambiguity = analysis.ambiguousFields.length ? ` It left ambiguous ${compactList(analysis.ambiguousFields)} blank.` : "";
  return `<div class="intake-result"><strong>Résumé reviewed locally.</strong><p>Reusable details found: ${extracted.length ? extracted.join(" · ") : "no clear reusable fields"}. ${missingRequired.length ? `Still needed: ${compactList(missingRequired)}.` : "Core defaults are present."}${ambiguity}</p></div>`;
}

function renderDefaultField(label, key, value, { type = "text", placeholder = "", spanTwo = false } = {}) {
  return `<label class="${spanTwo ? "span-two" : ""}">${escapeHtml(label)}
    <input type="${type}" data-default-field="${escapeHtml(key)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" />
  </label>`;
}

function primaryEducation() {
  const record = state.profile.education[0] ?? {};
  return {
    school: record.school ?? "",
    degree: record.degree ?? "",
    fieldOfStudy: record.fieldOfStudy ?? record.major ?? "",
    graduationDate: record.graduationDate ?? record.graduationYear ?? "",
  };
}

function renderEducationField(label, key, value, placeholder = "") {
  return `<label>${escapeHtml(label)}
    <input data-education-field="${escapeHtml(key)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" />
  </label>`;
}

function renderDefaults() {
  const profile = state.profile;
  const education = primaryEducation();
  return `<section class="panel simple-card">
    <div class="simple-section-head"><div><h2><span class="simple-step">2</span>Confirm your defaults</h2><p>These are the reusable facts the browser companion may offer to fill after preview.</p></div><span class="simple-badge">Editable</span></div>
    <div class="default-grid">
      ${renderDefaultField("First name", "firstName", profile.firstName, { placeholder: "Avery" })}
      ${renderDefaultField("Last name", "lastName", profile.lastName, { placeholder: "Jordan" })}
      ${renderDefaultField("Email", "email", profile.email, { type: "email", placeholder: "you@example.com" })}
      ${renderDefaultField("Phone", "phone", profile.phone, { type: "tel", placeholder: "+1 555 010 0100" })}
      ${renderDefaultField("Location", "location", profile.location, { spanTwo: true, placeholder: "Chicago, IL" })}
      ${renderDefaultField("LinkedIn", "linkedin", profile.links.linkedin, { type: "url", spanTwo: true, placeholder: "https://www.linkedin.com/in/you" })}
      ${renderDefaultField("GitHub", "github", profile.links.github, { type: "url", spanTwo: true, placeholder: "https://github.com/you" })}
      ${renderDefaultField("Portfolio", "website", profile.links.website, { type: "url", spanTwo: true, placeholder: "https://you.example" })}
      <p class="simple-subheading span-two">Primary education <span>Optional, but commonly requested</span></p>
      ${renderEducationField("School / university", "school", education.school, "Example University")}
      ${renderEducationField("Degree", "degree", education.degree, "B.S.")}
      ${renderEducationField("Field of study", "fieldOfStudy", education.fieldOfStudy, "Computer Science")}
      ${renderEducationField("Graduation date", "graduationDate", education.graduationDate, "May 2026 or 2026")}
      <label>Authorized to work?
        <select data-boolean-field="authorizedToWork"><option value="">Verify before using</option><option value="true" ${profile.authorizedToWork === true ? "selected" : ""}>Yes</option><option value="false" ${profile.authorizedToWork === false ? "selected" : ""}>No</option></select>
      </label>
      <label>Need sponsorship?
        <select data-boolean-field="requiresSponsorship"><option value="">Verify before using</option><option value="true" ${profile.requiresSponsorship === true ? "selected" : ""}>Yes</option><option value="false" ${profile.requiresSponsorship === false ? "selected" : ""}>No</option></select>
      </label>
    </div>
    <p class="small-note">Work authorization and sponsorship are never pulled from your résumé. You confirm them once here; the plan stores them as verified yes/no values only. For a location with more than a city and one state/province, CareerOps leaves the extra address fields for you to confirm.</p>
  </section>`;
}

function renderResumeCard(analysis) {
  return `<section class="panel simple-card">
    <div class="simple-section-head"><div><h2><span class="simple-step">1</span>Paste your résumé</h2><p>Start with the information you already have. CareerOps extracts only clear contact, public-link, and education details.</p></div><span class="simple-badge">Local only</span></div>
    <div class="resume-box">
      <textarea data-resume-input aria-label="Paste résumé text" placeholder="Paste the text of your résumé here. Nothing is sent to a server.">${escapeHtml(state.resumeText)}</textarea>
      <div class="resume-tools"><button class="button" type="button" data-action="analyze-resume">Use résumé details</button><label class="button-secondary file-picker">Choose .txt or .md<input data-resume-file type="file" accept="text/plain,text/markdown,.txt,.md" /></label>${state.resumeFileName ? `<span class="small-note">Loaded: ${escapeHtml(state.resumeFileName)}</span>` : ""}</div>
      <span class="small-note">For a PDF or DOCX, paste its text in this demo. Connecting a hosted ChatGPT/API reader would require a separate opt-in backend and credentials.</span>
    </div>
    ${renderIntakeSummary(analysis)}
  </section>`;
}

function taskBadge(task) {
  if (task.disposition === ClarificationDisposition.MANUAL_ONLY) return `<span class="simple-badge manual">Manual only</span>`;
  if (task.required) return `<span class="simple-badge warn">Required</span>`;
  return `<span class="simple-badge">Ask you</span>`;
}

function taskInput(task, answer) {
  if (task.form.options.length) {
    return `<label class="answer-control">Your answer<select data-question-value="${escapeHtml(task.id)}"><option value="">Choose an answer</option>${task.form.options.map((option) => `<option value="${escapeHtml(option.value)}" ${answer.value === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></label>`;
  }
  return `<label class="answer-control">Your answer<textarea data-question-value="${escapeHtml(task.id)}" maxlength="${maxAnswerLength}" placeholder="Write your answer for this specific application…">${escapeHtml(answer.value)}</textarea></label>`;
}

function renderTask(task) {
  const answer = questionAnswer(task.id);
  const approvable = isApprovableTask(task);
  const manualResponse = isManualResponseTask(task);
  const status = answer.approved
    ? "Approved for this exact question"
    : cleanText(answer.value)
      ? approvable ? "Draft saved — approve this version to include it" : "Saved for your own manual response"
      : "No answer saved";

  if (task.disposition === ClarificationDisposition.MANUAL_ONLY) {
    return `<article class="question-card manual"><header><h3>${escapeHtml(task.prompt)}</h3>${taskBadge(task)}</header><p>${escapeHtml(task.reason)} This stays blank in every FillPlan.</p></article>`;
  }
  if (task.kind === ClarificationKind.MISSING_PROFILE_DATA) {
    return `<article class="question-card"><header><h3>${escapeHtml(task.prompt)}</h3>${taskBadge(task)}</header><p>${escapeHtml(task.reason)} Add it to the defaults section above, then refresh the résumé details or create a new plan.</p></article>`;
  }
  if (task.kind === ClarificationKind.UNVERIFIED_ELIGIBILITY) {
    return `<article class="question-card"><header><h3>${escapeHtml(task.prompt)}</h3>${taskBadge(task)}</header><p>${escapeHtml(task.reason)} Confirm it in the verified defaults section. It cannot be inferred from your résumé.</p></article>`;
  }

  return `<article class="question-card ${manualResponse ? "manual" : ""}" data-question-card="${escapeHtml(task.id)}"><header><h3>${escapeHtml(task.prompt)}</h3>${taskBadge(task)}</header><p>${escapeHtml(task.reason)}${task.existingValue ? ` Current context: ${escapeHtml(task.existingValue)}.` : ""}</p>${taskInput(task, answer)}<div class="answer-actions">${approvable ? `<button class="button-secondary" type="button" data-action="approve-answer" data-task-id="${escapeHtml(task.id)}" ${cleanText(answer.value) ? "" : "disabled"}>${answer.approved ? "Approved for this question" : "Approve this answer"}</button>` : ""}<span class="answer-status ${answer.approved ? "approved" : ""}" data-answer-status="${escapeHtml(task.id)}">${escapeHtml(status)}</span></div>${manualResponse ? `<p class="small-note">This response is for you to review and enter manually. CareerOps will not place it in the FillPlan.</p>` : ""}</article>`;
}

function applicationTasks(clarification) {
  return clarification.tasks.filter((task) => task.kind !== ClarificationKind.MISSING_PROFILE_DATA);
}

function renderQuestions(clarification) {
  const visibleTasks = applicationTasks(clarification);
  const missingDefaults = clarification.needsInput.filter((task) => task.kind === ClarificationKind.MISSING_PROFILE_DATA);
  const missingSummary = missingDefaults.length
    ? ` First, complete ${missingDefaults.length} reusable default${missingDefaults.length === 1 ? "" : "s"} above.`
    : " Your reusable defaults are ready.";
  return `<section class="panel simple-card">
    <div class="simple-section-head"><div><h2><span class="simple-step">3</span>Answer only what this form asks</h2><p>This local fixture shows only the questions that are not reusable defaults. The browser companion separately scans the current real form before it fills anything.${missingSummary}</p></div><span class="simple-badge ${visibleTasks.length ? "warn" : ""}">${visibleTasks.length ? `${visibleTasks.length} to review` : "Ready"}</span></div>
    <div class="question-list">${visibleTasks.length ? visibleTasks.map(renderTask).join("") : "<p class=\"small-note\">All currently visible questions have reusable, approved values.</p>"}</div>
  </section>`;
}

function linkLabel(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function renderQueue(clarification) {
  const currentTasks = applicationTasks(clarification);
  const currentNeedsInput = currentTasks.filter((task) => task.disposition === ClarificationDisposition.NEEDS_INPUT).length;
  const currentManualOnly = currentTasks.filter((task) => task.disposition === ClarificationDisposition.MANUAL_ONLY).length;
  const queue = [
    { label: "Local Workday-style fixture", detail: `${currentNeedsInput} questions need input · ${currentManualOnly} manual-only`, url: "workday-demo.html", local: true },
    ...state.applicationLinks.map((url) => ({ label: linkLabel(url), detail: "Saved for your review — no live-site permission in this demo", url, local: false })),
  ];
  return `<section class="panel simple-card">
    <div class="simple-section-head"><div><h2>Application queue</h2><p>Add links you want to review. CareerOps does not crawl, sign in, or submit applications.</p></div><span class="simple-badge">${queue.length} saved</span></div>
    <form data-add-link class="default-grid" style="margin-top:14px"><label class="span-two">Application URL<input name="applicationUrl" type="url" placeholder="https://company.example/jobs/role" required /></label><button class="button-secondary span-two" type="submit">Add to my queue</button></form>
    <div class="queue-list">${queue.map((item) => `<div class="queue-item-simple"><div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></div><div class="queue-actions"><a class="button-secondary" href="${escapeHtml(item.url)}" ${item.local ? "" : "target=\"_blank\" rel=\"noopener\""}>${item.local ? "Open local form" : "Open link"}</a></div></div>`).join("")}</div>
  </section>`;
}

function renderPlanCard(resolutions, clarification) {
  const routineCount = resolutions.filter(isRoutineResolution).length;
  const verifiedCount = resolutions.filter(isVerifiedResolution).length;
  const approvedCount = clarification.needsInput.filter((task) => isApprovableTask(task) && questionAnswer(task.id).approved).length;
  const plan = state.lastPlan;
  return `<section class="panel simple-card">
    <div class="simple-section-head"><div><h2><span class="simple-step">4</span>Create a reviewed FillPlan</h2><p>Only reusable defaults, verified eligibility, and exact answers you explicitly approved can travel to the companion.</p></div><span class="simple-badge">5 min</span></div>
    <div class="plan-counts"><span>${routineCount} reusable defaults</span><span>${verifiedCount} verified eligibility</span><span>${approvedCount} approved company response${approvedCount === 1 ? "" : "s"}</span></div>
    <div class="answer-actions"><button class="button" type="button" data-action="create-plan">Create reviewed FillPlan</button><a class="button-secondary" href="workday-demo.html">Try local form</a>${plan ? `<button class="button-secondary" type="button" data-action="clear-plan">Clear temporary plan</button>` : ""}</div>
    ${plan ? `<div class="plan-summary"><strong>FillPlan ready until ${escapeHtml(formatPlanExpiry(plan))}</strong><p>${Object.keys(plan.fields).length} routine fields, ${plan.verifiedQuestions.length} verified eligibility answers, and ${plan.approvedQuestions.length} candidate-approved company answers are available for Preview → select → Fill. Legal, compensation, availability, disclosures, uploads, and submission stay manual. It is cleared when it expires while CareerOps is open, or you can clear it now.</p></div>` : ""}
  </section>`;
}

function renderBoundaries() {
  return `<section class="panel simple-card"><h2>What stays with you</h2><p>The assistant removes repetitive typing, not your judgment.</p><ul class="boundary-list"><li>It never invents facts from your résumé.</li><li>It asks only about currently visible, unresolved application fields.</li><li>Checkboxes, legal terms, disclosures, uploads, sign-in, CAPTCHA, and final submission are always manual.</li><li>Real job discovery and Workday access require a separate, explicit per-site opt-in.</li></ul></section>`;
}

function render() {
  const analysis = resumeAnalysis();
  const resolutions = currentResolutions();
  const clarification = currentClarifications();
  appRoot.innerHTML = `<div class="simple-page"><section class="simple-hero"><p class="eyebrow">Simple, local application helper</p><h1>Enter your defaults once. Answer only what changes.</h1><p>Paste a résumé, review the reusable facts, and make a short-lived FillPlan for the application in front of you. CareerOps is designed to pause and ask when a question is personal, company-specific, changing, or protected.</p></section><div class="simple-layout"><div class="simple-stack">${renderResumeCard(analysis)}${renderDefaults()}${renderQuestions(clarification)}</div><aside class="simple-stack">${renderQueue(clarification)}${renderPlanCard(resolutions, clarification)}${renderBoundaries()}</aside></div></div>`;
}

function toast(message) {
  const element = document.createElement("div");
  element.className = "toast";
  element.textContent = message;
  toastRegion.append(element);
  window.setTimeout(() => element.remove(), 4_400);
}

function updateDefaultField(element) {
  const field = element.dataset.defaultField;
  if (!field) return;
  if (["linkedin", "github", "website"].includes(field)) {
    state.profile.links[field] = element.value;
  } else {
    state.profile[field] = element.value;
  }
  invalidateFillPlan();
  state.analysis = null;
}

function updateEducationField(element) {
  const field = element.dataset.educationField;
  if (!field) return;
  const current = { ...(state.profile.education[0] ?? {}) };
  current[field] = element.value;
  const hasEducationValue = Object.values(current).some((value) => cleanText(value));
  state.profile.education = hasEducationValue ? [current] : [];
  invalidateFillPlan();
  state.analysis = null;
}

function updateQuestionUi(taskId, answer) {
  const card = appRoot.querySelector(`[data-question-card="${CSS.escape(taskId)}"]`);
  if (!card) return;
  const status = card.querySelector(`[data-answer-status="${CSS.escape(taskId)}"]`);
  const button = card.querySelector(`[data-action="approve-answer"]`);
  if (status) {
    status.textContent = cleanText(answer.value) ? "Draft saved — approve this version to include it" : "No answer saved";
    status.classList.remove("approved");
  }
  if (button) {
    button.disabled = !cleanText(answer.value);
    button.textContent = "Approve this answer";
  }
}

appRoot.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.matches("[data-resume-input]")) {
    if (state.resumeText !== target.value) invalidateFillPlan();
    state.resumeText = target.value;
    state.resumeFileName = "";
    state.analysis = null;
    return;
  }
  if (target.matches("[data-default-field]")) {
    updateDefaultField(target);
    return;
  }
  if (target.matches("[data-education-field]")) {
    updateEducationField(target);
    return;
  }
  if (target.matches("[data-question-value]")) {
    const answer = saveQuestionAnswer(target.dataset.questionValue, target.value);
    updateQuestionUi(target.dataset.questionValue, answer);
  }
});

appRoot.addEventListener("change", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.matches("[data-boolean-field]")) {
    const value = booleanFromSelect(target.value);
    if (state.profile[target.dataset.booleanField] !== value) invalidateFillPlan();
    state.profile[target.dataset.booleanField] = value;
    state.analysis = null;
    render();
    return;
  }
  if (target.matches("[data-default-field], [data-education-field]")) {
    render();
    return;
  }
  if (target.matches("[data-resume-input], textarea[data-question-value]")) {
    render();
    return;
  }
  if (target.matches("select[data-question-value]")) {
    const answer = saveQuestionAnswer(target.dataset.questionValue, target.value);
    updateQuestionUi(target.dataset.questionValue, answer);
    return;
  }
  if (target.matches("[data-resume-file]")) {
    const file = target.files?.[0];
    if (!file) return;
    if (!/\.(?:txt|md)$/i.test(file.name)) {
      toast("For this local demo, paste text from a PDF or DOCX instead of uploading it.");
      target.value = "";
      return;
    }
    try {
      invalidateFillPlan();
      state.resumeText = await file.text();
      state.resumeFileName = file.name;
      analyzeAndApplyResume();
    } catch {
      toast("CareerOps could not read that text file. Paste the résumé text instead.");
    }
  }
});

appRoot.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("[data-action]") : null;
  if (!target || target.disabled) return;
  const action = target.dataset.action;
  if (action === "analyze-resume") analyzeAndApplyResume();
  if (action === "create-plan") createFillPlan();
  if (action === "clear-plan") {
    invalidateFillPlan();
    toast("The temporary FillPlan was cleared from this browser.");
    render();
  }
  if (action === "approve-answer") {
    const taskId = target.dataset.taskId;
    const answer = questionAnswer(taskId);
    if (!cleanText(answer.value)) {
      toast("Write your own answer before approving it.");
      return;
    }
    invalidateFillPlan();
    state.answers.set(taskId, { ...answer, approved: true });
    toast("Your exact response is approved for this local application only.");
    render();
  }
});

appRoot.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.matches("[data-add-link]")) return;
  event.preventDefault();
  const rawUrl = new FormData(form).get("applicationUrl");
  try {
    const url = new URL(String(rawUrl));
    if (!/^https?:$/.test(url.protocol)) throw new Error("Unsupported protocol");
    url.hash = "";
    const normalized = url.href;
    if (!state.applicationLinks.includes(normalized)) state.applicationLinks.push(normalized);
    toast("Application link saved for your review. This local demo does not access it automatically.");
    render();
  } catch {
    toast("Enter a complete http(s) application URL.");
  }
});

render();

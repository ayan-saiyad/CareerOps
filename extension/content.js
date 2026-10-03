/*
 * CareerOps local form companion.
 *
 * The page DOM is untrusted input. This content script uses it only to build a
 * short-lived, reviewed plan for ordinary, known answers. It never reads
 * password values, uploads a file, presses a button, looks for a submit
 * control, creates an account, or handles authentication.
 */

(() => {
  "use strict";

  const ALLOWED_ORIGINS = new Set([
    "http://localhost:4173",
    "http://127.0.0.1:4173"
  ]);
  const PLAN_TTL_MS = 5 * 60 * 1_000;
  const LOCAL_DRAFT_TTL_MS = 5 * 60 * 1_000;
  const MAX_FIELDS = 16;
  const MAX_REQUIREMENTS = 48;
  const CONTROL_SELECTOR = "input, textarea, select, [role='combobox'], [role='radio'], [role='checkbox'], [role='switch']";
  const FORM_SCOPE_SELECTOR = "form, [role='form']";
  const APPLICATION_SCOPE_PATTERN = /\b(?:application|applicant|candidate|career|job|employment|workday|questionnaire|position)\b/i;
  const CONDITIONAL_ATTRIBUTE_NAME_PATTERN = /(?:^|\s)(?:conditional|condition|dependent|dependency|depends(?:\s+on)?|follow\s*up|show\s*if|visible\s*if|display\s*(?:if|rule|condition)|visibility\s*(?:if|rule|condition)|parent\s*(?:question|answer|field)|trigger)(?:\s|$)/i;
  const CONDITIONAL_METADATA_PATTERN = /\b(?:conditional|dependent|dependency|depends\s+on|follow\s*up|show\s*if|visible\s*if|display\s*(?:if|rule|condition)|visibility\s*(?:if|rule|condition)|parent\s*(?:question|answer|field)|triggered\s+by)\b/i;
  const CONDITIONAL_CONTEXT_PATTERN = /\b(?:if\s+you\s+(?:answered|answer|selected|select|chose|choose)|only\s+(?:shown|displayed|visible)\s+if|(?:shown|displayed|visible|appears?)\s+(?:when|if)|depending\s+on\s+(?:your|the)\s+(?:answer|response|selection)|based\s+on\s+(?:your|the)\s+(?:answer|response|selection)|follow\s*up\s+question|conditional\s+question|dependent\s+question)\b/i;
  const Adapter = globalThis.CareerOpsFormAdapter;
  const TEST_HOOKS = globalThis.__CAREEROPS_CONTENT_TEST_HOOKS__;

  const DEFAULT_DEMO_VALUES = Object.freeze({
    firstName: "Taylor",
    lastName: "Candidate",
    fullName: "Taylor Candidate",
    preferredName: "Taylor",
    email: "taylor.candidate@example.test",
    phone: "+1 555 010 0142",
    city: "Austin, TX",
    website: "https://example.test",
    linkedin: "https://www.linkedin.com/in/taylor-candidate",
    github: "https://github.com/taylor-candidate"
  });

  const pendingPlans = new Map();

  // These small pure helpers are exposed only to the extension's Node test
  // harness. The page world cannot supply this isolated-world value.
  if (TEST_HOOKS && typeof TEST_HOOKS === "object") {
    Object.assign(TEST_HOOKS, {
      applicationScopeEvidence,
      applicationScopeScore,
      conditionalMetadataReason,
      selectScopeCandidate
    });
  }

  if (!Adapter || !isAllowedPage()) return;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !message || typeof message.type !== "string") {
      return undefined;
    }

    if (message.type === "CAREEROPS_BUILD_PLAN") {
      try {
        sendResponse({ ok: true, plan: buildPlan() });
      } catch (error) {
        sendResponse({ ok: false, error: userFacingError(error) });
      }
      return undefined;
    }

    if (message.type === "CAREEROPS_APPLY_PLAN") {
      try {
        sendResponse(applyPlan(message.nonce, message.fieldIds));
      } catch (error) {
        sendResponse({ ok: false, error: userFacingError(error) });
      }
      return undefined;
    }

    if (message.type === "CAREEROPS_EXPORT_DRAFT") {
      try {
        sendResponse(exportDraftForSession());
      } catch (error) {
        sendResponse({ ok: false, error: userFacingError(error) });
      }
      return undefined;
    }

    return undefined;
  });

  installReadinessBadge();

  function buildPlan() {
    if (!isAllowedPage()) throw new Error("This page is outside the CareerOps local allowlist.");

    removeExpiredPlans();
    const scan = collectControls();
    if (scan.ambiguous) {
      throw new Error("CareerOps could not identify one application form on this page. Open the application form by itself or complete this page manually.");
    }
    const draft = getPlanDraft();
    const nonce = createNonce();
    const entries = new Map();
    const fields = [];
    const manualFields = [];

    for (const descriptor of scan.controls) {
      const resolution = resolveAnswer(descriptor, draft);
      if (!resolution.answer) {
        if (manualFields.length < MAX_REQUIREMENTS) {
          manualFields.push(requirementFor(descriptor, resolution.reason));
        }
        continue;
      }

      if (fields.length >= MAX_FIELDS) {
        if (manualFields.length < MAX_REQUIREMENTS) {
          manualFields.push(requirementFor(descriptor, "CareerOps limits each reviewed preview to 16 fillable controls."));
        }
        continue;
      }

      const fieldId = `${nonce}.${fields.length + 1}`;
      const fingerprint = fingerprintFor(descriptor);
      entries.set(fieldId, { descriptor, answer: resolution.answer, fingerprint });
      fields.push({
        id: fieldId,
        key: descriptor.canonicalKey || descriptor.classification.eligibilityKey || "approved-question",
        kind: descriptor.kind,
        label: descriptor.label,
        question: descriptor.question,
        value: resolution.answer.displayValue,
        source: resolution.answer.source,
        adapter: descriptor.adapter,
        required: descriptor.required
      });
    }

    pendingPlans.set(nonce, {
      pageUrl: stripHash(window.location.href),
      expiresAt: Date.now() + PLAN_TTL_MS,
      entries
    });

    return {
      version: 2,
      nonce,
      pageUrl: stripHash(window.location.href),
      source: draft.source,
      detectedCount: scan.detectedCount,
      writableCount: scan.controls.filter((descriptor) => descriptor.writable && descriptor.classification.safe).length,
      requiredCount: scan.requiredCount,
      manualCount: manualFields.length,
      blockedCount: manualFields.filter((field) => field.category === "manual").length,
      manualFields,
      fields
    };
  }

  function applyPlan(nonce, fieldIds) {
    if (!isAllowedPage()) return { ok: false, error: "This page is outside the CareerOps local allowlist." };

    const plan = pendingPlans.get(nonce);
    if (!plan || plan.expiresAt < Date.now()) {
      pendingPlans.delete(nonce);
      return { ok: false, error: "This preview expired. Create a new preview before filling." };
    }
    if (plan.pageUrl !== stripHash(window.location.href)) {
      pendingPlans.delete(nonce);
      return { ok: false, error: "The page changed after preview. Create a new preview before filling." };
    }

    const requested = [...new Set(Array.isArray(fieldIds) ? fieldIds : [])]
      .filter((fieldId) => typeof fieldId === "string" && plan.entries.has(fieldId))
      .slice(0, MAX_FIELDS);
    if (!requested.length) return { ok: false, error: "No reviewed fields were selected." };

    const applied = [];
    const skipped = [];
    for (const fieldId of requested) {
      const entry = plan.entries.get(fieldId);
      const currentDescriptor = entry ? currentEligibleDescriptor(entry) : null;
      const currentAnswer = currentDescriptor ? rebindAnswer(entry.answer, currentDescriptor) : null;
      if (!currentDescriptor || !currentAnswer) {
        skipped.push(fieldId);
        continue;
      }

      try {
        applyAnswer(currentDescriptor, currentAnswer);
        markFilled(currentDescriptor);
        applied.push(fieldId);
      } catch {
        skipped.push(fieldId);
      }
    }

    // Values and DOM references are never retained after a write attempt.
    // This extension intentionally has no call path that submits a form.
    pendingPlans.delete(nonce);
    return { ok: true, applied, skipped };
  }

  function collectControls() {
    const seen = new Set();
    const controls = [];
    let detectedCount = 0;
    let requiredCount = 0;
    const scan = currentFormControls();

    // Keep a preview to one visible, application-like form scope. A header
    // search box or a newsletter form must not be combined with an application
    // form just because they happen to be visible on the same page. Some
    // Workday-like implementations omit a semantic form wrapper, in which
    // case the visible current document is the conservative fallback.
    for (const element of scan.controls) {
      if (seen.has(element) || !isVisibleAndEnabled(element)) continue;

      let descriptor;
      if (isNativeRadio(element)) {
        const radios = nativeRadioGroup(element, scan.scope);
        radios.forEach((radio) => seen.add(radio));
        descriptor = describeRadioGroup(radios, scan.scope);
      } else {
        seen.add(element);
        descriptor = describeControl(element, scan.scope);
      }
      if (!descriptor) continue;

      detectedCount += 1;
      if (descriptor.required) requiredCount += 1;
      controls.push(descriptor);
    }

    return { detectedCount, requiredCount, controls, ambiguous: scan.ambiguous };
  }

  function currentFormControls() {
    const selection = selectApplicationScope();
    if (selection.scope) {
      return { scope: selection.scope, controls: controlsWithinScope(selection.scope), ambiguous: false };
    }
    if (selection.ambiguous) {
      return { scope: null, controls: [], ambiguous: true };
    }
    if (!selection.candidateCount) {
      return {
        scope: null,
        controls: Array.from(document.querySelectorAll(CONTROL_SELECTOR)),
        ambiguous: false
      };
    }
    return { scope: null, controls: [], ambiguous: true };
  }

  function selectApplicationScope() {
    const candidates = Array.from(document.querySelectorAll(FORM_SCOPE_SELECTOR))
      .filter(isVisibleFormScope)
      .map((scope, index) => {
        const controls = controlsWithinScope(scope).filter(isVisibleAndEnabled);
        const requiredCount = controls.filter(isRequiredControl).length;
        const scopeText = formScopeText(scope);
        const applicationMarkerCount = applicationMarkerCountFor(scope);
        return {
          scope,
          index,
          controlCount: controls.length,
          requiredCount,
          applicationEvidence: applicationScopeEvidence(scopeText, applicationMarkerCount),
          score: applicationScopeScore({
            controlCount: controls.length,
            requiredCount,
            scopeText,
            applicationMarkerCount
          })
        };
      });

    const nonemptyCandidates = candidates.filter((candidate) => candidate.controlCount > 0);
    const selected = selectScopeCandidate(nonemptyCandidates);
    return {
      scope: selected?.scope || null,
      candidateCount: nonemptyCandidates.length,
      ambiguous: nonemptyCandidates.length > 1 && !selected,
    };
  }

  function isVisibleFormScope(scope) {
    if (!(scope instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(scope);
    return style.display !== "none" && style.visibility !== "hidden" && scope.getClientRects().length > 0;
  }

  function controlsWithinScope(scope) {
    return Array.from(scope.querySelectorAll(CONTROL_SELECTOR))
      .filter((control) => controlBelongsToScope(control, scope));
  }

  function controlBelongsToScope(control, scope) {
    if (!scope?.contains(control)) return false;
    // A nested semantic form has its own lifecycle. Do not let an outer form
    // claim its controls as part of the current application scope.
    const nearestScope = control.closest(FORM_SCOPE_SELECTOR);
    return !nearestScope || nearestScope === scope;
  }

  function formScopeText(scope) {
    return [
      scope.id,
      scope.getAttribute("name"),
      scope.getAttribute("action"),
      scope.getAttribute("aria-label"),
      textFromIdReferences(scope.getAttribute("aria-labelledby")),
      scope.getAttribute("data-automation-id"),
      scope.getAttribute("data-testid")
    ].filter(Boolean).join(" ");
  }

  function applicationMarkerCountFor(scope) {
    const candidates = [scope, ...Array.from(scope.querySelectorAll("[data-automation-id], [data-testid], [aria-label], [aria-labelledby], [id], [name]"))];
    return candidates
      .filter((candidate) => APPLICATION_SCOPE_PATTERN.test(formScopeText(candidate)))
      .slice(0, 4)
      .length;
  }

  function applicationScopeScore({ controlCount = 0, requiredCount = 0, scopeText = "", applicationMarkerCount = 0 } = {}) {
    const controls = Number.isFinite(controlCount) ? Math.max(0, controlCount) : 0;
    const required = Number.isFinite(requiredCount) ? Math.max(0, requiredCount) : 0;
    const markers = Number.isFinite(applicationMarkerCount) ? Math.max(0, applicationMarkerCount) : 0;
    return (controls * 12)
      + (required * 4)
      + (APPLICATION_SCOPE_PATTERN.test(String(scopeText)) ? 30 : 0)
      + (Math.min(markers, 4) * 8);
  }

  function applicationScopeEvidence(scopeText = "", applicationMarkerCount = 0) {
    const directScopeSignal = APPLICATION_SCOPE_PATTERN.test(String(scopeText)) ? 2 : 0;
    const markers = Number.isFinite(applicationMarkerCount) ? Math.max(0, applicationMarkerCount) : 0;
    return directScopeSignal + Math.min(markers, 4);
  }

  function selectScopeCandidate(candidates) {
    if (!Array.isArray(candidates)) return null;
    const usable = candidates.filter((candidate) => candidate && Number(candidate.controlCount) > 0);
    if (!usable.length) return null;

    // Form metadata is untrusted and multi-form pages are common. We only
    // choose automatically when exactly one visible scope has explicit
    // application evidence, or when exactly one visible form exists at all.
    // Any other multi-form situation fails closed instead of using a size or
    // score heuristic that could target a newsletter, search, or login form.
    const applicationCandidates = usable.filter((candidate) => Number(candidate.applicationEvidence) > 0);
    if (applicationCandidates.length === 1) return applicationCandidates[0];
    if (applicationCandidates.length > 1) return null;
    return usable.length === 1 ? usable[0] : null;
  }

  function describeControl(element, scope) {
    const native = isNativeControl(element);
    const metadata = metadataFor(element, "", scope);
    const classification = classifyControlMetadata(metadata);
    const kind = classification.kind;

    const options = kind === "select" && element instanceof HTMLSelectElement
      ? nativeSelectOptions(element)
      : [];
    const question = metadata.question || metadata.label || metadata.ariaLabel || metadata.placeholder || metadata.name || metadata.id || "Untitled field";

    return {
      element,
      elements: [element],
      kind,
      writable: native && classification.safe && ["text", "select", "checkbox"].includes(kind),
      classification,
      canonicalKey: classification.canonicalKey,
      required: Adapter.isRequiredMetadata(metadata),
      label: compactDisplay(metadata.label || metadata.ariaLabel || question),
      question: compactDisplay(question, 240),
      metadata,
      options,
      adapter: classification.adapter
    };
  }

  function describeRadioGroup(radios, scope) {
    if (!radios.length) return null;
    const anchor = radios[0];
    const metadata = {
      ...metadataFor(anchor, radioQuestion(anchor), scope),
      conditionalReason: radios.map((radio) => conditionalReasonFor(radio, scope)).find(Boolean) || ""
    };
    const classification = classifyControlMetadata({ ...metadata, type: "radio" });
    const question = metadata.question || metadata.label || metadata.name || "Untitled choice";
    return {
      element: anchor,
      elements: radios,
      kind: "radio",
      writable: classification.safe,
      classification,
      canonicalKey: classification.canonicalKey,
      required: radios.some(isRequiredControl) || isRequiredGroup(anchor),
      label: compactDisplay(question),
      question: compactDisplay(question, 240),
      metadata,
      options: radios.map((radio) => ({
        element: radio,
        value: radio.value,
        label: compactDisplay(controlOwnLabel(radio) || radio.getAttribute("aria-label") || radio.value, 180)
      })),
      adapter: classification.adapter
    };
  }

  function metadataFor(element, questionOverride = "", scope = null) {
    const label = controlOwnLabel(element);
    const question = questionOverride || questionFor(element, label);
    const describedBy = textFromIdReferences(element.getAttribute("aria-describedby"));
    return {
      tagName: element.tagName,
      type: element instanceof HTMLInputElement ? element.type : "",
      role: element.getAttribute("role") || "",
      label,
      question,
      ariaLabel: element.getAttribute("aria-label") || "",
      describedBy,
      placeholder: element.getAttribute("placeholder") || "",
      name: element.getAttribute("name") || "",
      id: element.id || "",
      autocomplete: element.getAttribute("autocomplete") || "",
      required: element.required === true,
      ariaRequired: element.getAttribute("aria-required") || "",
      automationId: automationIdFor(element),
      conditionalReason: conditionalReasonFor(element, scope)
    };
  }

  function classifyControlMetadata(metadata) {
    const classification = Adapter.classifyMetadata(metadata);
    if (!metadata.conditionalReason) return classification;

    // A field that is visibly dependent on another answer can change meaning
    // as the applicant progresses. Even an exact profile value or approved
    // answer is not authorization to resolve that dependency automatically.
    return Object.freeze({
      ...classification,
      category: "manual",
      hardManual: true,
      safe: false,
      reason: metadata.conditionalReason
    });
  }

  function conditionalReasonFor(element, scope) {
    let current = element;
    for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
      const atScopeBoundary = current === scope;
      const reason = conditionalMetadataReason(
        attributePairsFor(current),
        atScopeBoundary ? "" : conditionalContextTextFor(current, scope)
      );
      if (reason) return reason;
      if (atScopeBoundary) break;
    }
    return "";
  }

  function attributePairsFor(element) {
    return Array.from(element?.attributes || [], (attribute) => ({
      name: attribute.name,
      value: attribute.value
    }));
  }

  function conditionalContextTextFor(element, scope) {
    const values = [
      element.getAttribute?.("aria-label"),
      textFromIdReferences(element.getAttribute?.("aria-labelledby")),
      textFromIdReferences(element.getAttribute?.("aria-describedby")),
      element.getAttribute?.("placeholder")
    ];

    // Do not inspect the text of a broad section or form: an unrelated
    // conditional hint elsewhere in that region must not make every field
    // manual. A label, fieldset/radiogroup, or single-control wrapper is a
    // sufficiently narrow context for an explicit conditional instruction.
    if (isNarrowFieldContext(element, scope)) {
      values.push(textWithoutControls(element));
    }
    return values.filter(Boolean).join(" ");
  }

  function isNarrowFieldContext(element, scope) {
    if (!element || element === scope) return false;
    if (["LABEL", "FIELDSET"].includes(element.tagName)) return true;
    if (["group", "radiogroup"].includes(element.getAttribute?.("role"))) return true;
    return element.querySelectorAll?.(CONTROL_SELECTOR).length <= 1;
  }

  function conditionalMetadataReason(attributes, contextualText = "") {
    const pairs = Array.isArray(attributes) ? attributes : [];
    for (const attribute of pairs) {
      const name = markerText(attribute?.name);
      const value = markerText(attribute?.value);
      if (CONDITIONAL_ATTRIBUTE_NAME_PATTERN.test(name)) {
        return "This visible control is marked as conditional or dependent, so it requires direct candidate review.";
      }

      const carriesMetadata = name === "class"
        || name === "id"
        || name === "name"
        || name.startsWith("data ")
        || name.startsWith("aria ");
      if (carriesMetadata && CONDITIONAL_METADATA_PATTERN.test(value)) {
        return "This visible control is inside a conditional or dependent section, so it requires direct candidate review.";
      }
    }

    if (CONDITIONAL_CONTEXT_PATTERN.test(markerText(contextualText))) {
      return "This visible control has a conditional instruction, so it requires direct candidate review.";
    }
    return "";
  }

  function markerText(value) {
    return String(value ?? "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_:\-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function questionFor(element, ownLabel = "") {
    const labelledBy = textFromIdReferences(element.getAttribute("aria-labelledby"));
    if (ownLabel) return ownLabel;
    if (labelledBy) return labelledBy;

    const ariaLabel = compactDisplay(element.getAttribute("aria-label"), 240);
    if (ariaLabel) return ariaLabel;

    const container = semanticContainerFor(element);
    const containerLabel = container ? semanticContainerLabel(container, element) : "";
    if (containerLabel) return containerLabel;

    const describedBy = textFromIdReferences(element.getAttribute("aria-describedby"));
    return compactDisplay(describedBy || element.getAttribute("placeholder") || element.getAttribute("name") || element.id, 240);
  }

  function radioQuestion(element) {
    const group = element.closest("[role='radiogroup'], fieldset");
    if (group) {
      const groupLabel = semanticContainerLabel(group, element);
      if (groupLabel) return groupLabel;
    }
    return questionFor(element, "");
  }

  function controlOwnLabel(element) {
    const explicit = element.labels ? Array.from(element.labels).map((label) => compactDisplay(label.textContent, 240)).find(Boolean) : "";
    if (explicit) return explicit;

    const parentLabel = element.closest("label");
    if (parentLabel) {
      const text = textWithoutControls(parentLabel);
      if (text) return compactDisplay(text, 240);
    }

    return "";
  }

  function semanticContainerFor(element) {
    let current = element.parentElement;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      const role = current.getAttribute("role");
      const automationId = current.getAttribute("data-automation-id");
      if (current.tagName === "FIELDSET" || ["group", "radiogroup", "listbox"].includes(role) || automationId) {
        return current;
      }
    }
    return null;
  }

  function semanticContainerLabel(container, control) {
    const legend = compactDisplay(container.querySelector("legend")?.textContent, 240);
    if (legend) return legend;

    const labelledBy = textFromIdReferences(container.getAttribute("aria-labelledby"));
    if (labelledBy) return labelledBy;

    const labelled = Array.from(container.querySelectorAll("label"))
      .filter((label) => !label.contains(control) || label.htmlFor === control.id)
      .map((label) => compactDisplay(textWithoutControls(label), 240))
      .find(Boolean);
    if (labelled) return labelled;

    // Workday frequently decorates human-readable labels with a
    // data-automation-id rather than a stable class name. Treat the attribute
    // as a hint, not a selector contract, and never execute page data.
    const automationLabel = Array.from(container.querySelectorAll("[data-automation-id]"))
      .filter((candidate) => candidate !== control)
      .filter((candidate) => /(?:label|question|prompt)/i.test(candidate.getAttribute("data-automation-id") || ""))
      .map((candidate) => compactDisplay(textWithoutControls(candidate), 240))
      .find(Boolean);
    if (automationLabel) return automationLabel;

    const ariaLabel = compactDisplay(container.getAttribute("aria-label"), 240);
    if (ariaLabel) return ariaLabel;

    return "";
  }

  function textFromIdReferences(value) {
    if (typeof value !== "string") return "";
    return value.split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map((element) => compactDisplay(textWithoutControls(element), 240))
      .filter(Boolean)
      .join(" ");
  }

  function textWithoutControls(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll("input, textarea, select, option, button, [role='radio'], [role='checkbox'], [role='combobox']").forEach((child) => child.remove());
    return clone.textContent || "";
  }

  function automationIdFor(element) {
    let current = element;
    for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
      const value = current.getAttribute?.("data-automation-id");
      if (value) return value;
    }
    return "";
  }

  function resolveAnswer(descriptor, draft) {
    if (!descriptor.classification.safe) {
      return { answer: null, reason: descriptor.classification.reason || "This control is always manual." };
    }
    if (!descriptor.writable) {
      // ARIA widgets are visible in Preview but are never clicked by this
      // extension. A page can give a custom widget arbitrary side effects.
      return { answer: null, reason: "This custom or unsupported control must be completed manually." };
    }
    if (isReviewOnly(descriptor, draft.reviewOnly)) {
      return { answer: null, reason: "This question is excluded by the approved FillPlan." };
    }

    const eligibilityKey = descriptor.classification.eligibilityKey;
    if (eligibilityKey) {
      const verifiedValue = Adapter.findVerifiedQuestion(descriptor.metadata, draft.verifiedQuestions, "eligibility");
      if (verifiedValue === null) {
        return {
          answer: null,
          reason: `A verified ${eligibilityLabel(eligibilityKey)} answer is required before CareerOps can fill this question.`
        };
      }
      const resolved = resolveValueForKind(descriptor, verifiedValue);
      return resolved
        ? { answer: { ...resolved, source: "verified eligibility" }, reason: null }
        : { answer: null, reason: "The verified answer does not exactly match an available native option." };
    }

    if (descriptor.canonicalKey) {
      const routineValue = draft.values[descriptor.canonicalKey];
      if (routineValue !== undefined) {
        const resolved = resolveValueForKind(descriptor, routineValue);
        if (resolved) {
          return {
            answer: { ...resolved, source: draft.source === "local-draft" ? "routine profile" : "synthetic demo" },
            reason: null
          };
        }
      }

      const verifiedValue = Adapter.findVerifiedQuestion(descriptor.metadata, draft.verifiedQuestions, "profile");
      if (verifiedValue !== null) {
        const resolved = resolveValueForKind(descriptor, verifiedValue);
        return resolved
          ? { answer: { ...resolved, source: "verified profile" }, reason: null }
          : { answer: null, reason: "The verified profile answer does not exactly match an available native option." };
      }

      return { answer: null, reason: "No verified profile value is available for this field." };
    }

    // A company-specific prompt must be answered for this application. A
    // candidate-authored answer can be used only when the FillPlan contains a
    // strict, explicit matcher for this exact prompt or stable control ID.
    const approvedValue = Adapter.findApprovedQuestion(descriptor.metadata, draft.approvedQuestions);
    if (approvedValue === null) {
      return {
        answer: null,
        reason: "This company-specific question needs a candidate-authored answer in CareerOps."
      };
    }

    const resolved = resolveValueForKind(descriptor, approvedValue);
    return resolved
      ? { answer: { ...resolved, source: "approved question" }, reason: null }
      : { answer: null, reason: "The candidate-approved answer does not exactly match an available native option." };
  }

  function eligibilityLabel(key) {
    return key === "sponsorship" ? "sponsorship" : "work-authorization";
  }

  function requirementFor(descriptor, reason) {
    return {
      key: descriptor.canonicalKey || descriptor.classification.eligibilityKey || "company-specific",
      kind: descriptor.kind,
      label: descriptor.label,
      question: descriptor.question,
      required: descriptor.required,
      category: descriptor.classification.category,
      reason: compactDisplay(reason || "This field needs your input.", 280),
      adapter: descriptor.adapter
    };
  }

  function resolveValueForKind(descriptor, value) {
    if (descriptor.kind === "text") {
      const text = Adapter.validateApprovedValue(value);
      if (typeof text !== "string") return null;
      return { value: text, displayValue: compactDisplay(text, 500) };
    }

    if (descriptor.kind === "select" || descriptor.kind === "radio") {
      const option = Adapter.matchingOption(descriptor.options, value);
      if (!option) return null;
      return { value: String(option.value), displayValue: compactDisplay(option.label || option.value, 500), target: option.element };
    }

    if (descriptor.kind === "checkbox") {
      const checked = Adapter.booleanValue(value);
      if (checked === null) return null;
      return { value: checked, displayValue: checked ? "Checked" : "Unchecked" };
    }

    return null;
  }

  function getPlanDraft() {
    const localDraft = readLocalDraft();
    if (localDraft.present) {
      if (localDraft.expired) {
        throw new Error("This local FillPlan expired or has an invalid expiry. Create a new reviewed plan before filling.");
      }
      return {
        source: "local-draft",
        values: localDraft.values,
        approvedQuestions: localDraft.approvedQuestions,
        verifiedQuestions: localDraft.verifiedQuestions,
        reviewOnly: localDraft.reviewOnly
      };
    }
    return {
      source: "synthetic-demo",
      values: { ...DEFAULT_DEMO_VALUES },
      approvedQuestions: [],
      verifiedQuestions: [],
      reviewOnly: []
    };
  }

  function readLocalDraft() {
    let raw;
    try {
      raw = window.localStorage.getItem("careerops.activeDraft");
    } catch {
      return { present: false, values: {}, approvedQuestions: [], verifiedQuestions: [], reviewOnly: [], expiresAt: null, expired: false };
    }
    if (raw === null) return { present: false, values: {}, approvedQuestions: [], verifiedQuestions: [], reviewOnly: [], expiresAt: null, expired: false };

    try {
      const parsed = JSON.parse(raw);
      if (!isVersionedFillPlan(parsed)) {
        return { present: true, values: {}, approvedQuestions: [], verifiedQuestions: [], reviewOnly: [], expiresAt: null, expired: true };
      }
      const expiresAt = parseDraftExpiry(parsed.expiresAt);
      return {
        present: true,
        values: routineValuesFrom(parsed),
        approvedQuestions: approvedQuestionsFrom(parsed),
        verifiedQuestions: verifiedQuestionsFrom(parsed),
        reviewOnly: reviewOnlyFrom(parsed),
        expiresAt,
        expired: expiresAt !== null && expiresAt <= Date.now()
      };
    } catch {
      return { present: true, values: {}, approvedQuestions: [], verifiedQuestions: [], reviewOnly: [], expiresAt: null, expired: true };
    }
  }

  function exportDraftForSession() {
    if (!ALLOWED_ORIGINS.has(window.location.origin)) {
      return { ok: false, error: "A reviewed FillPlan can be synced only from the local CareerOps origin." };
    }
    const draft = readLocalDraft();
    if (!draft.present) {
      return { ok: false, error: "No local reviewed FillPlan is available to sync." };
    }
    if (draft.expired) {
      return { ok: false, error: "This local FillPlan expired or has an invalid expiry. Create a new plan before syncing." };
    }

    // This is a normalized, deliberately small transfer object. It contains
    // no raw page DOM, attachments, credentials, or review-only values.
    return {
      ok: true,
      draft: {
        version: 1,
        expiresAt: Math.min(draft.expiresAt, Date.now() + LOCAL_DRAFT_TTL_MS),
        values: draft.values,
        approvedQuestions: draft.approvedQuestions,
        verifiedQuestions: draft.verifiedQuestions,
        reviewOnly: draft.reviewOnly
      }
    };
  }

  function parseDraftExpiry(value) {
    // A stored FillPlan is always expected to carry a timestamp. Treat a
    // missing or malformed expiry as invalid instead of allowing an old local
    // draft to become an indefinite source of personal data.
    if (typeof value !== "string" || !value.trim()) return 0;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function isVersionedFillPlan(value) {
    return Boolean(
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.version === 1 &&
      typeof value.id === "string" &&
      value.id.startsWith("fill-plan-") &&
      typeof value.expiresAt === "string"
    );
  }

  function routineValuesFrom(parsed) {
    const maps = [parsed.fields]
      .filter((value) => value && typeof value === "object" && !Array.isArray(value));
    const values = {};

    for (const key of Object.keys(Adapter.FIELD_DEFINITIONS)) {
      for (const map of maps) {
        const found = Object.entries(map).find(([candidateKey]) => Adapter.canonicalFieldKey({ name: candidateKey }) === key);
        if (!found) continue;
        const value = Adapter.validateRoutineValue(key, found[1]);
        if (value !== null) {
          values[key] = value;
          break;
        }
      }
    }
    return values;
  }

  function approvedQuestionsFrom(parsed) {
    const inputs = [parsed.approvedQuestions, parsed.reviewedQuestions, parsed.fillPlan?.approvedQuestions]
      .filter(Array.isArray)
      .flat();
    return [...inputs, ...safeAnswerMapEntries(parsed)]
      .map(Adapter.normalizeApprovedQuestion)
      .filter(Boolean)
      .slice(0, MAX_FIELDS);
  }

  function verifiedQuestionsFrom(parsed) {
    const inputs = [parsed.verifiedQuestions, parsed.fillPlan?.verifiedQuestions]
      .filter(Array.isArray)
      .flat();
    return inputs
      .map(Adapter.normalizeVerifiedQuestion)
      .filter(Boolean)
      .slice(0, MAX_FIELDS);
  }

  function safeAnswerMapEntries(parsed) {
    const fields = parsed.fields && typeof parsed.fields === "object" && !Array.isArray(parsed.fields) ? parsed.fields : {};
    const source = Array.isArray(parsed.answerMap)
      ? parsed.answerMap
      : parsed.answerMap && typeof parsed.answerMap === "object"
        ? Object.entries(parsed.answerMap).map(([key, value]) => ({ key, ...(value && typeof value === "object" ? value : {}) }))
        : [];

    return source
      .filter((entry) => entry && typeof entry === "object" && typeof entry.key === "string")
      .filter((entry) => entry.approved === true && entry.reviewRequired !== true && entry.sensitive !== true && entry.unsupported !== true)
      .filter((entry) => Object.hasOwn(fields, entry.key) && sameApprovedValue(fields[entry.key], entry.value))
      .map((entry) => ({
        approved: true,
        id: entry.id || entry.fieldId || entry.key,
        question: entry.question || entry.label || "",
        value: entry.value
      }));
  }

  function sameApprovedValue(fieldValue, answerValue) {
    if (typeof fieldValue === "boolean" || typeof answerValue === "boolean") return fieldValue === answerValue;
    return Adapter.normalizeText(fieldValue) === Adapter.normalizeText(answerValue);
  }

  function reviewOnlyFrom(parsed) {
    // `reviewOnly` is a hard exclusion. A dashboard may separately surface a
    // `reviewRequired` state, but an exact `approvedQuestions` record can
    // represent the candidate's later, explicit approval for a non-sensitive
    // answer. Sensitive descriptors are still rejected independently.
    const rawEntries = [parsed.reviewOnly, parsed.fillPlan?.reviewOnly]
      .flatMap((value) => {
        if (Array.isArray(value)) return value;
        if (value && typeof value === "object") return Object.keys(value);
        return [];
      });
    return rawEntries
      .filter((value) => typeof value === "string")
      .map((value) => ({
        key: Adapter.canonicalFieldKey({ name: value }),
        id: Adapter.compactIdentifier(value),
        question: Adapter.questionFingerprint(value)
      }));
  }

  function isReviewOnly(descriptor, reviewOnly) {
    if (!Array.isArray(reviewOnly) || !reviewOnly.length) return false;
    const question = Adapter.questionFingerprint(descriptor.question);
    const ids = new Set(Adapter.normalizedIds(descriptor.metadata));
    return reviewOnly.some((entry) => (
      (entry.key && entry.key === descriptor.canonicalKey) ||
      (entry.id && ids.has(entry.id)) ||
      (entry.question && entry.question === question)
    ));
  }

  function currentEligibleDescriptor(entry) {
    const descriptor = rebuildDescriptor(entry.descriptor);
    return (
      descriptor &&
      descriptor.writable &&
      descriptor.classification.safe &&
      fingerprintFor(descriptor) === entry.fingerprint &&
      descriptor.kind === entry.descriptor.kind
    ) ? descriptor : null;
  }

  function rebindAnswer(answer, descriptor) {
    if (descriptor.kind !== "radio") return answer;
    const matches = descriptor.options.filter((option) => String(option.value) === String(answer.value));
    if (matches.length !== 1) return null;
    return { ...answer, target: matches[0].element };
  }

  function rebuildDescriptor(previous) {
    const selection = selectApplicationScope();
    if (selection.ambiguous) return null;
    const scope = selection.scope;
    if (previous.kind === "radio") {
      const radios = previous.elements.filter((element) => (
        element.isConnected
        && isVisibleAndEnabled(element)
        && isNativeRadio(element)
        && controlIsInCurrentScope(element, scope)
      ));
      return radios.length ? describeRadioGroup(radios, scope) : null;
    }
    return previous.element?.isConnected
      && isVisibleAndEnabled(previous.element)
      && controlIsInCurrentScope(previous.element, scope)
      ? describeControl(previous.element, scope)
      : null;
  }

  function controlIsInCurrentScope(element, scope) {
    return !scope || controlBelongsToScope(element, scope);
  }

  function fingerprintFor(descriptor) {
    return JSON.stringify({
      kind: descriptor.kind,
      canonicalKey: descriptor.canonicalKey || "",
      question: Adapter.questionFingerprint(descriptor.question),
      describedBy: Adapter.questionFingerprint(descriptor.metadata.describedBy),
      ids: Adapter.normalizedIds(descriptor.metadata),
      type: descriptor.metadata.type || "",
      options: descriptor.options.map((option) => [Adapter.normalizeText(option.value), Adapter.normalizeText(option.label)])
    });
  }

  function applyAnswer(descriptor, answer) {
    if (descriptor.kind === "text") {
      setNativeTextValue(descriptor.element, answer.value);
      return;
    }
    if (descriptor.kind === "select") {
      setNativeSelectValue(descriptor.element, answer.value);
      return;
    }
    if (descriptor.kind === "radio") {
      if (!(answer.target instanceof HTMLInputElement) || answer.target.type !== "radio") throw new Error("The reviewed radio option changed.");
      setNativeChecked(answer.target, true);
      return;
    }
    if (descriptor.kind === "checkbox") {
      setNativeChecked(descriptor.element, answer.value);
      return;
    }
    throw new Error("This control is not writable.");
  }

  function setNativeTextValue(element, value) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error("The reviewed text control changed.");
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (!descriptor?.set) throw new Error("This browser did not expose a safe text setter.");
    element.focus({ preventScroll: true });
    descriptor.set.call(element, value);
    dispatchFormEvents(element);
  }

  function setNativeSelectValue(element, value) {
    if (!(element instanceof HTMLSelectElement)) throw new Error("Custom select controls remain manual-only.");
    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    if (!descriptor?.set) throw new Error("This browser did not expose a safe select setter.");
    element.focus({ preventScroll: true });
    descriptor.set.call(element, value);
    dispatchFormEvents(element);
  }

  function setNativeChecked(element, checked) {
    if (!(element instanceof HTMLInputElement) || !["radio", "checkbox"].includes(element.type)) throw new Error("The reviewed choice control changed.");
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
    if (!descriptor?.set) throw new Error("This browser did not expose a safe choice setter.");
    element.focus({ preventScroll: true });
    descriptor.set.call(element, Boolean(checked));
    dispatchFormEvents(element);
  }

  function dispatchFormEvents(element) {
    element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  function markFilled(descriptor) {
    descriptor.elements.forEach((element) => {
      if (element?.isConnected) element.setAttribute("data-careerops-filled", "true");
    });
  }

  function nativeSelectOptions(element) {
    return Array.from(element.options)
      .filter((option) => !option.disabled && Adapter.compactText(option.value || option.textContent, 240))
      .map((option) => ({ element: option, value: option.value, label: Adapter.compactText(option.textContent || option.label || option.value, 240) }));
  }

  function nativeRadioGroup(element, selectedScope) {
    const name = element.getAttribute("name");
    const parentGroup = element.closest("[role='radiogroup'], fieldset");
    if (!name && !parentGroup) return [element];

    // A native radio name is scoped to its owning form. Never use a
    // document-wide selector here: a page can reuse names such as `yesNo` in
    // its header, a newsletter, and an application at the same time.
    const root = radioGroupRoot(element, selectedScope, parentGroup);
    if (!root) return [element];
    return Array.from(root.querySelectorAll("input[type='radio']"))
      .filter((candidate) => isVisibleAndEnabled(candidate))
      .filter((candidate) => !selectedScope || controlBelongsToScope(candidate, selectedScope))
      .filter((candidate) => !selectedScope || candidate.form === element.form || !(selectedScope instanceof HTMLFormElement))
      .filter((candidate) => name ? candidate.getAttribute("name") === name : candidate.closest("[role='radiogroup'], fieldset") === parentGroup);
  }

  function radioGroupRoot(element, selectedScope, parentGroup) {
    if (selectedScope?.contains(element)) return selectedScope;
    if (element.form instanceof HTMLFormElement) return element.form;
    if (parentGroup) return parentGroup;
    return nearestRadioCluster(element);
  }

  function nearestRadioCluster(element) {
    let current = element.parentElement;
    for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
      if (current.querySelectorAll("input[type='radio']").length > 1) return current;
    }
    return null;
  }

  function isNativeRadio(element) {
    return element instanceof HTMLInputElement && element.type === "radio";
  }

  function isNativeControl(element) {
    return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
  }

  function isRequiredControl(element) {
    return Boolean(
      element?.required ||
      element?.getAttribute?.("aria-required") === "true"
    );
  }

  function isRequiredGroup(element) {
    const group = element?.closest?.("[role='radiogroup'], fieldset");
    return Boolean(group?.getAttribute("aria-required") === "true");
  }

  function isVisibleAndEnabled(element) {
    if (!(element instanceof HTMLElement) || element.disabled || element.hasAttribute("readonly") || element.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function compactDisplay(value, maximumLength = 180) {
    return Adapter.compactText(value, maximumLength);
  }

  function installReadinessBadge() {
    const addBadgeIfNeeded = () => {
      if (document.getElementById("careerops-safe-fill-badge")) return true;
      const scan = collectControls();
      if (!scan.controls.some((descriptor) => descriptor.canonicalKey || descriptor.question)) return false;

      const host = document.createElement("aside");
      host.id = "careerops-safe-fill-badge";
      host.setAttribute("aria-label", "CareerOps extension status");
      const shadow = host.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = `
        :host { all: initial; }
        .panel { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; width: min(320px, calc(100vw - 36px)); box-sizing: border-box; border: 1px solid #c9d8ff; border-radius: 14px; background: #ffffff; color: #102047; box-shadow: 0 12px 32px rgba(16, 32, 71, .18); font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 12px 36px 12px 14px; }
        strong { display: block; margin-bottom: 3px; font-size: 13px; }
        p { margin: 0; color: #405277; }
        button { position: absolute; top: 7px; right: 8px; border: 0; background: transparent; color: #405277; cursor: pointer; font-size: 18px; line-height: 1; padding: 4px; }
        button:focus-visible { outline: 2px solid #356dff; outline-offset: 2px; border-radius: 4px; }
      `;
      const panel = document.createElement("div");
      panel.className = "panel";
      const heading = document.createElement("strong");
      heading.textContent = "CareerOps local form detected";
      const message = document.createElement("p");
      message.textContent = "Preview current-form answers and manual requirements in the extension. It never submits.";
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "×";
      close.setAttribute("aria-label", "Dismiss CareerOps status");
      close.addEventListener("click", () => host.remove());
      panel.append(heading, message, close);
      shadow.append(style, panel);
      document.documentElement.append(host);
      return true;
    };

    if (addBadgeIfNeeded()) return;
    const observer = new MutationObserver(() => {
      if (addBadgeIfNeeded()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 15_000);
  }

  function createNonce() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function isAllowedPage() {
    return ALLOWED_ORIGINS.has(window.location.origin);
  }

  function stripHash(value) {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  }

  function removeExpiredPlans() {
    const now = Date.now();
    for (const [nonce, plan] of pendingPlans) {
      if (plan.expiresAt < now) pendingPlans.delete(nonce);
    }
  }

  function userFacingError(error) {
    return error instanceof Error ? error.message : "The extension could not create a safe preview.";
  }
})();

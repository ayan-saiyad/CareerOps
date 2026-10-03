/*
 * Shared, dependency-free form semantics for the CareerOps browser companion.
 *
 * This file deliberately does not inspect values or mutate a page.  The
 * content script supplies metadata from a control, and this adapter turns it
 * into a conservative classification. Keeping the policy here makes it easy
 * to exercise with fixtures without granting the extension any wider host
 * permission.
 */

(() => {
  "use strict";

  const MAX_TEXT_LENGTH = 1_500;
  const SAFE_TEXT_INPUT_TYPES = new Set(["text", "email", "tel", "url", "search"]);
  const BLOCKED_INPUT_TYPES = new Set(["password", "file", "hidden", "image", "submit", "reset", "button"]);

  // These are reusable profile facts, not a list of questions an application
  // is expected to contain. The content script scans the controls that are
  // actually rendered on the current page and only consults this map when a
  // present control has a clear, ordinary profile meaning.
  const FIELD_DEFINITIONS = Object.freeze({
    firstName: Object.freeze({
      aliases: Object.freeze(["first name", "firstname", "given name", "givenname", "forename"]),
      autocomplete: Object.freeze(["given-name"])
    }),
    lastName: Object.freeze({
      aliases: Object.freeze(["last name", "lastname", "family name", "familyname", "surname"]),
      autocomplete: Object.freeze(["family-name"])
    }),
    fullName: Object.freeze({
      aliases: Object.freeze(["full name", "fullname", "name as it appears", "legal name"]),
      autocomplete: Object.freeze(["name"])
    }),
    preferredName: Object.freeze({
      aliases: Object.freeze(["preferred name", "chosen name", "display name"]),
      autocomplete: Object.freeze([])
    }),
    email: Object.freeze({
      aliases: Object.freeze(["email", "email address", "emailaddress"]),
      autocomplete: Object.freeze(["email"])
    }),
    phone: Object.freeze({
      aliases: Object.freeze(["phone", "phone number", "phonenumber", "mobile", "mobile phone", "telephone"]),
      autocomplete: Object.freeze(["tel", "tel-national", "tel-country-code"])
    }),
    city: Object.freeze({
      aliases: Object.freeze(["city", "current city", "location city"]),
      autocomplete: Object.freeze(["address-level2"])
    }),
    state: Object.freeze({
      aliases: Object.freeze(["state", "state province", "state or province", "province", "region"]),
      autocomplete: Object.freeze(["address-level1"])
    }),
    addressLine1: Object.freeze({
      aliases: Object.freeze(["address line 1", "address line one", "street address", "street and number", "mailing address"]),
      autocomplete: Object.freeze(["street-address", "address-line1"])
    }),
    addressLine2: Object.freeze({
      aliases: Object.freeze(["address line 2", "address line two", "apartment", "apt", "suite", "unit"]),
      autocomplete: Object.freeze(["address-line2"])
    }),
    postalCode: Object.freeze({
      aliases: Object.freeze(["zip", "zip code", "postal code", "postcode"]),
      autocomplete: Object.freeze(["postal-code"])
    }),
    country: Object.freeze({
      aliases: Object.freeze(["country", "country of residence", "residence country"]),
      autocomplete: Object.freeze(["country", "country-name"])
    }),
    website: Object.freeze({
      aliases: Object.freeze(["website", "personal website", "portfolio", "portfolio url", "personal site"]),
      autocomplete: Object.freeze(["url"])
    }),
    linkedin: Object.freeze({
      aliases: Object.freeze(["linkedin", "linkedin profile", "linkedin url"]),
      autocomplete: Object.freeze([])
    }),
    github: Object.freeze({
      aliases: Object.freeze(["github", "github profile", "github url"]),
      autocomplete: Object.freeze([])
    }),
    school: Object.freeze({
      aliases: Object.freeze(["school", "university", "college", "school university", "institution"]),
      autocomplete: Object.freeze([])
    }),
    degree: Object.freeze({
      aliases: Object.freeze(["degree", "degree earned", "highest degree"]),
      autocomplete: Object.freeze([])
    }),
    major: Object.freeze({
      aliases: Object.freeze(["major", "field of study", "area of study", "concentration"]),
      autocomplete: Object.freeze([])
    }),
    graduation: Object.freeze({
      aliases: Object.freeze(["graduation date", "expected graduation", "graduation", "degree completion date"]),
      autocomplete: Object.freeze([])
    })
  });

  const ELIGIBILITY_DEFINITIONS = Object.freeze({
    workAuthorization: Object.freeze([
      "authorized to work",
      "authorised to work",
      "work authorization",
      "work authorisation",
      "eligible to work",
      "right to work"
    ]),
    sponsorship: Object.freeze([
      "require sponsorship",
      "need sponsorship",
      "employment sponsorship",
      "visa sponsorship",
      "employment visa status"
    ])
  });

  // A form label is untrusted page data. These are hard, never-overridable
  // categories. Work authorization and sponsorship are intentionally *not*
  // in this list: they can be filled only with an exact `verifiedQuestions`
  // record after the candidate has approved the FillPlan.
  const HARD_MANUAL_RULES = Object.freeze([
    Object.freeze({
      pattern: /(?:\bpass(?:word|code)?\b|credential|log[ -]?in|sign[ -]?in|user[ -]?name|one[ -]?time|\botp\b|multi[ -]?factor|\bmfa\b)/i,
      reason: "Credentials, sign-in, and verification controls are always manual."
    }),
    Object.freeze({
      pattern: /(?:\blegal[ -]?name\b|social security|\bssn\b|tax(?:payer)? id|date of birth|birth ?date|\bdob\b|passport|national id|driver'?s license|security clearance|bank|routing number|account number|credit card)/i,
      reason: "Identity and financial information are always manual."
    }),
    Object.freeze({
      pattern: /(?:\beeo\b|gender|\bsex\b|race|ethnicity|veteran|disab(?:ility|led)|sexual orientation|pronoun|(?:voluntary )?self[ -]?identification|demographic|disclosure|\bage\b|religion|marital status)/i,
      reason: "Demographic and voluntary-disclosure questions are always manual."
    }),
    Object.freeze({
      pattern: /(?:agreement|consent|terms(?: and conditions)?|privacy (?:policy|notice)|\bi (?:agree|accept)\b|\baccept(?:ance)?\b|permission|opt[ -]?(?:in|out)|waiver|release|recruiting updates|attest|certif(?:y|ication)|legal signature|signature|acknowledg(?:e|ement)|authorization to (?:contact|perform|conduct|release)|authorize (?:us|the company|employer|a)|background check|criminal|conviction)/i,
      reason: "Legal agreements, consent, attestations, and signatures are always manual."
    }),
    Object.freeze({
      pattern: /(?:salary|compensation|desired pay|expected pay|pay expectations?|pay rate|base pay|wage|hourly rate|earliest (?:available )?start|start date|availability|notice period|available to start|when can you start)/i,
      reason: "Compensation and availability answers require a current candidate decision."
    }),
    Object.freeze({
      pattern: /(?:resume|résumé|curriculum vitae|\bcv\b|cover ?letter|upload|attachment|document)/i,
      reason: "Documents and uploads are always manual."
    })
  ]);
  const BLOCKED_AUTOCOMPLETE_PATTERN = /(?:password|username|cc-|one-time-code|transaction-)/i;

  function compactText(value, maximumLength = 400) {
    return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximumLength);
  }

  function normalizeText(value) {
    return compactText(value, 1_000)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function compactIdentifier(value) {
    return normalizeText(value).replace(/\s+/g, "");
  }

  function phraseMatches(haystack, phrase) {
    const normalizedHaystack = ` ${normalizeText(haystack)} `;
    const normalizedPhrase = normalizeText(phrase);
    return normalizedPhrase.length > 0 && normalizedHaystack.includes(` ${normalizedPhrase} `);
  }

  function semanticText(metadata = {}) {
    return compactText([
      metadata.question,
      metadata.label,
      metadata.ariaLabel,
      metadata.describedBy,
      metadata.placeholder,
      metadata.name,
      metadata.id,
      metadata.autocomplete,
      metadata.automationId,
      metadata.role
    ].filter(Boolean).join(" "), 2_000);
  }

  function inferKind(metadata = {}) {
    const tagName = String(metadata.tagName || "").toLowerCase();
    const type = String(metadata.type || "").toLowerCase();
    const role = String(metadata.role || "").toLowerCase();

    if (tagName === "select" || role === "combobox" || role === "listbox") return "select";
    if (type === "radio" || role === "radio") return "radio";
    if (type === "checkbox" || role === "checkbox" || role === "switch") return "checkbox";
    if (tagName === "textarea" || SAFE_TEXT_INPUT_TYPES.has(type) || (tagName === "input" && !type)) return "text";
    return "unsupported";
  }

  function exactFieldText(metadata = {}) {
    return normalizeText(metadata.label || metadata.ariaLabel || metadata.question || "");
  }

  function aliasMatches(semantic, alias) {
    if (phraseMatches(semantic, alias)) return true;
    // Camel-cased input names such as `firstName` are a useful hint, but
    // generic short aliases (especially `name`) are too easy to over-match.
    const compactAlias = compactIdentifier(alias);
    return compactAlias.length >= 6 && compactIdentifier(semantic).includes(compactAlias);
  }

  function canonicalFieldKey(metadata = {}) {
    const autocomplete = normalizeText(metadata.autocomplete);
    const semantic = semanticText(metadata);
    const exact = exactFieldText(metadata);

    for (const [key, definition] of Object.entries(FIELD_DEFINITIONS)) {
      if (definition.autocomplete.some((value) => normalizeText(value) === autocomplete)) {
        return key;
      }
    }

    if (exact === "name") return "fullName";

    // Prefer the more specific public-profile URLs to the broad `website`
    // alias, and use phrase boundaries so `name` cannot match arbitrary text.
    for (const key of [
      "linkedin", "github", "firstName", "lastName", "preferredName",
      "fullName", "email", "phone", "addressLine1", "addressLine2",
      "postalCode", "country", "city", "state", "website", "school",
      "degree", "major", "graduation"
    ]) {
      const definition = FIELD_DEFINITIONS[key];
      if (definition.aliases.some((alias) => aliasMatches(semantic, alias))) {
        return key;
      }
    }

    return null;
  }

  function canonicalEligibilityKey(metadata = {}) {
    const semantic = semanticText(metadata);
    for (const [key, aliases] of Object.entries(ELIGIBILITY_DEFINITIONS)) {
      if (aliases.some((alias) => phraseMatches(semantic, alias) || compactIdentifier(semantic).includes(compactIdentifier(alias)))) {
        return key;
      }
    }
    return null;
  }

  function hardManualReason(metadataOrText) {
    const text = typeof metadataOrText === "string" ? metadataOrText : semanticText(metadataOrText);
    return HARD_MANUAL_RULES.find((rule) => rule.pattern.test(text))?.reason || null;
  }

  function isSensitive(metadataOrText) {
    // Retained as a semantic signal for callers. It includes privacy-sensitive
    // eligibility data, while `hardManualReason` determines whether a control
    // is permanently blocked from filling.
    const text = typeof metadataOrText === "string" ? metadataOrText : semanticText(metadataOrText);
    return Boolean(hardManualReason(text)) || Boolean(canonicalEligibilityKey({ question: text }));
  }

  function isBlockedAutocomplete(value) {
    return BLOCKED_AUTOCOMPLETE_PATTERN.test(String(value || ""));
  }

  function isRequiredMetadata(metadata = {}) {
    return metadata.required === true || String(metadata.ariaRequired || "").toLowerCase() === "true";
  }

  function classifyMetadata(metadata = {}) {
    const kind = inferKind(metadata);
    const type = String(metadata.type || "").toLowerCase();
    const canonicalKey = canonicalFieldKey(metadata);
    const eligibilityKey = canonicalEligibilityKey(metadata);
    const semanticBlock = hardManualReason(metadata);
    const blockedType = BLOCKED_INPUT_TYPES.has(type);
    const blockedAutocomplete = isBlockedAutocomplete(metadata.autocomplete);

    let reason = null;
    if (blockedAutocomplete) reason = "Credentials and payment controls are always manual.";
    else if (semanticBlock) reason = semanticBlock;
    else if (blockedType) reason = "unsupported control type";
    // A checkbox is a direct attestation or consent-style interaction on many
    // application forms. We intentionally have no checkbox allowlist: a
    // candidate must take that action themselves even when its label looks
    // routine or a local plan happens to carry a boolean.
    else if (kind === "checkbox") reason = "Checkbox controls require direct candidate action.";
    else if (kind === "unsupported") reason = "unsupported control";

    const category = reason
      ? "manual"
      : eligibilityKey
        ? "eligibility"
        : canonicalKey
          ? "profile"
          : "company-specific";

    return Object.freeze({
      kind,
      canonicalKey,
      eligibilityKey,
      category,
      sensitive: Boolean(semanticBlock || eligibilityKey),
      hardManual: reason !== null,
      safe: reason === null,
      reason,
      adapter: metadata.automationId ? "workday-like" : "generic"
    });
  }

  function questionFingerprint(value) {
    return normalizeText(value).slice(0, 300);
  }

  function normalizedIds(metadata = {}) {
    return [metadata.name, metadata.id, metadata.automationId]
      .map((value) => compactIdentifier(value))
      .filter(Boolean);
  }

  function validateRoutineValue(key, candidate) {
    if (typeof candidate !== "string") return null;
    const value = compactText(candidate, MAX_TEXT_LENGTH);
    if (!value) return null;

    if (key === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
    if (key === "phone") return /^[0-9+().\-\s]{7,40}$/.test(value) ? value : null;
    if (["website", "linkedin", "github"].includes(key)) {
      try {
        const url = new URL(value);
        return ["https:", "http:"].includes(url.protocol) ? url.href : null;
      } catch {
        return null;
      }
    }

    return value.length <= 160 ? value : null;
  }

  function validateApprovedValue(candidate) {
    if (typeof candidate === "boolean") return candidate;
    if (typeof candidate !== "string") return null;
    const value = compactText(candidate, MAX_TEXT_LENGTH);
    return value || null;
  }

  function normalizeApprovedQuestion(entry) {
    if (!entry || typeof entry !== "object" || entry.approved !== true) return null;
    const value = validateApprovedValue(entry.value);
    if (value === null) return null;

    const question = questionFingerprint(entry.question || entry.label || entry.questionFingerprint || "");
    const id = compactIdentifier(entry.id || entry.fieldId || entry.automationId || "");
    if (!question && !id) return null;

    return Object.freeze({ approved: true, question, id, value });
  }

  function normalizeVerifiedQuestion(entry) {
    if (!entry || typeof entry !== "object" || entry.verified !== true) return null;
    const category = normalizeText(entry.category);
    if (!["eligibility", "profile"].includes(category)) return null;

    // Eligibility is deliberately narrower than a generic approved response:
    // it represents a current yes/no fact, not a page-supplied string that
    // happens to resemble an available option.
    if (category === "eligibility" && typeof entry.value !== "boolean") return null;
    const value = validateApprovedValue(entry.value);
    if (value === null) return null;

    const question = questionFingerprint(entry.question || entry.label || entry.questionFingerprint || "");
    const id = compactIdentifier(entry.id || entry.fieldId || entry.automationId || "");
    if (!question && !id) return null;

    return Object.freeze({ verified: true, category, question, id, value });
  }

  function matchingVerifiedEntry(descriptor, verifiedQuestions, category) {
    const entries = Array.isArray(verifiedQuestions)
      ? verifiedQuestions.map(normalizeVerifiedQuestion).filter(Boolean)
      : [];
    if (!entries.length) return null;

    const question = questionFingerprint(descriptor.question || descriptor.label || "");
    const ids = new Set(normalizedIds(descriptor));
    const matches = entries.filter((entry) => {
      if (entry.category !== category) return false;
      // When a reviewed record carries both a stable ID and visible question,
      // both must still describe the control we just scanned. IDs can be
      // reused across tenants or changed labels; treating either matcher as
      // sufficient could move a verified answer to a different question.
      return (!entry.id || ids.has(entry.id)) && (!entry.question || entry.question === question);
    });
    if (!matches.length) return null;

    const uniqueValues = new Set(matches.map((entry) => JSON.stringify(entry.value)));
    return uniqueValues.size === 1 ? matches[0] : null;
  }

  function findVerifiedQuestion(descriptor, verifiedQuestions, category) {
    return matchingVerifiedEntry(descriptor, verifiedQuestions, category)?.value ?? null;
  }

  function findApprovedQuestion(descriptor, approvedQuestions) {
    const entries = Array.isArray(approvedQuestions)
      ? approvedQuestions.map(normalizeApprovedQuestion).filter(Boolean)
      : [];
    if (!entries.length) return null;

    const question = questionFingerprint(descriptor.question || descriptor.label || "");
    const ids = new Set(normalizedIds(descriptor));
    const matches = entries.filter((entry) => {
      // A company-specific answer is bound to every matcher the candidate
      // approved. An entry may intentionally use just an ID or just a
      // question, but when it supplies both, both must remain exact.
      return (!entry.id || ids.has(entry.id)) && (!entry.question || entry.question === question);
    });
    if (!matches.length) return null;

    // Conflicting local entries are not a license to guess. Require a single
    // effective value if multiple matchers happen to target the same control.
    const uniqueValues = new Set(matches.map((entry) => JSON.stringify(entry.value)));
    return uniqueValues.size === 1 ? matches[0].value : null;
  }

  function matchingOption(options, candidate) {
    if (!Array.isArray(options)) return null;
    if (typeof candidate === "boolean") return matchingBooleanOption(options, candidate);
    if (typeof candidate !== "string") return null;
    const desired = normalizeText(candidate);
    if (!desired) return null;

    const matches = options.filter((option) => {
      const value = normalizeText(option?.value);
      const label = normalizeText(option?.label);
      return value === desired || label === desired;
    });
    if (!matches.length) return null;

    const identities = new Set(matches.map((option) => `${String(option.value)}\u0000${String(option.label)}`));
    return identities.size === 1 ? matches[0] : null;
  }

  function matchingBooleanOption(options, candidate) {
    const accepted = candidate ? new Set(["yes", "true", "y"]) : new Set(["no", "false", "n"]);
    const matches = options.filter((option) => {
      const value = normalizeText(option?.value);
      const label = normalizeText(option?.label);
      return accepted.has(value) || accepted.has(label);
    });
    if (!matches.length) return null;
    const identities = new Set(matches.map((option) => `${String(option.value)}\u0000${String(option.label)}`));
    return identities.size === 1 ? matches[0] : null;
  }

  function booleanValue(candidate) {
    if (typeof candidate === "boolean") return candidate;
    if (typeof candidate !== "string") return null;
    const normalized = normalizeText(candidate);
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    return null;
  }

  globalThis.CareerOpsFormAdapter = Object.freeze({
    BLOCKED_INPUT_TYPES,
    ELIGIBILITY_DEFINITIONS,
    FIELD_DEFINITIONS,
    HARD_MANUAL_RULES,
    SAFE_TEXT_INPUT_TYPES,
    booleanValue,
    canonicalFieldKey,
    canonicalEligibilityKey,
    classifyMetadata,
    compactIdentifier,
    compactText,
    findApprovedQuestion,
    findVerifiedQuestion,
    hardManualReason,
    inferKind,
    isBlockedAutocomplete,
    isRequiredMetadata,
    isSensitive,
    matchingOption,
    matchingBooleanOption,
    normalizeApprovedQuestion,
    normalizeVerifiedQuestion,
    normalizeText,
    normalizedIds,
    questionFingerprint,
    semanticText,
    validateApprovedValue,
    validateRoutineValue
  });
})();

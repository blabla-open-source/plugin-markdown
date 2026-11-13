export function validateDerivativeProvider(provider, index, backgroundServiceIds, errors) {
  const prefix = `contributes.derivativeProviders[${index}]`;
  if (!isRecord(provider)) {
    errors.push(`${prefix} must be an object`);
    return;
  }

  for (const key of ["id", "serviceId"]) {
    if (typeof provider[key] !== "string" || provider[key] === "") {
      errors.push(`${prefix}.${key} must be a non-empty string`);
    }
  }

  if (
    nonEmptyString(provider.serviceId) &&
    !backgroundServiceIds.has(provider.serviceId.trim())
  ) {
    errors.push(`${prefix}.serviceId must reference a background service`);
  }

  if (!nonEmptyArray(provider.roles)) {
    errors.push(`${prefix}.roles must be a non-empty array`);
  } else {
    for (const role of provider.roles) {
      if (!(role === "preview" || role === "thumbnail")) {
        errors.push(`${prefix}.roles must contain only preview or thumbnail`);
      }
    }
  }

  if (provider.input !== "sourceText" && provider.input !== "bytes") {
    errors.push(`${prefix}.input must be "sourceText" or "bytes"`);
  }

  if (hasOwn(provider, "mimeTypes") && !Array.isArray(provider.mimeTypes)) {
    errors.push(`${prefix}.mimeTypes must be an array when present`);
  }

  if (hasOwn(provider, "extensions") && !Array.isArray(provider.extensions)) {
    errors.push(`${prefix}.extensions must be an array when present`);
  }

  if (typeof provider.outputMime !== "string" || provider.outputMime === "") {
    errors.push(`${prefix}.outputMime must be a non-empty string`);
  }

  if (
    hasOwn(provider, "timeoutMs") &&
    (!Number.isInteger(provider.timeoutMs) || provider.timeoutMs <= 0)
  ) {
    errors.push(`${prefix}.timeoutMs must be a positive integer when present`);
  }

  if (
    hasOwn(provider, "priority") &&
    (!Number.isInteger(provider.priority) || provider.priority < 0)
  ) {
    errors.push(`${prefix}.priority must be a non-negative integer when present`);
  }
}

export function validateBundleProviders(providers, backgroundServiceIds, errors) {
  if (!Array.isArray(providers)) {
    errors.push("contributes.bundleProviders must be an array");
    return;
  }
  const providerIds = new Set();
  for (const [index, provider] of providers.entries()) {
    validateBundleProvider(provider, index, backgroundServiceIds, providerIds, errors);
  }
}

function validateBundleProvider(
  provider,
  index,
  backgroundServiceIds,
  providerIds,
  errors,
) {
  const prefix = `contributes.bundleProviders[${index}]`;
  if (!isRecord(provider)) {
    errors.push(`${prefix} must be an object`);
    return;
  }
  for (const key of ["id", "serviceId"]) {
    if (!nonEmptyString(provider[key])) {
      errors.push(`${prefix}.${key} must be a non-empty string`);
    }
  }
  if (nonEmptyString(provider.id)) {
    const id = provider.id.trim();
    if (providerIds.has(id)) {
      errors.push(`${prefix}.id must be unique`);
    }
    providerIds.add(id);
  }
  if (
    nonEmptyString(provider.serviceId) &&
    !backgroundServiceIds.has(provider.serviceId.trim())
  ) {
    errors.push(`${prefix}.serviceId must reference a background service`);
  }
  if (
    !nonEmptyArray(provider.extensions) ||
    provider.extensions.length > 64 ||
    !provider.extensions.every(nonEmptyString)
  ) {
    errors.push(`${prefix}.extensions must contain 1 to 64 non-empty strings`);
  }
  // Core also checks this optional matcher, even though it is not a bundle schema property.
  if (
    hasOwn(provider, "mimeTypes") &&
    (!nonEmptyArray(provider.mimeTypes) ||
      !provider.mimeTypes.every((value) => typeof value === "string" && value !== ""))
  ) {
    errors.push(`${prefix}.mimeTypes must contain non-empty strings when present`);
  }
  if (hasOwn(provider, "priority") && !Number.isSafeInteger(provider.priority)) {
    errors.push(`${prefix}.priority must be a safe integer when present`);
  }
  if (
    hasOwn(provider, "timeoutMs") &&
    (!Number.isInteger(provider.timeoutMs) ||
      provider.timeoutMs <= 0 ||
      provider.timeoutMs > 60_000)
  ) {
    errors.push(`${prefix}.timeoutMs must be a positive integer up to 60000 when present`);
  }
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

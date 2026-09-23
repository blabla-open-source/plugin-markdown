const SUPPORTED_DROP_KINDS = [
  "file",
  "image",
  "model",
  "pdf",
  "presentation",
  "video",
];

export function validateDropProvider(
  provider,
  index,
  targets,
  providerIds,
  errors,
) {
  const prefix = `contributes.dropProviders[${index}]`;
  if (!isRecord(provider)) {
    errors.push(`${prefix} must be an object`);
    return;
  }

  for (const key of ["id", "title"]) {
    if (!nonEmptyString(provider[key])) {
      errors.push(`${prefix}.${key} must be a non-empty string`);
    }
  }

  const hasSurfaceTarget = nonEmptyString(provider.surfaceId);
  const hasWebAppTarget = nonEmptyString(provider.webAppId);
  if (hasSurfaceTarget === hasWebAppTarget) {
    errors.push(
      `${prefix} must declare exactly one of surfaceId or webAppId`,
    );
  }

  if (nonEmptyString(provider.id)) {
    const providerId = provider.id.trim();
    if (providerIds.has(providerId)) {
      errors.push(`${prefix}.id must be unique`);
    }
    providerIds.add(providerId);
  }

  validateTarget(provider, prefix, targets, errors);
  validateAccepts(provider.accepts, prefix, errors);
  validateDelivery(provider, prefix, errors);

  if (hasOwn(provider, "priority") && !Number.isInteger(provider.priority)) {
    errors.push(`${prefix}.priority must be an integer when present`);
  }
}

function validateTarget(provider, prefix, targets, errors) {
  if (
    nonEmptyString(provider.webAppId) &&
    !targets.webAppIds.has(provider.webAppId.trim())
  ) {
    errors.push(`${prefix}.webAppId must reference a web app`);
  }
  if (
    nonEmptyString(provider.surfaceId) &&
    !targets.surfaceIds.has(provider.surfaceId.trim())
  ) {
    errors.push(`${prefix}.surfaceId must reference a surface`);
  }
}

function validateAccepts(accepts, prefix, errors) {
  if (!isRecord(accepts)) {
    errors.push(`${prefix}.accepts must be an object`);
    return;
  }

  const { extensions, kinds, mimeTypes } = accepts;
  if (
    !(nonEmptyArray(kinds) ||
      nonEmptyArray(mimeTypes) ||
      nonEmptyArray(extensions))
  ) {
    errors.push(`${prefix}.accepts must declare kinds, mimeTypes, or extensions`);
  }
  if (
    hasOwn(accepts, "kinds") &&
    (!nonEmptyArray(kinds) ||
      kinds.length > SUPPORTED_DROP_KINDS.length ||
      !kinds.every((kind) => SUPPORTED_DROP_KINDS.includes(kind)))
  ) {
    errors.push(`${prefix}.accepts.kinds is invalid`);
  }
  for (const key of ["mimeTypes", "extensions"]) {
    if (
      hasOwn(accepts, key) &&
      !boundedNonEmptyStringArray(accepts[key], 64)
    ) {
      errors.push(`${prefix}.accepts.${key} must contain non-empty strings`);
    }
  }
}

function validateDelivery(provider, prefix, errors) {
  if (!isRecord(provider.payload)) {
    errors.push(`${prefix}.payload must be an object`);
  }
  if (!isRecord(provider.delivery)) {
    errors.push(`${prefix}.delivery must be an object`);
  }
  if (!(isRecord(provider.payload) && isRecord(provider.delivery))) {
    return;
  }

  const payloadKind = provider.payload.kind;
  const deliveryKind = provider.delivery.kind;
  const validPair =
    (payloadKind === "plain-text" && deliveryKind === "clipboard-paste") ||
    (payloadKind === "page-images" && deliveryKind === "browser-file-drop");
  if (!validPair) {
    errors.push(`${prefix} has incompatible payload and delivery`);
  }

  if (payloadKind === "page-images") {
    const unsupportedPayloadKeys = Object.keys(provider.payload).filter(
      (key) => key !== "kind",
    );
    if (unsupportedPayloadKeys.length > 0) {
      errors.push(
        `${prefix}.payload page-images output is host-owned; remove ${unsupportedPayloadKeys.join(", ")}`,
      );
    }
  }

  if (
    deliveryKind === "clipboard-paste" &&
    hasOwn(provider.delivery, "placement")
  ) {
    validateClipboardPlacement(provider.delivery.placement, prefix, errors);
  }
}

function validateClipboardPlacement(placement, prefix, errors) {
  if (
    !isRecord(placement) ||
    placement.kind !== "text-tool" ||
    !nonEmptyString(placement.activationKey) ||
    placement.activationKey.trim().length !== 1 ||
    !Number.isInteger(placement.initialWidthPx) ||
    placement.initialWidthPx < 80 ||
    placement.initialWidthPx > 2048
  ) {
    errors.push(`${prefix}.delivery.placement is invalid`);
  }
}

function boundedNonEmptyStringArray(value, maxLength) {
  return (
    nonEmptyArray(value) &&
    value.length <= maxLength &&
    value.every(nonEmptyString)
  );
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

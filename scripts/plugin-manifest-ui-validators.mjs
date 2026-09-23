const MAX_NEW_TOOLBAR_TOOLTIP_LENGTH = 120;

export function validateSurface(surface, index, errors) {
  const prefix = `contributes.surfaces[${index}]`;
  if (!isRecord(surface)) {
    errors.push(`${prefix} must be an object`);
    return;
  }

  for (const key of ["id", "runtime", "url"]) {
    if (typeof surface[key] !== "string" || surface[key] === "") {
      errors.push(`${prefix}.${key} must be a non-empty string`);
    }
  }

  const hasStartCommand = nonEmptyArray(surface.startCommand);
  const hasStaticRoot =
    typeof surface.staticRoot === "string" && surface.staticRoot !== "";
  if (hasStartCommand === hasStaticRoot) {
    errors.push(
      `${prefix} must declare exactly one of startCommand or staticRoot`,
    );
  }
  if (
    hasOwn(surface, "readyPattern") &&
    (typeof surface.readyPattern !== "string" || surface.readyPattern === "")
  ) {
    errors.push(`${prefix}.readyPattern must be a non-empty string when present`);
  }
  if (hasStaticRoot && !surface.url.includes("{port}")) {
    errors.push(`${prefix}.url must include {port} for staticRoot surfaces`);
  }
  if (hasStaticRoot && !surface.staticRoot.startsWith("./")) {
    errors.push(`${prefix}.staticRoot must start with ./`);
  }
  validateHostUi(surface.hostUi, `${prefix}.hostUi`, errors);
}

export function validateHostUi(hostUi, prefix, errors) {
  if (hostUi === undefined) {
    return;
  }
  if (!isRecord(hostUi)) {
    errors.push(`${prefix} must be an object when present`);
    return;
  }
  if (!hasOwn(hostUi, "newToolbar")) {
    return;
  }
  if (!isRecord(hostUi.newToolbar)) {
    errors.push(`${prefix}.newToolbar must be an object when present`);
    return;
  }

  const tooltip = hostUi.newToolbar.tooltip;
  if (
    !nonEmptyString(tooltip) ||
    tooltip.trim().length > MAX_NEW_TOOLBAR_TOOLTIP_LENGTH
  ) {
    errors.push(
      `${prefix}.newToolbar.tooltip must be a non-empty string of at most ${MAX_NEW_TOOLBAR_TOOLTIP_LENGTH} characters`,
    );
  }
}

export function validatePluginInterface(pluginInterface, errors) {
  if (!isRecord(pluginInterface)) {
    errors.push("interface must be an object");
    return;
  }
  for (const key of ["displayName", "shortDescription", "developerName"]) {
    if (!nonEmptyString(pluginInterface[key])) {
      errors.push(`interface.${key} must be a non-empty string`);
    }
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

export function validatePluginPermissions(permissions, errors) {
  if (!isRecord(permissions)) {
    errors.push("permissions must be an object");
  } else if (
    hasOwn(permissions, "capture") &&
    (!Array.isArray(permissions.capture) ||
      permissions.capture.length !== 1 ||
      permissions.capture[0] !== "import")
  ) {
    errors.push("permissions.capture must contain only import");
  }

  if (
    isRecord(permissions) &&
    hasOwn(permissions, "navigation") &&
    (!Array.isArray(permissions.navigation) ||
      !permissions.navigation.every((capability) => capability === "open"))
  ) {
    errors.push("permissions.navigation must contain only open");
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

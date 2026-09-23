import path from "node:path";

const STABLE_SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function validatePluginVersionsFile(manifestPath, manifest, readFile) {
  const versionsPath = path.posix.join(
    path.posix.dirname(manifestPath),
    "versions.json",
  );
  try {
    return validatePluginVersionContract({
      manifest,
      versions: JSON.parse(readFile(versionsPath)),
    });
  } catch (error) {
    return [
      `versions.json must exist and contain valid JSON: ${errorMessage(error)}`,
      ...validatePluginManifestVersionFields(manifest),
    ];
  }
}

export function validatePluginVersionContract({ manifest, versions }) {
  const errors = validatePluginManifestVersionFields(manifest);
  if (!isRecord(versions) || Object.keys(versions).length === 0) {
    errors.push("versions.json must be a non-empty JSON object");
    return errors;
  }

  for (const [version, release] of Object.entries(versions)) {
    validateRelease(version, release, errors);
  }
  const latestVersion = Object.keys(versions)
    .filter(isStableSemanticVersion)
    .sort(compareStableSemanticVersions)
    .at(-1);
  if (latestVersion && latestVersion !== manifest.version) {
    errors.push(
      `manifest version ${manifest.version} must be the latest versions.json entry`,
    );
  }
  const current = versions[manifest.version];
  if (!isRecord(current)) {
    errors.push(`versions.json must declare current version ${manifest.version}`);
  } else if (
    current.apiVersion !== manifest.apiVersion ||
    current.minAppVersion !== manifest.minAppVersion
  ) {
    errors.push(
      "versions.json current entry must match apiVersion and minAppVersion",
    );
  }
  return errors;
}

function validatePluginManifestVersionFields(manifest) {
  const errors = [];
  if (manifest.apiVersion !== 1) {
    errors.push("apiVersion must be 1");
  }
  if (!isStableSemanticVersion(manifest.version)) {
    errors.push("version must be a stable semantic version");
  }
  if (!isStableSemanticVersion(manifest.minAppVersion)) {
    errors.push("minAppVersion must be a stable semantic version");
  }
  return errors;
}

function validateRelease(version, release, errors) {
  if (!isStableSemanticVersion(version)) {
    errors.push(
      `versions.json key ${version} must be a stable semantic version`,
    );
    return;
  }
  if (!isRecord(release)) {
    errors.push(`versions.json entry ${version} must be an object`);
    return;
  }
  const extraKeys = Object.keys(release).filter(
    (key) => key !== "apiVersion" && key !== "minAppVersion",
  );
  if (extraKeys.length > 0) {
    errors.push(
      `versions.json entry ${version} has unsupported fields: ${extraKeys.join(", ")}`,
    );
  }
  if (release.apiVersion !== 1) {
    errors.push(`versions.json entry ${version}.apiVersion must be 1`);
  }
  if (!isStableSemanticVersion(release.minAppVersion)) {
    errors.push(
      `versions.json entry ${version}.minAppVersion must be a stable semantic version`,
    );
  }
}

function isStableSemanticVersion(value) {
  return typeof value === "string" && STABLE_SEMVER_PATTERN.test(value);
}

function compareStableSemanticVersions(left, right) {
  const leftParts = left.split(".").map(BigInt);
  const rightParts = right.split(".").map(BigInt);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] < rightParts[index]) {
      return -1;
    }
    if (leftParts[index] > rightParts[index]) {
      return 1;
    }
  }
  return 0;
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

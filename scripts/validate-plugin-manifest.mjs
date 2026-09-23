#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  validateHostUi,
  validatePluginInterface,
  validateSurface,
} from "./plugin-manifest-ui-validators.mjs";
import { validateDropProvider } from "./plugin-manifest-drop-provider-validator.mjs";
import { validatePluginVersionsFile } from "./plugin-version-contract.mjs";

import { validatePluginPermissions } from "./plugin-manifest-permission-validator.mjs";

const STAGED = takeFlag("--staged");
const repoRoot = gitRoot(process.cwd());
const manifestPaths = positionalArgs();
const MAX_BACKGROUND_IDLE_TTL_MS = 3_600_000;

if (manifestPaths.length === 0) {
  manifestPaths.push(...discoverPluginManifests());
}

const failures = manifestPaths.flatMap(validateManifestPath);

if (failures.length > 0) {
  console.error("Plugin manifest validation failed.\n");
  for (const failure of failures) {
    console.error(`${failure.path}\n  ${failure.reason}\n`);
  }
  process.exit(1);
}

console.log(`Validated ${manifestPaths.length} plugin manifest(s).`);

function validateManifestPath(inputPath) {
  const manifestPath = normalizePath(path.relative(repoRoot, path.resolve(inputPath)));
  const source = readProjectFile(manifestPath);
  const errors = [];
  let manifest;

  try {
    manifest = JSON.parse(source);
  } catch (error) {
    return [
      {
        path: manifestPath,
        reason: `invalid JSON: ${errorMessage(error)}`,
      },
    ];
  }

  if (!isRecord(manifest)) {
    return [{ path: manifestPath, reason: "manifest must be a JSON object" }];
  }

  for (const key of [
    "id",
    "name",
    "version",
    "minAppVersion",
    "apiVersion",
    "runtime",
    "activation",
    "permissions",
    "contributes",
    "interface",
  ]) {
    if (!hasOwn(manifest, key)) {
      errors.push(`missing required key: ${key}`);
    }
  }

  for (const forbiddenKey of ["api", "skills", "mcpServers"]) {
    if (hasOwn(manifest, forbiddenKey)) {
      errors.push(`forbidden Codex or legacy key: ${forbiddenKey}`);
    }
  }

  if (typeof manifest.id !== "string" || manifest.id.trim() === "") {
    errors.push("id must be a non-empty string");
  }
  errors.push(...validatePluginVersionsFile(manifestPath, manifest, readProjectFile));

  if (!isRecord(manifest.activation) || !nonEmptyArray(manifest.activation.events)) {
    errors.push("activation.events must be a non-empty array");
  }

  validatePluginPermissions(manifest.permissions, errors);

  const contributes = manifest.contributes;
  if (!isRecord(contributes)) {
    errors.push("contributes must be an object");
  } else {
    const hasSurfaces = nonEmptyArray(contributes.surfaces);
    const hasBackgroundServices = nonEmptyArray(contributes.backgroundServices);
    const hasWebApps = nonEmptyArray(contributes.webApps);
    const backgroundServiceIds = new Set(
      Array.isArray(contributes.backgroundServices)
        ? contributes.backgroundServices
            .filter(isRecord)
            .map((service) => service.id)
            .filter(nonEmptyString)
            .map((id) => id.trim())
        : [],
    );
    const accountIds = new Set(
      Array.isArray(contributes.accounts)
        ? contributes.accounts
            .filter(isRecord)
            .map((account) => account.id)
            .filter((id) => typeof id === "string" && id !== "")
        : [],
    );
    const webAppIds = new Set(
      Array.isArray(contributes.webApps)
        ? contributes.webApps
            .filter(isRecord)
            .map((webApp) => webApp.id)
            .filter(nonEmptyString)
            .map((id) => id.trim())
        : [],
    );
    const surfaceIds = new Set(
      Array.isArray(contributes.surfaces)
        ? contributes.surfaces
            .filter(isRecord)
            .map((surface) => surface.id)
            .filter(nonEmptyString)
            .map((id) => id.trim())
        : [],
    );

    if (!(hasSurfaces || hasBackgroundServices || hasWebApps)) {
      errors.push(
        "contributes must include surfaces, backgroundServices, or webApps",
      );
    }

    if (hasOwn(contributes, "surfaces")) {
      if (!Array.isArray(contributes.surfaces)) {
        errors.push("contributes.surfaces must be an array");
      } else {
        for (const [index, surface] of contributes.surfaces.entries()) {
          validateSurface(surface, index, errors);
        }
      }
    }

    if (hasOwn(contributes, "backgroundServices")) {
      if (!Array.isArray(contributes.backgroundServices)) {
        errors.push("contributes.backgroundServices must be an array");
      } else {
        for (const [index, service] of contributes.backgroundServices.entries()) {
          validateBackgroundService(service, index, errors);
        }
      }
    }

    if (hasOwn(contributes, "derivativeProviders")) {
      if (!Array.isArray(contributes.derivativeProviders)) {
        errors.push("contributes.derivativeProviders must be an array");
      } else {
        for (const [index, provider] of contributes.derivativeProviders.entries()) {
          validateDerivativeProvider(provider, index, backgroundServiceIds, errors);
        }
      }
    }

    if (hasOwn(contributes, "dropProviders")) {
      if (!Array.isArray(contributes.dropProviders)) {
        errors.push("contributes.dropProviders must be an array");
      } else {
        const providerIds = new Set();
        for (const [index, provider] of contributes.dropProviders.entries()) {
          validateDropProvider(
            provider,
            index,
            { surfaceIds, webAppIds },
            providerIds,
            errors,
          );
        }
      }
    }

    if (hasOwn(contributes, "accounts")) {
      if (!Array.isArray(contributes.accounts)) {
        errors.push("contributes.accounts must be an array");
      } else {
        for (const [index, account] of contributes.accounts.entries()) {
          validateAccount(account, index, errors);
        }
      }
    }

    if (hasOwn(contributes, "resourceProviders")) {
      if (!Array.isArray(contributes.resourceProviders)) {
        errors.push("contributes.resourceProviders must be an array");
      } else {
        for (const [index, provider] of contributes.resourceProviders.entries()) {
          validateResourceProvider(provider, index, backgroundServiceIds, accountIds, errors);
        }
      }
    }

    if (hasOwn(contributes, "webApps")) {
      if (!Array.isArray(contributes.webApps)) {
        errors.push("contributes.webApps must be an array");
      } else {
        for (const [index, webApp] of contributes.webApps.entries()) {
          validateWebApp(webApp, index, accountIds, errors);
        }
      }
    }
  }

  validatePluginInterface(manifest.interface, errors);

  return errors.map((reason) => ({ path: manifestPath, reason }));
}

function validateBackgroundService(service, index, errors) {
  const prefix = `contributes.backgroundServices[${index}]`;
  if (!isRecord(service)) {
    errors.push(`${prefix} must be an object`);
    return;
  }

  if (!nonEmptyString(service.id)) {
    errors.push(`${prefix}.id must be a non-empty string`);
  }

  if (!nonEmptyString(service.entry)) {
    errors.push(`${prefix}.entry must be a non-empty string`);
  } else if (!isManifestRelativePath(service.entry.trim())) {
    errors.push(`${prefix}.entry must be a relative path inside the plugin root`);
  }
  for (const removedKey of ["runtime", "script", "startCommand"]) {
    if (hasOwn(service, removedKey)) {
      errors.push(`${prefix}.${removedKey} was removed; declare entry only`);
    }
  }

  if (hasOwn(service, "readyPattern")) {
    errors.push(`${prefix}.readyPattern was removed; readiness is host-owned`);
  }

  if (
    hasOwn(service, "idleTtlMs") &&
    (!Number.isInteger(service.idleTtlMs) ||
      service.idleTtlMs < 0 ||
      service.idleTtlMs > MAX_BACKGROUND_IDLE_TTL_MS)
  ) {
    errors.push(
      `${prefix}.idleTtlMs must be an integer between 0 and ${MAX_BACKGROUND_IDLE_TTL_MS}`,
    );
  }
}

function validateDerivativeProvider(provider, index, backgroundServiceIds, errors) {
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

  if (provider.input !== "sourceText") {
    errors.push(`${prefix}.input must be "sourceText"`);
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

function validateAccount(account, index, errors) {
  const prefix = `contributes.accounts[${index}]`;
  if (!isRecord(account)) {
    errors.push(`${prefix} must be an object`);
    return;
  }

  for (const key of ["id", "homeUrl", "loginUrl", "type"]) {
    if (typeof account[key] !== "string" || account[key] === "") {
      errors.push(`${prefix}.${key} must be a non-empty string`);
    }
  }

  if (account.type !== "web-session-cookie") {
    errors.push(`${prefix}.type must be "web-session-cookie"`);
  }

  for (const key of ["hosts", "cookieDomains", "sessionCookieNames"]) {
    if (!nonEmptyArray(account[key])) {
      errors.push(`${prefix}.${key} must be a non-empty array`);
    } else if (!account[key].every((value) => typeof value === "string" && value !== "")) {
      errors.push(`${prefix}.${key} must contain only non-empty strings`);
    }
  }

  for (const key of ["loginHosts", "loginPaths"]) {
    if (hasOwn(account, key) && !stringArray(account[key])) {
      errors.push(`${prefix}.${key} must contain only strings when present`);
    }
  }

  if (
    hasOwn(account, "sessionCookieRejectedValues") &&
    (!nonEmptyArray(account.sessionCookieRejectedValues) ||
      !account.sessionCookieRejectedValues.every(
        (value) => typeof value === "string" && value !== ""
      ))
  ) {
    errors.push(
      `${prefix}.sessionCookieRejectedValues must contain non-empty strings when present`
    );
  }

  if (
    hasOwn(account, "loginElementSelector") &&
    (typeof account.loginElementSelector !== "string" ||
      account.loginElementSelector === "")
  ) {
    errors.push(
      `${prefix}.loginElementSelector must be a non-empty string when present`
    );
  }
}

function validateWebApp(webApp, index, accountIds, errors) {
  const prefix = `contributes.webApps[${index}]`;
  if (!isRecord(webApp)) {
    errors.push(`${prefix} must be an object`);
    return;
  }

  for (const key of ["id", "url"]) {
    if (typeof webApp[key] !== "string" || webApp[key] === "") {
      errors.push(`${prefix}.${key} must be a non-empty string`);
    }
  }

  if (typeof webApp.url === "string" && !isHttpUrl(webApp.url)) {
    errors.push(`${prefix}.url must be an http or https URL`);
  }

  if (
    hasOwn(webApp, "displayName") &&
    (typeof webApp.displayName !== "string" || webApp.displayName === "")
  ) {
    errors.push(`${prefix}.displayName must be a non-empty string when present`);
  }

  if (hasOwn(webApp, "capture")) {
    if (!isRecord(webApp.capture)) {
      errors.push(`${prefix}.capture must be an object when present`);
    } else if (
      typeof webApp.capture.script !== "string" ||
      !webApp.capture.script.startsWith("./")
    ) {
      errors.push(`${prefix}.capture.script must start with ./`);
    }
  }

  if (hasOwn(webApp, "drop")) {
    errors.push(
      `${prefix}.drop was removed; use contributes.dropProviders`,
    );
  }

  if (hasOwn(webApp, "accountId")) {
    if (typeof webApp.accountId !== "string" || webApp.accountId === "") {
      errors.push(`${prefix}.accountId must be a non-empty string when present`);
    } else if (!accountIds.has(webApp.accountId)) {
      errors.push(`${prefix}.accountId must reference an account`);
    }
  }

  if (hasOwn(webApp, "accountRequiredFor")) {
    if (
      !Array.isArray(webApp.accountRequiredFor) ||
      webApp.accountRequiredFor.length !== 1 ||
      webApp.accountRequiredFor[0] !== "open"
    ) {
      errors.push(`${prefix}.accountRequiredFor must contain only open`);
    }
    if (!(typeof webApp.accountId === "string" && webApp.accountId !== "")) {
      errors.push(`${prefix}.accountRequiredFor requires accountId`);
    }
  }
  validateHostUi(webApp.hostUi, `${prefix}.hostUi`, errors);
}

function validateResourceProvider(provider, index, backgroundServiceIds, accountIds, errors) {
  const prefix = `contributes.resourceProviders[${index}]`;
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

  if (
    hasOwn(provider, "accountId") &&
    (typeof provider.accountId !== "string" ||
      provider.accountId === "" ||
      !accountIds.has(provider.accountId))
  ) {
    errors.push(`${prefix}.accountId must reference an account`);
  }

  if (
    !(
      Array.isArray(provider.kinds) &&
      provider.kinds.length === 1 &&
      provider.kinds[0] === "video"
    )
  ) {
    errors.push(`${prefix}.kinds must be exactly ["video"]`);
  }

  if (!nonEmptyArray(provider.matches) || provider.matches.length > 64) {
    errors.push(`${prefix}.matches must contain 1 to 64 patterns`);
  } else {
    for (const pattern of provider.matches) {
      if (!isUrlMatchPattern(pattern)) {
        errors.push(`${prefix}.matches contains an invalid URL match pattern`);
      }
    }
  }

  if (hasOwn(provider, "excludeMatches")) {
    if (!Array.isArray(provider.excludeMatches) || provider.excludeMatches.length > 64) {
      errors.push(`${prefix}.excludeMatches must contain at most 64 patterns`);
    } else {
      for (const pattern of provider.excludeMatches) {
        if (!isUrlMatchPattern(pattern)) {
          errors.push(
            `${prefix}.excludeMatches contains an invalid URL match pattern`,
          );
        }
      }
    }
  }

  if (hasOwn(provider, "accountRequiredFor")) {
    if (!Array.isArray(provider.accountRequiredFor)) {
      errors.push(`${prefix}.accountRequiredFor must be an array when present`);
    } else {
      for (const intent of provider.accountRequiredFor) {
        if (intent !== "playback") {
          errors.push(`${prefix}.accountRequiredFor must contain only playback`);
        }
      }
    }
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

function readProjectFile(projectPath) {
  if (STAGED) {
    return git(["show", `:${projectPath}`], repoRoot);
  }

  const absolutePath = path.join(repoRoot, projectPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`missing file: ${projectPath}`);
  }
  return readFileSync(absolutePath, "utf8");
}

function discoverPluginManifests() {
  const output = git(["ls-files", "-z", "plugins/*/blabla-plugin.json"], repoRoot);
  return output.split("\0").filter(Boolean);
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function stringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function boundedNonEmptyStringArray(value, maxLength) {
  return (
    nonEmptyArray(value) &&
    value.length <= maxLength &&
    value.every(nonEmptyString)
  );
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isManifestRelativePath(value) {
  if (!value.startsWith("./")) {
    return false;
  }
  const relativePath = value.slice(2);
  const normalizedRelative = path.normalize(relativePath);
  const segments = normalizedRelative
    .split(/[\\/]+/u)
    .filter(Boolean);
  return (
    !path.isAbsolute(relativePath) &&
    normalizedRelative !== "." &&
    !segments.includes("..")
  );
}

function isUrlMatchPattern(value) {
  if (typeof value !== "string") {
    return false;
  }
  const match = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(value);
  if (!match) {
    return false;
  }
  const rawHost = match[2];
  if (rawHost === "*") {
    return true;
  }
  const wildcard = rawHost.startsWith("*.");
  const host = wildcard ? rawHost.slice(2) : rawHost;
  if (!host || host.includes("*") || rawHost.includes(":")) {
    return false;
  }
  try {
    const parsed = new URL(`https://${host}/`);
    return (
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      !parsed.search &&
      !parsed.hash &&
      parsed.pathname === "/" &&
      Boolean(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function positionalArgs() {
  return process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
}

function takeFlag(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return false;
  }
  process.argv.splice(index, 1);
  return true;
}

function normalizePath(filePath) {
  return filePath.split(path.sep).join(path.posix.sep);
}

function gitRoot(cwd) {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluatePnpmAuditFindings,
  isAllowedExceptionSeverity,
  validatePnpmAuditDocument,
} from "./lib/pnpm-audit-policy.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exceptionDocument = JSON.parse(
  await readFile(
    resolve(repositoryRoot, "security/audit-exceptions.json"),
    "utf8",
  ),
);
const auditResult = spawnSync(
  "pnpm",
  ["audit", "--prod", "--json", "--registry=https://registry.npmjs.org"],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: process.env,
  },
);

if (auditResult.error) {
  throw auditResult.error;
}
if (auditResult.status !== 0 && auditResult.status !== 1) {
  throw new Error(
    `pnpm audit failed before producing findings (exit ${auditResult.status}).`,
  );
}

let auditDocument;
try {
  auditDocument = JSON.parse(auditResult.stdout);
} catch {
  throw new Error(
    "pnpm audit did not return valid JSON from the official registry.",
  );
}
validatePnpmAuditDocument(auditDocument);

const exceptions = validateExceptionDocument(exceptionDocument);
await validateAuditExceptionInvariants(exceptions);
const { activeExceptionIds, blockingFindings, staleExceptionIds } =
  evaluatePnpmAuditFindings(auditDocument, exceptions);
if (blockingFindings.length || staleExceptionIds.length) {
  const details = [
    blockingFindings.length
      ? `unapproved findings: ${blockingFindings.join(", ")}`
      : null,
    staleExceptionIds.length
      ? `stale exceptions: ${staleExceptionIds.join(", ")}`
      : null,
  ].filter(Boolean);
  throw new Error(
    `Production dependency audit failed (${details.join("; ")}).`,
  );
}

const vulnerabilityCounts = auditDocument.metadata?.vulnerabilities ?? {};
console.log(
  `Production audit passed: ${vulnerabilityCounts.high ?? 0} high, ${vulnerabilityCounts.critical ?? 0} critical, ${activeExceptionIds.size} active moderate exception.`,
);

function validateExceptionDocument(document) {
  if (document.schemaVersion !== 1 || !Array.isArray(document.exceptions)) {
    throw new Error(
      "security/audit-exceptions.json has an unsupported schema.",
    );
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return document.exceptions.map((exception) => {
    const requiredFields = [
      "scanner",
      "advisoryId",
      "package",
      "dependencyPath",
      "dependencyVersion",
      "severity",
      "owner",
      "reason",
      "usageInvariant",
      "expiresOn",
      "upstreamUrl",
    ];
    for (const fieldName of requiredFields) {
      if (
        typeof exception[fieldName] !== "string" ||
        !exception[fieldName].trim()
      ) {
        throw new Error(`Audit exception is missing ${fieldName}.`);
      }
    }
    if (exception.scanner !== "pnpm-audit") {
      throw new Error(
        `Unsupported audit exception scanner: ${exception.scanner}.`,
      );
    }
    if (!isAllowedExceptionSeverity(exception.severity)) {
      throw new Error(
        `Audit exception ${exception.advisoryId} has an unsupported severity.`,
      );
    }
    const expirationDate = new Date(`${exception.expiresOn}T00:00:00Z`);
    if (!Number.isFinite(expirationDate.getTime()) || expirationDate < today) {
      throw new Error(
        `Audit exception ${exception.advisoryId} expired on ${exception.expiresOn}.`,
      );
    }
    return exception;
  });
}

async function validateAuditExceptionInvariants(exceptions) {
  for (const exception of exceptions) {
    if (
      exception.advisoryId !== "GHSA-w5hq-g745-h8pq" ||
      exception.package !== "uuid"
    ) {
      throw new Error(
        `Audit exception ${exception.advisoryId} has no executable usage invariant.`,
      );
    }
    if (
      exception.dependencyVersion !==
      "microsoft-cognitiveservices-speech-sdk@1.50.0"
    ) {
      throw new Error(
        `Audit exception ${exception.advisoryId} targets an unreviewed SDK version.`,
      );
    }

    const speechSdkRoot = resolve(
      repositoryRoot,
      "node_modules/microsoft-cognitiveservices-speech-sdk",
    );
    const speechSdkManifest = JSON.parse(
      await readFile(resolve(speechSdkRoot, "package.json"), "utf8"),
    );
    if (speechSdkManifest.version !== "1.50.0") {
      throw new Error(
        `Audit exception ${exception.advisoryId} no longer matches the installed SDK.`,
      );
    }
    const guidHelperSource = await readFile(
      resolve(speechSdkRoot, "distrib/lib/src/common/Guid.js"),
      "utf8",
    );
    if (
      !/const createGuid = \(\) => \(0, uuid_1\.v4\)\(\);/.test(
        guidHelperSource,
      )
    ) {
      throw new Error(
        `Audit exception ${exception.advisoryId} usage invariant no longer holds.`,
      );
    }
  }
}

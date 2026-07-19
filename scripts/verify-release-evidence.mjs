import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidencePath = resolve(
  repositoryRoot,
  "docs/release/evidence/0.1.0-rc.1.json",
);
const evidenceDocument = JSON.parse(await readFile(evidencePath, "utf8"));
const prohibitedKeyPattern =
  /(authorization|body|key|path|prompt|response|secret|text|token|transcript|vector)/i;
const prohibitedValuePatterns = [
  /\/Users\//,
  /\/home\//,
  /[A-Za-z]:\\Users\\/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
  /\b(?:sk|api)[-_][A-Za-z0-9]{16,}\b/i,
];

if (
  evidenceDocument.schemaVersion !== 1 ||
  evidenceDocument.releaseVersion !== "0.1.0-rc.1"
) {
  throw new Error(
    "Release evidence has an unsupported schema or release version.",
  );
}
inspectEvidenceValue(evidenceDocument, "evidence");
const incompleteReleaseGates = validateReleaseGateState(evidenceDocument);
console.log(
  incompleteReleaseGates.length
    ? `Verified sanitized No-Go evidence; ${incompleteReleaseGates.length} release gates remain incomplete.`
    : `Verified sanitized release evidence for ${evidenceDocument.releaseVersion}.`,
);

function inspectEvidenceValue(value, location) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      inspectEvidenceValue(entry, `${location}[${index}]`),
    );
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, childValue] of Object.entries(value)) {
      if (prohibitedKeyPattern.test(key)) {
        throw new Error(`Evidence key ${location}.${key} is not allowed.`);
      }
      inspectEvidenceValue(childValue, `${location}.${key}`);
    }
    return;
  }
  if (
    typeof value === "string" &&
    prohibitedValuePatterns.some((pattern) => pattern.test(value))
  ) {
    throw new Error(
      `Evidence value at ${location} may contain a credential or local path.`,
    );
  }
}

function validateReleaseGateState(document) {
  if (document.environment?.architecture !== "arm64") {
    throw new Error("Release evidence must target arm64.");
  }
  if (document.decision !== "Go" && document.decision !== "No-Go") {
    throw new Error("Release decision must be Go or No-Go.");
  }

  const gateStatuses = [
    [
      "repositoryGates.freshCloneVerify",
      document.repositoryGates?.freshCloneVerify,
    ],
    [
      "repositoryGates.dependencyAudit",
      document.repositoryGates?.dependencyAudit,
    ],
    [
      "repositoryGates.fullHistoryScan",
      document.repositoryGates?.fullHistoryScan,
    ],
    [
      "repositoryGates.branchProtection",
      document.repositoryGates?.branchProtection,
    ],
    ["bundle.build", document.bundle?.build],
    ["bundle.architecture", document.bundle?.architecture],
    ["bundle.signature", document.bundle?.signature],
    ["bundle.resources", document.bundle?.resources],
    ["services.deepseek", document.services?.deepseek?.status],
    ["services.azure", document.services?.azure?.status],
    ["services.zhipu", document.services?.zhipu?.status],
    ["appSmoke.cleanAccount", document.appSmoke?.cleanAccount],
    ["appSmoke.upgradeAccount", document.appSmoke?.upgradeAccount],
    ["appSmoke.width960", document.appSmoke?.width960],
    ["appSmoke.width1200", document.appSmoke?.width1200],
    ["rollback.status", document.rollback?.status],
    ["rhTasks.status", document.rhTasks?.status],
    ["decisionReview.status", document.decisionReview?.status],
  ];
  const allowedStatuses = new Set(["pending", "passed", "failed", "blocked"]);
  for (const [gateName, gateStatus] of gateStatuses) {
    if (!allowedStatuses.has(gateStatus)) {
      throw new Error(`Release gate ${gateName} has an unsupported status.`);
    }
  }

  const incompleteReleaseGates = gateStatuses
    .filter(([, gateStatus]) => gateStatus !== "passed")
    .map(([gateName]) => gateName);
  if (document.commit === "pending") {
    incompleteReleaseGates.push("commit");
  } else if (
    typeof document.commit !== "string" ||
    !/^[0-9a-f]{40}$/.test(document.commit)
  ) {
    throw new Error(
      "Release evidence commit must be pending or a full lowercase Git SHA.",
    );
  }
  if (document.environment?.osVersion === "pending") {
    incompleteReleaseGates.push("environment.osVersion");
  } else if (typeof document.environment?.osVersion !== "string") {
    throw new Error("Release evidence OS version is missing.");
  }
  if (document.rhTasks?.completed !== 21 || document.rhTasks?.total !== 21) {
    incompleteReleaseGates.push("rhTasks.count");
  }

  if (incompleteReleaseGates.length && document.decision !== "No-Go") {
    throw new Error("Incomplete release gates require a No-Go decision.");
  }
  return incompleteReleaseGates;
}

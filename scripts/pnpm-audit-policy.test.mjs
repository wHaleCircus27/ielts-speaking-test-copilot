import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluatePnpmAuditFindings,
  validatePnpmAuditDocument,
} from "./lib/pnpm-audit-policy.mjs";

const approvedException = {
  advisoryId: "GHSA-approved",
  package: "example-package",
  dependencyPath: ".>sdk>example-package",
  severity: "moderate",
};

test("rejects an audit response that reports a registry error", () => {
  assert.throws(
    () =>
      validatePnpmAuditDocument({
        error: { summary: "registry unavailable" },
        advisories: {},
        metadata: { vulnerabilities: emptyVulnerabilityCounts() },
      }),
    /registry or request error/,
  );
});

test("rejects an audit response without vulnerability metadata", () => {
  assert.throws(
    () => validatePnpmAuditDocument({ advisories: {}, metadata: {} }),
    /missing vulnerability count metadata/,
  );
});

test("approves only the exact dependency path in an exception", () => {
  const evaluation = evaluatePnpmAuditFindings(
    auditDocumentWithPaths([
      ".>sdk>example-package",
      ".>another-sdk>example-package",
    ]),
    [approvedException],
  );

  assert.deepEqual([...evaluation.activeExceptionIds], ["GHSA-approved"]);
  assert.deepEqual(evaluation.blockingFindings, [
    "GHSA-approved:example-package:moderate:unapproved-path",
  ]);
  assert.deepEqual(evaluation.staleExceptionIds, []);
});

test("accepts an exact moderate exception and rejects severity escalation", () => {
  const approvedEvaluation = evaluatePnpmAuditFindings(
    auditDocumentWithPaths([".>sdk>example-package"]),
    [approvedException],
  );
  assert.deepEqual(approvedEvaluation.blockingFindings, []);

  const escalatedDocument = auditDocumentWithPaths([".>sdk>example-package"]);
  escalatedDocument.advisories.example.severity = "high";
  escalatedDocument.metadata.vulnerabilities.moderate = 0;
  escalatedDocument.metadata.vulnerabilities.high = 1;
  const escalatedEvaluation = evaluatePnpmAuditFindings(escalatedDocument, [
    { ...approvedException, severity: "high" },
  ]);
  assert.deepEqual(escalatedEvaluation.blockingFindings, [
    "GHSA-approved:example-package:high:unapproved-path",
  ]);
});

test("reports an unused path-specific exception as stale", () => {
  const evaluation = evaluatePnpmAuditFindings(
    auditDocumentWithPaths([".>sdk>example-package"]),
    [
      approvedException,
      {
        ...approvedException,
        dependencyPath: ".>unused-sdk>example-package",
      },
    ],
  );

  assert.deepEqual(evaluation.blockingFindings, []);
  assert.deepEqual(evaluation.staleExceptionIds, ["GHSA-approved"]);
});

test("blocks inconsistent metadata and unknown severities", () => {
  const missingAdvisoryDocument = {
    advisories: {},
    metadata: {
      vulnerabilities: { ...emptyVulnerabilityCounts(), high: 1 },
    },
  };
  assert.deepEqual(
    evaluatePnpmAuditFindings(missingAdvisoryDocument, []).blockingFindings,
    ["metadata:high:count-mismatch"],
  );

  const unknownSeverityDocument = auditDocumentWithPaths([
    ".>sdk>example-package",
  ]);
  unknownSeverityDocument.advisories.example.severity = "urgent";
  unknownSeverityDocument.metadata.vulnerabilities.moderate = 1;
  assert.deepEqual(
    evaluatePnpmAuditFindings(unknownSeverityDocument, [
      { ...approvedException, severity: "urgent" },
    ]).blockingFindings,
    [
      "GHSA-approved:example-package:urgent:invalid-shape",
      "metadata:moderate:count-mismatch",
    ],
  );
});

function auditDocumentWithPaths(paths) {
  return {
    advisories: {
      example: {
        github_advisory_id: "GHSA-approved",
        module_name: "example-package",
        severity: "moderate",
        findings: [{ paths }],
      },
    },
    metadata: {
      vulnerabilities: { ...emptyVulnerabilityCounts(), moderate: 1 },
    },
  };
}

function emptyVulnerabilityCounts() {
  return { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
}

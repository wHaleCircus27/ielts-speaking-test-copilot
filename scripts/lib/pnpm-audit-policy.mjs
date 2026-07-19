const vulnerabilityCountNames = ["info", "low", "moderate", "high", "critical"];
const allowedExceptionSeverityNames = new Set(["info", "low", "moderate"]);

export function validatePnpmAuditDocument(auditDocument) {
  if (!isRecord(auditDocument)) {
    throw new Error("pnpm audit returned an invalid JSON document.");
  }
  if (
    Object.hasOwn(auditDocument, "error") &&
    auditDocument.error !== null &&
    auditDocument.error !== undefined
  ) {
    throw new Error("pnpm audit reported a registry or request error.");
  }
  if (!isRecord(auditDocument.advisories)) {
    throw new Error("pnpm audit response is missing the advisories object.");
  }
  if (!isRecord(auditDocument.metadata?.vulnerabilities)) {
    throw new Error(
      "pnpm audit response is missing vulnerability count metadata.",
    );
  }
  for (const countName of vulnerabilityCountNames) {
    const count = auditDocument.metadata.vulnerabilities[countName];
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(
        `pnpm audit returned an invalid ${countName} vulnerability count.`,
      );
    }
  }
  return auditDocument;
}

export function evaluatePnpmAuditFindings(auditDocument, exceptions) {
  validatePnpmAuditDocument(auditDocument);
  const activeExceptionIds = new Set();
  const activeExceptionKeys = new Set();
  const blockingFindings = [];

  for (const advisory of Object.values(auditDocument.advisories)) {
    if (!isRecord(advisory)) {
      blockingFindings.push("invalid-advisory");
      continue;
    }
    const advisoryId = normalizedString(advisory.github_advisory_id);
    const packageName = normalizedString(advisory.module_name);
    const severity = normalizedString(advisory.severity);
    const findingPaths = uniqueFindingPaths(advisory.findings);
    if (
      !advisoryId ||
      !packageName ||
      !vulnerabilityCountNames.includes(severity) ||
      findingPaths.length === 0
    ) {
      blockingFindings.push(
        `${advisoryId || "unknown"}:${packageName || "unknown"}:${severity || "unknown"}:invalid-shape`,
      );
      continue;
    }

    for (const dependencyPath of findingPaths) {
      const matchingException = exceptions.find(
        (exception) =>
          exception.advisoryId === advisoryId &&
          exception.package === packageName &&
          exception.severity === severity &&
          exception.dependencyPath === dependencyPath,
      );
      if (
        severity === "high" ||
        severity === "critical" ||
        !matchingException
      ) {
        blockingFindings.push(
          `${advisoryId}:${packageName}:${severity}:unapproved-path`,
        );
      } else {
        activeExceptionIds.add(matchingException.advisoryId);
        activeExceptionKeys.add(exceptionKey(matchingException));
      }
    }
  }

  for (const severity of vulnerabilityCountNames) {
    const advisoryCount = Object.values(auditDocument.advisories).filter(
      (advisory) =>
        isRecord(advisory) && normalizedString(advisory.severity) === severity,
    ).length;
    if (advisoryCount !== auditDocument.metadata.vulnerabilities[severity]) {
      blockingFindings.push(`metadata:${severity}:count-mismatch`);
    }
  }

  const staleExceptionIds = exceptions
    .filter((exception) => !activeExceptionKeys.has(exceptionKey(exception)))
    .map((exception) => exception.advisoryId);
  return { activeExceptionIds, blockingFindings, staleExceptionIds };
}

export function isAllowedExceptionSeverity(severity) {
  return allowedExceptionSeverityNames.has(severity);
}

function exceptionKey(exception) {
  return `${exception.advisoryId}\u0000${exception.package}\u0000${exception.severity}\u0000${exception.dependencyPath}`;
}

function uniqueFindingPaths(findings) {
  if (!Array.isArray(findings)) {
    return [];
  }
  const paths = findings.flatMap((finding) =>
    isRecord(finding) && Array.isArray(finding.paths)
      ? finding.paths.filter(
          (dependencyPath) =>
            typeof dependencyPath === "string" && dependencyPath.length > 0,
        )
      : [],
  );
  return [...new Set(paths)];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

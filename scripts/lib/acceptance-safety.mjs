import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const ignoredEvidenceDirectory = resolve(
  repositoryRoot,
  "test-resource/generated/evidence",
);
const maximumJsonResponseBytes = 2 * 1024 * 1024;
const maximumWavHeaderBytes = 1024 * 1024;
const keychainService = "com.local.ielts-speaking-test-copilot";
const execFileAsync = promisify(execFile);
const allowedAcceptanceServices = new Set([
  "deepseek",
  "azure",
  "zhipu",
  "azure-speech-fixture",
]);
const allowedAcceptanceStatuses = new Set(["dry-run", "passed", "failed"]);
const allowedAcceptanceInputTypes = new Set([
  "synthetic-text",
  "synthetic-audio",
]);
const prohibitedSummaryKeyPattern =
  /(authorization|body|key|path|prompt|response|secret|text|token|transcript|vector)/i;
const allowedSummaryKeys = new Set([
  "schemaVersion",
  "service",
  "status",
  "failureCode",
  "httpStatus",
  "requestCount",
  "successCount",
  "httpStatusCounts",
  "latencyMs",
  "average",
  "p50",
  "p95",
  "dimensions",
  "model",
  "modelAvailable",
  "gradingShape",
  "overallBandValid",
  "subScoreCount",
  "correctionCount",
  "hasFeedback",
  "hasModelAnswer",
  "credentialExchange",
  "format",
  "durationMs",
  "minimumDurationMs",
  "sampleRateHz",
  "channels",
  "bitDepth",
  "artifact",
  "sampleCount",
  "regionValidated",
  "languageValidated",
  "inputType",
]);

export class AcceptanceFailure extends Error {
  constructor(code, httpStatus) {
    super(code);
    this.name = "AcceptanceFailure";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function buildAzureTokenEndpoint(region) {
  const normalizedRegion = normalizeAzureRegion(region);
  const endpoint = new URL("https://api.cognitive.microsoft.com");
  endpoint.hostname = `${normalizedRegion}.api.cognitive.microsoft.com`;
  endpoint.pathname = "/sts/v1.0/issueToken";
  assertSafeUrl(endpoint, `${normalizedRegion}.api.cognitive.microsoft.com`);
  return endpoint;
}

export function buildDeepSeekEndpoint(baseUrl, endpointName) {
  if (!new Set(["models", "chat"]).has(endpointName)) {
    throw new AcceptanceFailure("DEEPSEEK_ENDPOINT_INVALID");
  }
  const terminalPath =
    endpointName === "models" ? "models" : "chat/completions";
  return appendOfficialEndpoint({
    baseUrl,
    expectedHostname: "api.deepseek.com",
    allowedBasePaths: ["/", "/v1"],
    terminalPath,
  });
}

export function buildZhipuEmbeddingsEndpoint(baseUrl) {
  return appendOfficialEndpoint({
    baseUrl,
    expectedHostname: "open.bigmodel.cn",
    allowedBasePaths: ["/api/paas/v4", "/api/paas/v4/embeddings"],
    terminalPath: "embeddings",
  });
}

export function normalizeAzureRegion(region) {
  const normalizedRegion = region?.trim().toLowerCase();
  if (!normalizedRegion || !/^[a-z][a-z0-9]{1,31}$/.test(normalizedRegion)) {
    throw new AcceptanceFailure("AZURE_REGION_INVALID");
  }
  return normalizedRegion;
}

export function validateAzureLanguage(language) {
  const normalizedLanguage = language?.trim();
  if (
    !normalizedLanguage ||
    !/^[a-z]{2,3}-[A-Z]{2}$/.test(normalizedLanguage)
  ) {
    throw new AcceptanceFailure("AZURE_LANGUAGE_INVALID");
  }
  return normalizedLanguage;
}

export function validateModelName(model, failureCode = "MODEL_INVALID") {
  const normalizedModel = model?.trim();
  if (!normalizedModel || !/^[A-Za-z0-9._:-]{1,128}$/.test(normalizedModel)) {
    throw new AcceptanceFailure(failureCode);
  }
  return normalizedModel;
}

export async function resolveCredential({
  environmentValue,
  filePath,
  keychainAccount,
  expectedBinding,
  pattern,
}) {
  const environmentCredential = parseCredential(
    environmentValue ?? "",
    pattern,
  );
  if (environmentCredential) {
    return environmentCredential;
  }

  const keychainCredential = await readBoundKeychainCredential({
    account: keychainAccount,
    expectedBinding,
    pattern,
  });
  if (keychainCredential) {
    return keychainCredential;
  }

  let fileContents;
  try {
    fileContents = await readFile(resolve(filePath), "utf8");
  } catch {
    throw new AcceptanceFailure("CREDENTIAL_MISSING");
  }
  const fileCredential = parseCredential(fileContents, pattern);
  if (!fileCredential) {
    throw new AcceptanceFailure("CREDENTIAL_INVALID");
  }
  return fileCredential;
}

async function readBoundKeychainCredential({
  account,
  expectedBinding,
  pattern,
}) {
  if (!account || !expectedBinding) {
    throw new AcceptanceFailure("CREDENTIAL_BINDING_INVALID");
  }
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      "/usr/bin/security",
      ["find-generic-password", "-s", keychainService, "-a", account, "-w"],
      { encoding: "utf8", maxBuffer: 64 * 1024, timeout: 10_000 },
    ));
  } catch {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new AcceptanceFailure("CREDENTIAL_INVALID");
  }
  const credential = parseCredential(payload?.secret ?? "", pattern);
  if (payload?.version !== 1 || !credential) {
    throw new AcceptanceFailure("CREDENTIAL_INVALID");
  }
  if (payload.binding !== expectedBinding) {
    throw new AcceptanceFailure("CREDENTIAL_BINDING_MISMATCH");
  }
  return credential;
}

export async function readJsonResponse(response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > maximumJsonResponseBytes
  ) {
    await response.body?.cancel();
    throw new AcceptanceFailure("SERVICE_RESPONSE_TOO_LARGE", response.status);
  }
  if (!response.body) {
    throw new AcceptanceFailure(
      "SERVICE_RESPONSE_STREAM_MISSING",
      response.status,
    );
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maximumJsonResponseBytes) {
        await reader.cancel();
        throw new AcceptanceFailure(
          "SERVICE_RESPONSE_TOO_LARGE",
          response.status,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AcceptanceFailure(
      "SERVICE_RESPONSE_JSON_INVALID",
      response.status,
    );
  }
}

export async function discardResponse(response) {
  await response.body?.cancel();
}

export async function responseHasBoundedBody(
  response,
  maximumBytes = 64 * 1024,
) {
  if (!response.body) {
    return false;
  }
  const reader = response.body.getReader();
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return totalBytes > 0;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new AcceptanceFailure(
          "SERVICE_RESPONSE_TOO_LARGE",
          response.status,
        );
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function createFailureSummary(service, error) {
  const failureCode =
    error instanceof AcceptanceFailure
      ? error.code
      : "UNEXPECTED_LOCAL_FAILURE";
  const summary = {
    schemaVersion: 1,
    service,
    status: "failed",
    inputType: service.startsWith("azure")
      ? "synthetic-audio"
      : "synthetic-text",
    failureCode,
  };
  if (
    error instanceof AcceptanceFailure &&
    Number.isInteger(error.httpStatus)
  ) {
    summary.httpStatus = error.httpStatus;
  }
  return summary;
}

export async function emitAcceptanceSummary(summary, { persist = false } = {}) {
  assertSanitizedSummary(summary);
  let emittedSummary = summary;
  if (persist) {
    try {
      await persistAcceptanceSummary(summary);
    } catch {
      emittedSummary = createFailureSummary(
        summary.service,
        new AcceptanceFailure("SUMMARY_PERSIST_FAILED"),
      );
      process.exitCode = 1;
    }
  }
  console.log(JSON.stringify(emittedSummary));
  return emittedSummary;
}

export function assertSanitizedSummary(summary) {
  inspectSummaryValue(summary, "summary");
  if (
    summary.schemaVersion !== 1 ||
    !allowedAcceptanceServices.has(summary.service) ||
    !allowedAcceptanceStatuses.has(summary.status) ||
    !allowedAcceptanceInputTypes.has(summary.inputType)
  ) {
    throw new AcceptanceFailure("SUMMARY_SCHEMA_INVALID");
  }
}

export async function inspectPcmWav(wavPath) {
  let wavFile;
  try {
    wavFile = await open(resolve(wavPath), "r");
    const fileStats = await wavFile.stat();
    const headerBytes = Math.min(fileStats.size, maximumWavHeaderBytes);
    const header = Buffer.alloc(headerBytes);
    const { bytesRead } = await wavFile.read(header, 0, header.length, 0);
    return parsePcmWavHeader(header.subarray(0, bytesRead), fileStats.size);
  } catch (error) {
    if (error instanceof AcceptanceFailure) {
      throw error;
    }
    throw new AcceptanceFailure("WAV_READ_FAILED");
  } finally {
    await wavFile?.close();
  }
}

export function parsePcmWavHeader(header, fileSize) {
  if (
    header.length < 12 ||
    header.toString("ascii", 0, 4) !== "RIFF" ||
    header.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new AcceptanceFailure("WAV_CONTAINER_INVALID");
  }

  let format;
  let dataBytes;
  let dataOffset;
  let chunkOffset = 12;
  while (chunkOffset + 8 <= header.length) {
    const chunkId = header.toString("ascii", chunkOffset, chunkOffset + 4);
    const chunkSize = header.readUInt32LE(chunkOffset + 4);
    const chunkDataOffset = chunkOffset + 8;
    if (
      chunkId === "fmt " &&
      chunkSize >= 16 &&
      chunkDataOffset + 16 <= header.length
    ) {
      format = {
        audioFormat: header.readUInt16LE(chunkDataOffset),
        channels: header.readUInt16LE(chunkDataOffset + 2),
        sampleRateHz: header.readUInt32LE(chunkDataOffset + 4),
        bitDepth: header.readUInt16LE(chunkDataOffset + 14),
      };
    } else if (chunkId === "data") {
      dataBytes = chunkSize;
      dataOffset = chunkDataOffset;
      break;
    }
    chunkOffset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (!format || dataBytes === undefined || dataOffset === undefined) {
    throw new AcceptanceFailure("WAV_CHUNKS_MISSING");
  }
  if (format.audioFormat !== 1 || format.bitDepth % 8 !== 0) {
    throw new AcceptanceFailure("WAV_PCM_FORMAT_INVALID");
  }
  if (dataOffset + dataBytes > fileSize) {
    throw new AcceptanceFailure("WAV_DATA_TRUNCATED");
  }
  const bytesPerSecond =
    format.sampleRateHz * format.channels * (format.bitDepth / 8);
  if (!Number.isSafeInteger(bytesPerSecond) || bytesPerSecond <= 0) {
    throw new AcceptanceFailure("WAV_RATE_INVALID");
  }

  return {
    format: "wav-pcm",
    durationMs: Math.round((dataBytes / bytesPerSecond) * 1000),
    sampleRateHz: format.sampleRateHz,
    channels: format.channels,
    bitDepth: format.bitDepth,
  };
}

function appendOfficialEndpoint({
  baseUrl,
  expectedHostname,
  allowedBasePaths,
  terminalPath,
}) {
  let endpoint;
  try {
    endpoint = new URL(baseUrl?.trim());
  } catch {
    throw new AcceptanceFailure("SERVICE_BASE_URL_INVALID");
  }
  assertSafeUrl(endpoint, expectedHostname);
  const normalizedBasePath = normalizeUrlPath(endpoint.pathname);
  if (!allowedBasePaths.includes(normalizedBasePath)) {
    throw new AcceptanceFailure("SERVICE_BASE_PATH_INVALID");
  }
  const terminalSuffix = `/${terminalPath}`;
  endpoint.pathname = normalizedBasePath.endsWith(terminalSuffix)
    ? normalizedBasePath
    : `${normalizedBasePath === "/" ? "" : normalizedBasePath}${terminalSuffix}`;
  return endpoint;
}

function assertSafeUrl(url, expectedHostname) {
  if (
    url.protocol !== "https:" ||
    url.hostname !== expectedHostname ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new AcceptanceFailure("SERVICE_URL_REJECTED");
  }
}

function normalizeUrlPath(pathname) {
  const withoutTrailingSlash = pathname.replace(/\/+$/, "");
  return withoutTrailingSlash || "/";
}

function parseCredential(rawCredential, pattern) {
  return rawCredential
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[A-Za-z0-9_ -]+\s*[:=]\s*/, "").trim())
    .find((line) => pattern.test(line));
}

function inspectSummaryValue(value, location, parentKey) {
  if (Array.isArray(value)) {
    throw new AcceptanceFailure("SUMMARY_ARRAY_NOT_ALLOWED");
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, childValue] of Object.entries(value)) {
      const numericStatusKey =
        parentKey === "httpStatusCounts" && /^\d{3}$/.test(key);
      if (
        prohibitedSummaryKeyPattern.test(key) ||
        (!numericStatusKey && !allowedSummaryKeys.has(key))
      ) {
        throw new AcceptanceFailure("SUMMARY_KEY_REJECTED");
      }
      inspectSummaryValue(childValue, `${location}.${key}`, key);
    }
    return;
  }
  if (typeof value === "string" && containsSensitiveSummaryValue(value)) {
    throw new AcceptanceFailure("SUMMARY_VALUE_REJECTED");
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new AcceptanceFailure("SUMMARY_VALUE_TYPE_REJECTED");
  }
  if (!["string", "number", "boolean", "undefined"].includes(typeof value)) {
    throw new AcceptanceFailure("SUMMARY_VALUE_TYPE_REJECTED");
  }
}

function containsSensitiveSummaryValue(value) {
  return (
    /\/Users\//.test(value) ||
    /\/home\//.test(value) ||
    /[A-Za-z]:\\Users\\/.test(value) ||
    /\bBearer\s+/i.test(value) ||
    /\b(?:sk|api)[-_][A-Za-z0-9]{16,}\b/i.test(value)
  );
}

async function persistAcceptanceSummary(summary) {
  await mkdir(ignoredEvidenceDirectory, { recursive: true, mode: 0o700 });
  const finalPath = resolve(
    ignoredEvidenceDirectory,
    `${summary.service}.json`,
  );
  const temporaryPath = `${finalPath}.${randomUUID()}.partial`;
  await writeFile(temporaryPath, `${JSON.stringify(summary, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, finalPath);
}

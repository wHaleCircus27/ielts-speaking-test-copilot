#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  AcceptanceFailure,
  buildAzureTokenEndpoint,
  createFailureSummary,
  discardResponse,
  emitAcceptanceSummary,
  inspectPcmWav,
  normalizeAzureRegion,
  resolveCredential,
  responseHasBoundedBody,
  validateAzureLanguage,
} from "./lib/acceptance-safety.mjs";

const service = "azure";
const minimumAcceptanceDurationMs = 35_000;
const defaultWavPath = "test-resource/generated/azure-acceptance-35s.wav";
const execFileAsync = promisify(execFile);
let commandLineOptions;

try {
  commandLineOptions = parseCommandLineOptions(process.argv.slice(2));
  if (commandLineOptions.help) {
    printHelp();
  } else if (commandLineOptions.dryRun) {
    buildAzureTokenEndpoint(commandLineOptions.region ?? "eastasia");
    validateAzureLanguage(commandLineOptions.language ?? "en-US");
    await emitAcceptanceSummary({
      schemaVersion: 1,
      service,
      status: "dry-run",
      inputType: "synthetic-audio",
      regionValidated: true,
      languageValidated: true,
      sampleCount: 1,
    });
  } else {
    const summary = await runAzureSpeechPreflight(commandLineOptions);
    await emitAcceptanceSummary(summary, { persist: true });
  }
} catch (error) {
  await emitAcceptanceSummary(createFailureSummary(service, error), {
    persist: Boolean(commandLineOptions && !commandLineOptions.dryRun),
  });
  process.exitCode = 1;
}

async function runAzureSpeechPreflight(options) {
  const startedAt = performance.now();
  const region = options.region ?? process.env.AZURE_SPEECH_REGION;
  validateAzureLanguage(
    options.language ?? process.env.AZURE_SPEECH_LANGUAGE ?? "en-US",
  );
  const normalizedRegion = normalizeAzureRegion(region);
  const tokenEndpoint = buildAzureTokenEndpoint(normalizedRegion);
  const credential = await resolveCredential({
    environmentValue: process.env.AZURE_SPEECH_KEY,
    filePath:
      process.env.AZURE_SPEECH_KEY_FILE ?? "test-resource/azureSpeechKey.txt",
    keychainAccount: "azure",
    expectedBinding: normalizedRegion,
    pattern: /^[A-Za-z0-9+/=_-]{30,}$/,
  });
  const tokenStatus = await requestAzureSpeechToken({
    credential,
    tokenEndpoint,
  });
  const wavMetadata = await verifyWavFile(
    process.env.AZURE_SPEECH_WAV ?? defaultWavPath,
  );

  return {
    schemaVersion: 1,
    service,
    status: "passed",
    inputType: "synthetic-audio",
    latencyMs: Number((performance.now() - startedAt).toFixed(1)),
    httpStatus: tokenStatus,
    credentialExchange: "passed",
    format: "wav-pcm",
    durationMs: wavMetadata.durationMs,
    minimumDurationMs: minimumAcceptanceDurationMs,
    sampleRateHz: 16000,
    channels: 1,
    bitDepth: 16,
    sampleCount: 1,
  };
}

async function requestAzureSpeechToken({ credential, tokenEndpoint }) {
  let response;
  try {
    response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": credential,
      },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new AcceptanceFailure("AZURE_TOKEN_NETWORK_FAILED");
  }
  if (!response.ok) {
    await discardResponse(response);
    throw new AcceptanceFailure("AZURE_TOKEN_HTTP_FAILED", response.status);
  }
  if (!(await responseHasBoundedBody(response))) {
    throw new AcceptanceFailure("AZURE_TOKEN_EMPTY", response.status);
  }
  return response.status;
}

async function verifyWavFile(wavPath) {
  const metadata = await inspectPcmWav(wavPath);
  if (
    metadata.sampleRateHz !== 16000 ||
    metadata.channels !== 1 ||
    metadata.bitDepth !== 16
  ) {
    throw new AcceptanceFailure("AZURE_WAV_FORMAT_INVALID");
  }
  if (metadata.durationMs < minimumAcceptanceDurationMs) {
    throw new AcceptanceFailure("AZURE_WAV_TOO_SHORT");
  }

  try {
    await execFileAsync("/usr/bin/afinfo", ["-x", "-r", wavPath], {
      timeout: 30_000,
      maxBuffer: 32 * 1024,
      encoding: "buffer",
    });
  } catch {
    throw new AcceptanceFailure("AZURE_AFINFO_FAILED");
  }
  return metadata;
}

function parseCommandLineOptions(args) {
  const options = {
    dryRun: false,
    help: false,
    language: undefined,
    region: undefined,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (["--language", "--region"].includes(argument)) {
      const value = readRequiredArgumentValue(args[index + 1]);
      if (argument === "--language") options.language = value;
      if (argument === "--region") options.region = value;
      index += 1;
    } else {
      throw new AcceptanceFailure("CLI_ARGUMENT_INVALID");
    }
  }
  return options;
}

function readRequiredArgumentValue(value) {
  if (!value || value.startsWith("--")) {
    throw new AcceptanceFailure("CLI_ARGUMENT_VALUE_MISSING");
  }
  return value;
}

function printHelp() {
  console.log(`Usage: pnpm azure:speech-preflight [options]

Options:
  --region <region>      Azure Speech region (or AZURE_SPEECH_REGION)
  --language <locale>    Recognition locale, default en-US
  --dry-run              Validate arguments without credentials, files, or network
  --help                 Show this help

Sensitive file overrides are accepted only through AZURE_SPEECH_KEY_FILE and AZURE_SPEECH_WAV.`);
}

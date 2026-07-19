#!/usr/bin/env node

import {
  AcceptanceFailure,
  buildDeepSeekEndpoint,
  createFailureSummary,
  discardResponse,
  emitAcceptanceSummary,
  readJsonResponse,
  resolveCredential,
  validateModelName,
} from "./lib/acceptance-safety.mjs";

const service = "deepseek";
const syntheticQuestion = "Describe a skill that is useful in everyday life.";
const syntheticAnswer =
  "Cooking is useful for me because it help me save money and I can preparing healthier meals. I learned it from my grandmother, and now I cook three times every week.";
let commandLineOptions;

try {
  commandLineOptions = parseCommandLineOptions(process.argv.slice(2));
  if (commandLineOptions.help) {
    printHelp();
  } else if (commandLineOptions.dryRun) {
    const input = resolveAcceptanceInput(commandLineOptions);
    buildDeepSeekEndpoint(input.baseUrl, "models");
    buildDeepSeekEndpoint(input.baseUrl, "chat");
    await emitAcceptanceSummary({
      schemaVersion: 1,
      service,
      status: "dry-run",
      inputType: "synthetic-text",
      model: input.model,
      sampleCount: 1,
    });
  } else {
    const summary = await runDeepSeekAcceptance(commandLineOptions);
    await emitAcceptanceSummary(summary, { persist: true });
  }
} catch (error) {
  await emitAcceptanceSummary(createFailureSummary(service, error), {
    persist: Boolean(commandLineOptions && !commandLineOptions.dryRun),
  });
  process.exitCode = 1;
}

async function runDeepSeekAcceptance(options) {
  const startedAt = performance.now();
  const input = resolveAcceptanceInput(options);
  const modelsEndpoint = buildDeepSeekEndpoint(input.baseUrl, "models");
  const chatEndpoint = buildDeepSeekEndpoint(input.baseUrl, "chat");
  const credential = await resolveCredential({
    environmentValue: process.env.DEEPSEEK_API_KEY,
    filePath:
      process.env.DEEPSEEK_KEY_FILE ?? "test-resource/deepseekApiKey.txt",
    keychainAccount: "deepseek",
    expectedBinding: modelsEndpoint.origin,
    pattern: /^[A-Za-z0-9._=-]{20,}$/,
  });
  const availableModels = await requestAvailableModels({
    credential,
    endpoint: modelsEndpoint,
  });
  const modelAvailable = availableModels.has(input.model);
  if (!modelAvailable) {
    throw new AcceptanceFailure("DEEPSEEK_MODEL_UNAVAILABLE");
  }
  const gradingResponse = await requestSyntheticGrading({
    credential,
    endpoint: chatEndpoint,
    model: input.model,
  });
  const gradingShape = validateGradingShape(gradingResponse.result);

  return {
    schemaVersion: 1,
    service,
    status: "passed",
    inputType: "synthetic-text",
    latencyMs: Number((performance.now() - startedAt).toFixed(1)),
    httpStatus: gradingResponse.httpStatus,
    model: input.model,
    modelAvailable,
    gradingShape,
    sampleCount: 1,
  };
}

async function requestAvailableModels({ credential, endpoint }) {
  const response = await requestService(endpoint, {
    method: "GET",
    headers: { Authorization: `Bearer ${credential}` },
    signal: AbortSignal.timeout(30_000),
  });
  const responseJson = await readJsonResponse(response);
  if (!Array.isArray(responseJson?.data)) {
    throw new AcceptanceFailure(
      "DEEPSEEK_MODELS_SHAPE_INVALID",
      response.status,
    );
  }
  return new Set(
    responseJson.data
      .map((model) => model?.id)
      .filter((modelId) => typeof modelId === "string"),
  );
}

async function requestSyntheticGrading({ credential, endpoint, model }) {
  const response = await requestService(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1600,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Return JSON only with overall_band, sub_scores (FC, LR, GRA, PR), personal_style_comment, vocabulary_corrections, and reconstructed_essay.",
        },
        {
          role: "user",
          content: `IELTS Part 2 synthetic acceptance sample. Question: ${syntheticQuestion} Answer: ${syntheticAnswer}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(2 * 60 * 1000),
  });
  const responseJson = await readJsonResponse(response);
  const content = responseJson?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new AcceptanceFailure(
      "DEEPSEEK_GRADING_CONTENT_MISSING",
      response.status,
    );
  }

  let result;
  try {
    result = JSON.parse(content);
  } catch {
    throw new AcceptanceFailure(
      "DEEPSEEK_GRADING_JSON_INVALID",
      response.status,
    );
  }
  return { result, httpStatus: response.status };
}

async function requestService(endpoint, requestInit) {
  let response;
  try {
    response = await fetch(endpoint, { ...requestInit, redirect: "error" });
  } catch {
    throw new AcceptanceFailure("DEEPSEEK_NETWORK_FAILED");
  }
  if (!response.ok) {
    await discardResponse(response);
    throw new AcceptanceFailure("DEEPSEEK_HTTP_FAILED", response.status);
  }
  return response;
}

function validateGradingShape(result) {
  const scoreKeys = ["FC", "LR", "GRA", "PR"];
  const overallBandValid = isBandScore(result?.overall_band);
  const validSubScoreCount = scoreKeys.filter((scoreKey) =>
    isBandScore(result?.sub_scores?.[scoreKey]),
  ).length;
  const correctionCount = Array.isArray(result?.vocabulary_corrections)
    ? result.vocabulary_corrections.length
    : 0;
  const hasFeedback =
    typeof result?.personal_style_comment === "string" &&
    result.personal_style_comment.trim().length > 0;
  const hasModelAnswer =
    typeof result?.reconstructed_essay === "string" &&
    result.reconstructed_essay.trim().length > 0;
  if (
    !overallBandValid ||
    validSubScoreCount !== scoreKeys.length ||
    correctionCount < 1 ||
    !hasFeedback ||
    !hasModelAnswer
  ) {
    throw new AcceptanceFailure("DEEPSEEK_GRADING_SHAPE_INVALID");
  }
  return {
    overallBandValid,
    subScoreCount: validSubScoreCount,
    correctionCount,
    hasFeedback,
    hasModelAnswer,
  };
}

function isBandScore(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 9
  );
}

function resolveAcceptanceInput(options) {
  return {
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    model: validateModelName(
      options.model ?? process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
      "DEEPSEEK_MODEL_INVALID",
    ),
  };
}

function parseCommandLineOptions(args) {
  const options = {
    dryRun: false,
    help: false,
    model: undefined,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--model") {
      const value = readRequiredArgumentValue(args[index + 1]);
      options.model = value;
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
  console.log(`Usage: pnpm deepseek:acceptance [options]

Options:
  --model <model>    Configured grading model
  --dry-run          Validate configuration without credentials or network
  --help             Show this help

Sensitive file overrides are accepted only through DEEPSEEK_KEY_FILE; endpoint overrides use DEEPSEEK_BASE_URL.`);
}

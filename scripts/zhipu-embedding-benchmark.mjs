#!/usr/bin/env node

import {
  AcceptanceFailure,
  buildZhipuEmbeddingsEndpoint,
  createFailureSummary,
  discardResponse,
  emitAcceptanceSummary,
  readJsonResponse,
  resolveCredential,
  validateModelName,
} from "./lib/acceptance-safety.mjs";

const service = "zhipu";
const requiredEmbeddingDimensions = 1024;
const syntheticSamples = [
  "Question: Describe a memorable journey. Answer: I travelled with classmates and learned to plan better.",
  "Question: Do you prefer studying alone? Answer: I prefer a small group because discussion reveals mistakes.",
  "Question: Talk about a useful skill. Answer: Cooking saves money and helps me care for my family.",
];
let commandLineOptions;

try {
  commandLineOptions = parseCommandLineOptions(process.argv.slice(2));
  if (commandLineOptions.help) {
    printHelp();
  } else if (commandLineOptions.dryRun) {
    const dryRunInput = resolveBenchmarkInput(commandLineOptions);
    buildZhipuEmbeddingsEndpoint(dryRunInput.baseUrl);
    await emitAcceptanceSummary({
      schemaVersion: 1,
      service,
      status: "dry-run",
      inputType: "synthetic-text",
      model: dryRunInput.model,
      dimensions: dryRunInput.dimensions,
      sampleCount: syntheticSamples.length,
    });
  } else {
    const summary = await runZhipuEmbeddingBenchmark(commandLineOptions);
    await emitAcceptanceSummary(summary, { persist: true });
  }
} catch (error) {
  await emitAcceptanceSummary(createFailureSummary(service, error), {
    persist: Boolean(commandLineOptions && !commandLineOptions.dryRun),
  });
  process.exitCode = 1;
}

async function runZhipuEmbeddingBenchmark(options) {
  const benchmarkInput = resolveBenchmarkInput(options);
  const endpoint = buildZhipuEmbeddingsEndpoint(benchmarkInput.baseUrl);
  const credential = await resolveCredential({
    environmentValue: process.env.ZHIPU_API_KEY,
    filePath: process.env.ZHIPU_KEY_FILE ?? "test-resource/zhipuApiKey.txt",
    keychainAccount: "zhipu",
    expectedBinding: endpoint.origin,
    pattern: /^[A-Za-z0-9._=-]{20,}$/,
  });
  const statusCounts = new Map();
  const durations = [];
  let successfulResponses = 0;

  for (const sample of syntheticSamples) {
    const startedAt = performance.now();
    const result = await requestZhipuEmbedding({
      credential,
      endpoint,
      model: benchmarkInput.model,
      dimensions: benchmarkInput.dimensions,
      input: sample,
    });
    durations.push(performance.now() - startedAt);
    statusCounts.set(
      result.httpStatus,
      (statusCounts.get(result.httpStatus) ?? 0) + 1,
    );
    if (result.validDimensions) {
      successfulResponses += 1;
    }
  }
  if (successfulResponses !== syntheticSamples.length) {
    throw new AcceptanceFailure("ZHIPU_EMBEDDING_SHAPE_FAILED");
  }
  const latency = summarizeDurations(durations);

  return {
    schemaVersion: 1,
    service,
    status: "passed",
    inputType: "synthetic-text",
    requestCount: syntheticSamples.length,
    successCount: successfulResponses,
    httpStatusCounts: Object.fromEntries(
      [...statusCounts.entries()].sort(
        ([leftStatus], [rightStatus]) => leftStatus - rightStatus,
      ),
    ),
    latencyMs: latency,
    dimensions: benchmarkInput.dimensions,
    model: benchmarkInput.model,
  };
}

async function requestZhipuEmbedding({
  credential,
  endpoint,
  model,
  dimensions,
  input,
}) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input, dimensions }),
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new AcceptanceFailure("ZHIPU_NETWORK_FAILED");
  }
  if (!response.ok) {
    await discardResponse(response);
    throw new AcceptanceFailure("ZHIPU_HTTP_FAILED", response.status);
  }
  const responseJson = await readJsonResponse(response);
  return {
    httpStatus: response.status,
    validDimensions: responseJson?.data?.[0]?.embedding?.length === dimensions,
  };
}

function resolveBenchmarkInput(options) {
  const baseUrl =
    process.env.ZHIPU_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4";
  const model = validateModelName(
    options.model ?? process.env.ZHIPU_EMBEDDING_MODEL ?? "embedding-3",
    "ZHIPU_MODEL_INVALID",
  );
  const dimensions = Number(
    options.dimensions ??
      process.env.ZHIPU_EMBEDDING_DIMENSIONS ??
      requiredEmbeddingDimensions,
  );
  if (dimensions !== requiredEmbeddingDimensions) {
    throw new AcceptanceFailure("ZHIPU_DIMENSIONS_INVALID");
  }
  return { baseUrl, model, dimensions };
}

function summarizeDurations(durations) {
  const sortedDurations = [...durations].sort((left, right) => left - right);
  const totalDuration = sortedDurations.reduce(
    (sum, duration) => sum + duration,
    0,
  );
  return {
    average: roundDuration(totalDuration / sortedDurations.length),
    p50: roundDuration(percentile(sortedDurations, 0.5)),
    p95: roundDuration(percentile(sortedDurations, 0.95)),
  };
}

function percentile(sortedDurations, percentileValue) {
  const rawIndex = (sortedDurations.length - 1) * percentileValue;
  const lowerIndex = Math.floor(rawIndex);
  const upperIndex = Math.ceil(rawIndex);
  if (lowerIndex === upperIndex) {
    return sortedDurations[lowerIndex];
  }
  const weight = rawIndex - lowerIndex;
  return (
    sortedDurations[lowerIndex] * (1 - weight) +
    sortedDurations[upperIndex] * weight
  );
}

function roundDuration(duration) {
  return Number(duration.toFixed(1));
}

function parseCommandLineOptions(args) {
  const options = {
    dimensions: undefined,
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
    } else if (["--dimensions", "--model"].includes(argument)) {
      const value = readRequiredArgumentValue(args[index + 1]);
      if (argument === "--dimensions") options.dimensions = value;
      if (argument === "--model") options.model = value;
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
  console.log(`Usage: pnpm zhipu:embedding-benchmark [options]

Options:
  --model <model>        Embedding model, default embedding-3
  --dimensions <number>  Must be 1024 for RC acceptance
  --dry-run              Validate configuration without credentials or network
  --help                 Show this help

Sensitive file overrides are accepted only through ZHIPU_KEY_FILE; endpoint overrides use ZHIPU_BASE_URL.`);
}

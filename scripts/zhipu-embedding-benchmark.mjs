#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const defaultSamples = [
  "Question: Describe a memorable journey.\nAnswer: I travelled to Hangzhou with my classmates and learned to plan better.",
  "Question: Do you prefer studying alone or with others?\nAnswer: I prefer studying with friends because discussion helps me notice my mistakes.",
  "Question: Talk about a useful skill.\nAnswer: Cooking is useful because it saves money and helps me take care of my family.",
];

const commandLineOptions = parseCommandLineOptions(process.argv.slice(2));

try {
  const zhipuApiKey = resolveZhipuApiKey(commandLineOptions.keyFile);
  await runZhipuEmbeddingBenchmark({
    zhipuApiKey,
    baseUrl: commandLineOptions.baseUrl ?? process.env.ZHIPU_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4",
    model: commandLineOptions.model ?? process.env.ZHIPU_EMBEDDING_MODEL ?? "embedding-3",
    dimensions: Number(commandLineOptions.dimensions ?? process.env.ZHIPU_EMBEDDING_DIMENSIONS ?? 2048),
    samples: commandLineOptions.samples.length > 0 ? commandLineOptions.samples : defaultSamples,
  });
} catch (error) {
  console.error(sanitizeErrorMessage(error));
  process.exitCode = 1;
}

async function runZhipuEmbeddingBenchmark({ zhipuApiKey, baseUrl, model, dimensions, samples }) {
  validateBenchmarkInput({ baseUrl, model, dimensions, samples });
  console.log("Zhipu embedding benchmark started.");
  console.log(`Key source: ${describeZhipuKeySource(commandLineOptions.keyFile)}`);
  console.log(`Endpoint: ${buildZhipuEmbeddingsEndpoint(baseUrl)}`);
  console.log(`Model: ${model}`);
  console.log(`Dimensions: ${dimensions}`);
  console.log(`Samples: ${samples.length}`);

  const statusCounts = new Map();
  const durations = [];
  let successfulResponses = 0;

  for (const sample of samples) {
    const startedAt = performance.now();
    const result = await requestZhipuEmbedding({
      zhipuApiKey,
      endpoint: buildZhipuEmbeddingsEndpoint(baseUrl),
      model,
      dimensions,
      input: sample,
    });
    const durationMs = performance.now() - startedAt;
    durations.push(durationMs);
    statusCounts.set(result.statusCode, (statusCounts.get(result.statusCode) ?? 0) + 1);
    if (result.ok) {
      successfulResponses += 1;
    }
  }

  const latencySummary = summarizeDurations(durations);
  console.log(`HTTP status counts: ${formatStatusCounts(statusCounts)}`);
  console.log(
    `Latency ms: avg=${latencySummary.avg.toFixed(1)}, p50=${latencySummary.p50.toFixed(1)}, p95=${latencySummary.p95.toFixed(1)}`,
  );
  console.log(`Passed: ${successfulResponses === samples.length ? "yes" : "no"}`);

  if (successfulResponses !== samples.length) {
    throw new Error(`Zhipu embedding benchmark failed: ${successfulResponses}/${samples.length} requests passed.`);
  }

  console.log("Zhipu embedding benchmark passed. No key, Authorization header, or raw response was printed.");
}

async function requestZhipuEmbedding({ zhipuApiKey, endpoint, model, dimensions, input }) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${zhipuApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input,
        dimensions,
      }),
    });
  } catch (error) {
    throw new Error(`Zhipu embedding request failed before response: ${sanitizeErrorMessage(error)}`);
  }

  if (!response.ok) {
    await response.arrayBuffer();
    return {
      ok: false,
      statusCode: response.status,
    };
  }

  const responseJson = await response.json();
  const embeddingLength = responseJson?.data?.[0]?.embedding?.length;
  return {
    ok: embeddingLength === dimensions,
    statusCode: response.status,
  };
}

function validateBenchmarkInput({ baseUrl, model, dimensions, samples }) {
  if (!baseUrl.trim()) {
    throw new Error("Zhipu Base URL is required.");
  }
  if (!model.trim()) {
    throw new Error("Zhipu embedding model is required.");
  }
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error("Zhipu embedding dimensions must be a positive integer.");
  }
  if (!samples.length || samples.some((sample) => !sample.trim())) {
    throw new Error("At least one non-empty benchmark sample is required.");
  }
}

function resolveZhipuApiKey(explicitKeyFile) {
  const keyFromEnvironment = parseZhipuKeyText(process.env.ZHIPU_API_KEY ?? "");
  if (keyFromEnvironment) {
    return keyFromEnvironment;
  }

  const keyFilePath = resolve(explicitKeyFile ?? "test-resource/zhipuApiKey.txt");
  if (!existsSync(keyFilePath)) {
    throw new Error("Zhipu API key is required. Set ZHIPU_API_KEY or create test-resource/zhipuApiKey.txt locally.");
  }

  const keyFromFile = parseZhipuKeyText(readFileSync(keyFilePath, "utf8"));
  if (!keyFromFile) {
    throw new Error(`Zhipu API key file is empty: ${keyFilePath}`);
  }

  return keyFromFile;
}

function parseZhipuKeyText(rawKeyText) {
  return rawKeyText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[A-Za-z0-9_ -]+\s*[:=]\s*/, "").trim())
    .find((line) => /^[A-Za-z0-9._=-]{20,}$/.test(line));
}

function buildZhipuEmbeddingsEndpoint(baseUrl) {
  const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  return trimmedBaseUrl.endsWith("/embeddings") ? trimmedBaseUrl : `${trimmedBaseUrl}/embeddings`;
}

function summarizeDurations(durations) {
  const sortedDurations = [...durations].sort((left, right) => left - right);
  const totalDuration = sortedDurations.reduce((sum, duration) => sum + duration, 0);
  return {
    avg: totalDuration / sortedDurations.length,
    p50: percentile(sortedDurations, 0.5),
    p95: percentile(sortedDurations, 0.95),
  };
}

function percentile(sortedDurations, percentileValue) {
  if (sortedDurations.length === 1) {
    return sortedDurations[0];
  }
  const rawIndex = (sortedDurations.length - 1) * percentileValue;
  const lowerIndex = Math.floor(rawIndex);
  const upperIndex = Math.ceil(rawIndex);
  if (lowerIndex === upperIndex) {
    return sortedDurations[lowerIndex];
  }
  const weight = rawIndex - lowerIndex;
  return sortedDurations[lowerIndex] * (1 - weight) + sortedDurations[upperIndex] * weight;
}

function formatStatusCounts(statusCounts) {
  return [...statusCounts.entries()]
    .sort(([leftStatus], [rightStatus]) => leftStatus - rightStatus)
    .map(([status, count]) => `${status}=${count}`)
    .join(", ");
}

function sanitizeErrorMessage(error) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  return rawMessage
    .replace(/Bearer\s+[A-Za-z0-9._=-]+/g, "Bearer [redacted]")
    .replace(/[A-Za-z0-9._=-]{30,}/g, "[redacted]");
}

function describeZhipuKeySource(explicitKeyFile) {
  if (process.env.ZHIPU_API_KEY?.trim()) {
    return "ZHIPU_API_KEY environment variable";
  }

  return explicitKeyFile ? "explicit local key file" : "default local key file";
}

function parseCommandLineOptions(args) {
  const options = {
    baseUrl: undefined,
    dimensions: undefined,
    keyFile: undefined,
    model: undefined,
    samples: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const currentArgument = args[index];
    const nextArgument = args[index + 1];

    if (currentArgument === "--") {
      continue;
    } else if (currentArgument === "--base-url") {
      options.baseUrl = readRequiredArgumentValue(currentArgument, nextArgument);
      index += 1;
    } else if (currentArgument === "--dimensions") {
      options.dimensions = readRequiredArgumentValue(currentArgument, nextArgument);
      index += 1;
    } else if (currentArgument === "--key-file") {
      options.keyFile = readRequiredArgumentValue(currentArgument, nextArgument);
      index += 1;
    } else if (currentArgument === "--model") {
      options.model = readRequiredArgumentValue(currentArgument, nextArgument);
      index += 1;
    } else if (currentArgument === "--sample") {
      options.samples.push(readRequiredArgumentValue(currentArgument, nextArgument));
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${currentArgument}`);
    }
  }

  return options;
}

function readRequiredArgumentValue(argumentName, argumentValue) {
  if (!argumentValue || argumentValue.startsWith("--")) {
    throw new Error(`${argumentName} requires a value.`);
  }

  return argumentValue;
}

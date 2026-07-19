import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AcceptanceFailure,
  assertSanitizedSummary,
  buildAzureTokenEndpoint,
  buildDeepSeekEndpoint,
  buildZhipuEmbeddingsEndpoint,
  parsePcmWavHeader,
} from "./lib/acceptance-safety.mjs";

test("builds only the expected official service endpoints", () => {
  assert.equal(
    buildAzureTokenEndpoint("EastAsia").toString(),
    "https://eastasia.api.cognitive.microsoft.com/sts/v1.0/issueToken",
  );
  assert.equal(
    buildDeepSeekEndpoint("https://api.deepseek.com/v1", "models").toString(),
    "https://api.deepseek.com/v1/models",
  );
  assert.equal(
    buildZhipuEmbeddingsEndpoint(
      "https://open.bigmodel.cn/api/paas/v4",
    ).toString(),
    "https://open.bigmodel.cn/api/paas/v4/embeddings",
  );
});

test("rejects endpoint credentials, query strings, fragments, HTTP, and other hosts", () => {
  const rejectedUrls = [
    "https://user:pass@api.deepseek.com",
    "https://api.deepseek.com?debug=1",
    "https://api.deepseek.com#fragment",
    "http://api.deepseek.com",
    "https://api.deepseek.com.example.invalid",
  ];
  for (const rejectedUrl of rejectedUrls) {
    assert.throws(
      () => buildDeepSeekEndpoint(rejectedUrl, "models"),
      AcceptanceFailure,
    );
  }
});

test("accepts only whitelisted evidence fields and rejects sensitive keys or paths", () => {
  assert.doesNotThrow(() =>
    assertSanitizedSummary({
      schemaVersion: 1,
      service: "zhipu",
      status: "passed",
      inputType: "synthetic-text",
      requestCount: 3,
      successCount: 3,
      httpStatusCounts: { 200: 3 },
      latencyMs: { average: 120, p50: 110, p95: 150 },
      dimensions: 1024,
      model: "embedding-3",
    }),
  );
  assert.throws(
    () =>
      assertSanitizedSummary({
        schemaVersion: 1,
        service: "azure",
        status: "passed",
        inputType: "synthetic-audio",
        token: "not-allowed",
      }),
    AcceptanceFailure,
  );
  assert.throws(
    () =>
      assertSanitizedSummary({
        schemaVersion: 1,
        service: "azure",
        status: "passed",
        inputType: "synthetic-audio",
        artifact: "/Users/example/private.wav",
      }),
    AcceptanceFailure,
  );
  assert.throws(
    () =>
      assertSanitizedSummary({
        schemaVersion: 1,
        service: "../../outside-ignored-directory",
        status: "failed",
        inputType: "synthetic-text",
        failureCode: "TEST_FAILURE",
      }),
    AcceptanceFailure,
  );
});

test("parses the committed deterministic PCM fixture without exposing its path", async () => {
  const fixtureBytes = await readFile("test-fixtures/audio/azure-ready-1s.wav");
  const metadata = parsePcmWavHeader(fixtureBytes, fixtureBytes.length);
  assert.deepEqual(metadata, {
    format: "wav-pcm",
    durationMs: 1000,
    sampleRateHz: 16000,
    channels: 1,
    bitDepth: 16,
  });
});

test("dry-run CLIs ignore credential values and emit only sanitized JSON", () => {
  const scripts = [
    "scripts/deepseek-acceptance.mjs",
    "scripts/azure-speech-preflight.mjs",
    "scripts/zhipu-embedding-benchmark.mjs",
    "scripts/generate-azure-speech-sample.mjs",
  ];
  const fakeCredential = "fake-credential-value-that-must-never-appear";
  for (const script of scripts) {
    const result = spawnSync(process.execPath, [script, "--dry-run"], {
      encoding: "utf8",
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: fakeCredential,
        DEEPSEEK_BASE_URL: "https://api.deepseek.com",
        DEEPSEEK_MODEL: "deepseek-v4-flash",
        AZURE_SPEECH_KEY: fakeCredential,
        AZURE_SPEECH_REGION: "eastasia",
        AZURE_SPEECH_LANGUAGE: "en-US",
        ZHIPU_API_KEY: fakeCredential,
        ZHIPU_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
        ZHIPU_EMBEDDING_MODEL: "embedding-3",
        ZHIPU_EMBEDDING_DIMENSIONS: "1024",
      },
    });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.doesNotMatch(result.stdout, /fake-credential-value/);
    const summary = JSON.parse(result.stdout.trim());
    assert.equal(summary.status, "dry-run");
    assertSanitizedSummary(summary);
  }
});

test("rejected CLI URLs return a stable code without echoing the supplied URL", () => {
  const rejectedUrl = "https://user:password@api.deepseek.com?unsafe=1";
  const result = spawnSync(
    process.execPath,
    ["scripts/deepseek-acceptance.mjs", "--dry-run"],
    {
      encoding: "utf8",
      env: { ...process.env, DEEPSEEK_BASE_URL: rejectedUrl },
    },
  );
  assert.equal(result.status, 1);
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    /user:password|unsafe=1/,
  );
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    schemaVersion: 1,
    service: "deepseek",
    status: "failed",
    inputType: "synthetic-text",
    failureCode: "SERVICE_URL_REJECTED",
  });
});

test("acceptance sources never forward raw errors or response bodies and use fixed media tools", async () => {
  const cloudScriptPaths = [
    "scripts/deepseek-acceptance.mjs",
    "scripts/azure-speech-preflight.mjs",
    "scripts/zhipu-embedding-benchmark.mjs",
  ];
  const cloudSources = await Promise.all(
    cloudScriptPaths.map((scriptPath) => readFile(scriptPath, "utf8")),
  );
  for (const source of cloudSources) {
    assert.doesNotMatch(
      source,
      /console\.error|error\.message|String\(error\)|response\.(?:text|arrayBuffer)\(/,
    );
  }

  const azureSource = cloudSources[1];
  const generatorSource = await readFile(
    "scripts/generate-azure-speech-sample.mjs",
    "utf8",
  );
  assert.match(azureSource, /execFileAsync\("\/usr\/bin\/afinfo"/);
  assert.match(generatorSource, /"\/usr\/bin\/say"/);
  assert.match(generatorSource, /"\/usr\/bin\/afconvert"/);
  assert.match(generatorSource, /"\/usr\/bin\/afinfo"/);
  assert.doesNotMatch(generatorSource, /FFMPEG_PATH|\bffmpeg\b/i);
});

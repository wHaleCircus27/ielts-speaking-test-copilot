#!/usr/bin/env node

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  AcceptanceFailure,
  createFailureSummary,
  emitAcceptanceSummary,
  inspectPcmWav,
} from "./lib/acceptance-safety.mjs";

const service = "azure-speech-fixture";
const minimumDurationMs = 35_000;
const outputDirectory = resolve("test-resource/generated");
const finalWavPath = resolve(outputDirectory, "azure-acceptance-35s.wav");
const syntheticSpeech = `
I would like to describe a practical skill that has improved my daily life. The skill is planning and cooking a simple meal from fresh ingredients. I started learning it because I wanted to spend less money and make healthier choices during a busy week. At first, I followed short recipes and prepared one dish at a time. I often measured everything carefully, checked the timer, and wrote down what worked well.

After several weeks, the process became much easier. I learned how to organize ingredients before turning on the stove, how to adjust seasoning gradually, and how to clean the kitchen while the food was cooking. The skill also taught me patience because rushing usually creates unnecessary mistakes. Now I can prepare dinner for friends without feeling stressed, and I enjoy sharing the result with them.

In my opinion, this skill is useful for more than making food. It helps me manage time, make sensible decisions, and take responsibility for my own wellbeing. I still try new recipes, but I no longer worry when a small detail changes. I can use what is available, solve the problem calmly, and produce a meal that everyone can enjoy.
`.trim();
const execFileAsync = promisify(execFile);
let commandLineOptions;

try {
  commandLineOptions = parseCommandLineOptions(process.argv.slice(2));
  if (commandLineOptions.help) {
    printHelp();
  } else if (commandLineOptions.dryRun) {
    await emitAcceptanceSummary({
      schemaVersion: 1,
      service,
      status: "dry-run",
      inputType: "synthetic-audio",
      artifact: "ignored-local-wav",
      minimumDurationMs,
      sampleRateHz: 16000,
      channels: 1,
      bitDepth: 16,
    });
  } else {
    const summary = await generateAzureSpeechSample();
    await emitAcceptanceSummary(summary, { persist: true });
  }
} catch (error) {
  await emitAcceptanceSummary(createFailureSummary(service, error), {
    persist: Boolean(commandLineOptions && !commandLineOptions.dryRun),
  });
  process.exitCode = 1;
}

async function generateAzureSpeechSample() {
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const artifactId = randomUUID();
  const temporaryAiffPath = resolve(
    outputDirectory,
    `${artifactId}.speech.partial.aiff`,
  );
  const temporaryWavPath = resolve(
    outputDirectory,
    `${artifactId}.wav.partial`,
  );
  try {
    await runFixedTool(
      "/usr/bin/say",
      ["-v", "Samantha", "-r", "145", "-o", temporaryAiffPath, syntheticSpeech],
      2 * 60 * 1000,
      "SPEECH_SYNTHESIS_FAILED",
    );
    await runFixedTool(
      "/usr/bin/afconvert",
      [
        "-f",
        "WAVE",
        "-d",
        "LEI16@16000",
        "-c",
        "1",
        temporaryAiffPath,
        temporaryWavPath,
      ],
      10 * 60 * 1000,
      "SPEECH_CONVERSION_FAILED",
    );
    await runFixedTool(
      "/usr/bin/afinfo",
      ["-x", "-r", temporaryWavPath],
      30_000,
      "SPEECH_AFINFO_FAILED",
    );
    const metadata = await inspectPcmWav(temporaryWavPath);
    if (
      metadata.durationMs < minimumDurationMs ||
      metadata.sampleRateHz !== 16000 ||
      metadata.channels !== 1 ||
      metadata.bitDepth !== 16
    ) {
      throw new AcceptanceFailure("SPEECH_FIXTURE_FORMAT_INVALID");
    }
    await chmod(temporaryWavPath, 0o600);
    await rename(temporaryWavPath, finalWavPath);

    return {
      schemaVersion: 1,
      service,
      status: "passed",
      inputType: "synthetic-audio",
      artifact: "ignored-local-wav",
      format: metadata.format,
      durationMs: metadata.durationMs,
      minimumDurationMs,
      sampleRateHz: metadata.sampleRateHz,
      channels: metadata.channels,
      bitDepth: metadata.bitDepth,
    };
  } finally {
    await removeTemporaryFile(temporaryAiffPath);
    await removeTemporaryFile(temporaryWavPath);
  }
}

async function runFixedTool(executable, args, timeout, failureCode) {
  try {
    await execFileAsync(executable, args, {
      timeout,
      maxBuffer: 32 * 1024,
      encoding: "buffer",
    });
  } catch {
    throw new AcceptanceFailure(failureCode);
  }
}

async function removeTemporaryFile(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new AcceptanceFailure("SPEECH_TEMP_CLEANUP_FAILED");
    }
  }
}

function parseCommandLineOptions(args) {
  const options = { dryRun: false, help: false };
  for (const argument of args) {
    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new AcceptanceFailure("CLI_ARGUMENT_INVALID");
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: pnpm azure:generate-speech [options]

Options:
  --dry-run  Validate the fixed local generation plan without writing files
  --help     Show this help`);
}

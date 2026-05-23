#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const requiredCommands = [
  {
    command: "pnpm",
    args: ["typecheck"],
    label: "TypeScript typecheck",
  },
  {
    command: "pnpm",
    args: ["test"],
    label: "Vitest MVP4 and regression suite",
  },
  {
    command: "cargo",
    args: ["test"],
    cwd: "src-tauri",
    label: "Rust Tauri command tests",
  },
  {
    command: "pnpm",
    args: ["build"],
    label: "Production build",
  },
];

const requiredWavSamples = [
  "test-resource/speakTest-afconvert-16k-mono.wav",
  "test-resource/speakTest-nvidia-asr.wav",
];

console.log("MVP4 readiness verification started.");

for (const requiredCommand of requiredCommands) {
  await runCommand(requiredCommand);
}

for (const wavSamplePath of requiredWavSamples) {
  await verifyLocalWavSample(wavSamplePath);
}

console.log("MVP4 readiness verification passed.");

async function runCommand({ command, args, cwd = ".", label }) {
  const resolvedWorkingDirectory = resolve(cwd);
  console.log(`\n[${label}] ${command} ${args.join(" ")}`);

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: resolvedWorkingDirectory,
      maxBuffer: 1024 * 1024 * 20,
    });

    printCommandOutput(stdout);
    printCommandOutput(stderr);
    console.log(`[${label}] passed`);
  } catch (error) {
    printCommandOutput(error.stdout);
    printCommandOutput(error.stderr);
    throw new Error(`[${label}] failed with exit code ${error.code ?? "unknown"}.`);
  }
}

async function verifyLocalWavSample(wavSamplePath) {
  const absoluteWavSamplePath = resolve(wavSamplePath);
  if (!existsSync(absoluteWavSamplePath)) {
    throw new Error(`Required Azure WAV sample is missing: ${absoluteWavSamplePath}`);
  }

  const audioInfo = await readAudioInfo(absoluteWavSamplePath);
  const hasRequiredShape =
    audioInfo.includes("1 ch") &&
    audioInfo.includes("16000 Hz") &&
    (audioInfo.includes("Int16") || audioInfo.includes("16 bit"));

  if (!hasRequiredShape) {
    throw new Error(`Required WAV sample is not Azure-ready: ${absoluteWavSamplePath}`);
  }

  console.log(`[Azure WAV sample] ${basename(absoluteWavSamplePath)} ready: ${summarizeAudioInfo(audioInfo)}`);
}

async function readAudioInfo(absoluteWavSamplePath) {
  try {
    const { stdout } = await execFileAsync("afinfo", [absoluteWavSamplePath], {
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch {
    const { stdout } = await execFileAsync("file", [absoluteWavSamplePath], {
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  }
}

function summarizeAudioInfo(audioInfo) {
  return (
    audioInfo
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .find((line) => line.includes("Data format:") || line.includes("WAVE audio")) ?? "audio info unavailable"
  );
}

function printCommandOutput(output) {
  const normalizedOutput = String(output ?? "").trim();
  if (normalizedOutput) {
    console.log(normalizedOutput);
  }
}

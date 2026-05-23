#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const defaultWavPaths = [
  "test-resource/speakTest-afconvert-16k-mono.wav",
  "test-resource/speakTest-nvidia-asr.wav",
];

const commandLineOptions = parseCommandLineOptions(process.argv.slice(2));

try {
  const azureSpeechRegion = resolveRequiredTextOption(
    commandLineOptions.region ?? process.env.AZURE_SPEECH_REGION,
    "Azure Speech region is required. Pass --region <region> or set AZURE_SPEECH_REGION.",
  );
  const azureSpeechLanguage = (commandLineOptions.language ?? process.env.AZURE_SPEECH_LANGUAGE ?? "en-US").trim();
  const azureSpeechKey = resolveAzureSpeechKey(commandLineOptions.keyFile);
  const wavPaths = commandLineOptions.wavPaths.length > 0 ? commandLineOptions.wavPaths : defaultWavPaths;

  await runAzureSpeechPreflight({
    azureSpeechKey,
    azureSpeechRegion,
    azureSpeechLanguage,
    wavPaths,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function runAzureSpeechPreflight({ azureSpeechKey, azureSpeechRegion, azureSpeechLanguage, wavPaths }) {
  console.log("Azure Speech preflight started.");
  console.log(`Region: ${azureSpeechRegion}`);
  console.log(`Language: ${azureSpeechLanguage}`);
  console.log(`Key source: ${describeAzureKeySource()}`);

  const tokenStatus = await requestAzureSpeechToken({
    azureSpeechKey,
    azureSpeechRegion,
  });
  console.log(`Token request: HTTP ${tokenStatus.statusCode}, non-empty token: ${tokenStatus.hasToken ? "yes" : "no"}`);

  if (!tokenStatus.ok) {
    throw new Error(`Azure Speech token request failed with HTTP ${tokenStatus.statusCode}.`);
  }

  for (const wavPath of wavPaths) {
    await verifyWavFile(wavPath);
  }

  console.log("Azure Speech preflight passed. No key or token was printed.");
}

async function requestAzureSpeechToken({ azureSpeechKey, azureSpeechRegion }) {
  const tokenEndpoint = `https://${azureSpeechRegion}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
  let response;
  try {
    response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": azureSpeechKey,
      },
    });
  } catch (error) {
    throw new Error(`Azure Speech token request failed before response: ${sanitizeErrorMessage(error)}`);
  }

  const tokenText = await response.text();
  const hasUsableToken = response.ok && tokenText.trim().length > 0;

  return {
    ok: hasUsableToken,
    statusCode: response.status,
    hasToken: hasUsableToken,
  };
}

async function verifyWavFile(wavPath) {
  const absoluteWavPath = resolve(wavPath);
  if (!existsSync(absoluteWavPath)) {
    throw new Error(`WAV sample not found: ${absoluteWavPath}`);
  }

  const audioInfo = await readAudioInfo(absoluteWavPath);
  const hasRequiredShape =
    audioInfo.includes("1 ch") &&
    audioInfo.includes("16000 Hz") &&
    (audioInfo.includes("Int16") || audioInfo.includes("16 bit"));

  if (!hasRequiredShape) {
    throw new Error(
      `WAV sample is not Azure-ready 16kHz mono 16-bit PCM: ${absoluteWavPath}\n${summarizeAudioInfo(audioInfo)}`,
    );
  }

  console.log(`WAV sample ready: ${basename(absoluteWavPath)} (${summarizeAudioInfo(audioInfo)})`);
}

async function readAudioInfo(absoluteWavPath) {
  try {
    const { stdout } = await execFileAsync("afinfo", [absoluteWavPath], {
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch {
    const { stdout } = await execFileAsync("file", [absoluteWavPath], {
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  }
}

function summarizeAudioInfo(audioInfo) {
  const compactAudioInfo = audioInfo
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => line.includes("Data format:") || line.includes("WAVE audio"));

  return compactAudioInfo ?? "audio info unavailable";
}

function resolveAzureSpeechKey(explicitKeyFile) {
  const keyFromEnvironment = parseAzureSpeechKeyText(process.env.AZURE_SPEECH_KEY ?? "");
  if (keyFromEnvironment) {
    return keyFromEnvironment;
  }

  const keyFilePath = resolve(explicitKeyFile ?? "test-resource/azureSpeechKey.txt");
  if (!existsSync(keyFilePath)) {
    throw new Error(
      "Azure Speech key is required. Set AZURE_SPEECH_KEY or create test-resource/azureSpeechKey.txt locally.",
    );
  }

  const keyFromFile = parseAzureSpeechKeyText(readFileSync(keyFilePath, "utf8"));
  if (!keyFromFile) {
    throw new Error(`Azure Speech key file is empty: ${keyFilePath}`);
  }

  return keyFromFile;
}

function parseAzureSpeechKeyText(rawKeyText) {
  return rawKeyText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[A-Za-z0-9_ -]+\s*[:=]\s*/, "").trim())
    .find((line) => /^[A-Za-z0-9+/=_-]{30,}$/.test(line));
}

function sanitizeErrorMessage(error) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  return rawMessage.replace(/[A-Za-z0-9+/=_-]{30,}/g, "[redacted]");
}

function describeAzureKeySource() {
  if (process.env.AZURE_SPEECH_KEY?.trim()) {
    return "AZURE_SPEECH_KEY environment variable";
  }

  return "local key file";
}

function resolveRequiredTextOption(value, missingMessage) {
  const normalizedValue = value?.trim();
  if (!normalizedValue) {
    throw new Error(missingMessage);
  }

  return normalizedValue;
}

function parseCommandLineOptions(args) {
  const options = {
    keyFile: undefined,
    language: undefined,
    region: undefined,
    wavPaths: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const currentArgument = args[index];
    const nextArgument = args[index + 1];

    if (currentArgument === "--") {
      continue;
    } else if (currentArgument === "--key-file") {
      options.keyFile = readRequiredArgumentValue(currentArgument, nextArgument);
      index += 1;
    } else if (currentArgument === "--language") {
      options.language = readRequiredArgumentValue(currentArgument, nextArgument);
      index += 1;
    } else if (currentArgument === "--region") {
      options.region = readRequiredArgumentValue(currentArgument, nextArgument);
      index += 1;
    } else if (currentArgument === "--wav") {
      options.wavPaths.push(readRequiredArgumentValue(currentArgument, nextArgument));
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

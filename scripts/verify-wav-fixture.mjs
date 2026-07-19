import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const expectedFixtureSha256 =
  "130d9d6e6ef253d32c393d163923c30d60385eb8d317451cb93ab6206bf230b9";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(
  repositoryRoot,
  "test-fixtures/audio/azure-ready-1s.wav",
);
const fixtureBuffer = await readFile(fixturePath);

assertEqual(
  fixtureBuffer.subarray(0, 4).toString("ascii"),
  "RIFF",
  "RIFF container",
);
assertEqual(
  fixtureBuffer.subarray(8, 12).toString("ascii"),
  "WAVE",
  "WAVE format",
);

const formatChunk = findRiffChunk(fixtureBuffer, "fmt ");
const dataChunk = findRiffChunk(fixtureBuffer, "data");
assertEqual(
  fixtureBuffer.readUInt16LE(formatChunk.offset),
  1,
  "PCM audio format",
);
assertEqual(
  fixtureBuffer.readUInt16LE(formatChunk.offset + 2),
  1,
  "mono channel count",
);
assertEqual(
  fixtureBuffer.readUInt32LE(formatChunk.offset + 4),
  16_000,
  "sample rate",
);
assertEqual(
  fixtureBuffer.readUInt16LE(formatChunk.offset + 14),
  16,
  "bits per sample",
);
assertEqual(dataChunk.length, 32_000, "one-second PCM data length");

const actualSha256 = createHash("sha256").update(fixtureBuffer).digest("hex");
assertEqual(actualSha256, expectedFixtureSha256, "fixture SHA-256");
console.log(`Verified deterministic WAV fixture (${actualSha256}).`);

function findRiffChunk(buffer, chunkId) {
  let chunkHeaderOffset = 12;
  while (chunkHeaderOffset + 8 <= buffer.length) {
    const currentChunkId = buffer
      .subarray(chunkHeaderOffset, chunkHeaderOffset + 4)
      .toString("ascii");
    const chunkLength = buffer.readUInt32LE(chunkHeaderOffset + 4);
    const chunkDataOffset = chunkHeaderOffset + 8;
    if (chunkDataOffset + chunkLength > buffer.length) {
      throw new Error(`Invalid ${currentChunkId} chunk length.`);
    }
    if (currentChunkId === chunkId) {
      return { offset: chunkDataOffset, length: chunkLength };
    }
    chunkHeaderOffset = chunkDataOffset + chunkLength + (chunkLength % 2);
  }
  throw new Error(`Missing ${chunkId} chunk.`);
}

function assertEqual(actualValue, expectedValue, label) {
  if (actualValue !== expectedValue) {
    throw new Error(
      `${label}: expected ${expectedValue}, received ${actualValue}.`,
    );
  }
}

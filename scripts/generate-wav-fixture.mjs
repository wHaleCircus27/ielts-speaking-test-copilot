import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(
  repositoryRoot,
  "test-fixtures/audio/azure-ready-1s.wav",
);
const sampleRate = 16_000;
const channelCount = 1;
const bitsPerSample = 16;
const sampleCount = sampleRate;
const bytesPerSample = bitsPerSample / 8;
const dataByteLength = sampleCount * channelCount * bytesPerSample;
const wavBuffer = Buffer.alloc(44 + dataByteLength);

wavBuffer.write("RIFF", 0, "ascii");
wavBuffer.writeUInt32LE(36 + dataByteLength, 4);
wavBuffer.write("WAVE", 8, "ascii");
wavBuffer.write("fmt ", 12, "ascii");
wavBuffer.writeUInt32LE(16, 16);
wavBuffer.writeUInt16LE(1, 20);
wavBuffer.writeUInt16LE(channelCount, 22);
wavBuffer.writeUInt32LE(sampleRate, 24);
wavBuffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
wavBuffer.writeUInt16LE(channelCount * bytesPerSample, 32);
wavBuffer.writeUInt16LE(bitsPerSample, 34);
wavBuffer.write("data", 36, "ascii");
wavBuffer.writeUInt32LE(dataByteLength, 40);

for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
  const squareWaveHalfCycle = Math.floor((sampleIndex * 880) / sampleRate);
  const sampleValue = squareWaveHalfCycle % 2 === 0 ? 8192 : -8192;
  wavBuffer.writeInt16LE(sampleValue, 44 + sampleIndex * bytesPerSample);
}

await mkdir(dirname(fixturePath), { recursive: true });
await writeFile(fixturePath, wavBuffer);
console.log("Generated test-fixtures/audio/azure-ready-1s.wav");

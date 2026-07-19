import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageManifest = JSON.parse(
  await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
);
const tauriConfig = JSON.parse(
  await readFile(resolve(repositoryRoot, "src-tauri/tauri.conf.json"), "utf8"),
);
const requiredSourceIcons = [
  "icons/icon.png",
  "icons/icon.icns",
  "icons/icon.ico",
];
for (const requiredSourceIcon of requiredSourceIcons) {
  if (!tauriConfig.bundle.icon.includes(requiredSourceIcon)) {
    throw new Error(
      `Tauri bundle configuration is missing ${requiredSourceIcon}.`,
    );
  }
}
const sourcePngPath = resolve(repositoryRoot, "src-tauri/icons/icon.png");
const sourcePngMetadata = run("/usr/bin/sips", [
  "-g",
  "pixelWidth",
  "-g",
  "pixelHeight",
  sourcePngPath,
]);
if (
  !/pixelWidth:\s+1024\b/.test(sourcePngMetadata) ||
  !/pixelHeight:\s+1024\b/.test(sourcePngMetadata)
) {
  throw new Error(
    "The source application PNG must be exactly 1024 by 1024 pixels.",
  );
}
for (const sourceIconName of ["icon.icns", "icon.ico"]) {
  const sourceIconStats = await stat(
    resolve(repositoryRoot, "src-tauri/icons", sourceIconName),
  );
  if (sourceIconStats.size < 64 * 1024) {
    throw new Error(
      `${sourceIconName} is still a placeholder rather than a complete icon set.`,
    );
  }
}
const bundleDirectory = resolve(
  repositoryRoot,
  "src-tauri/target/aarch64-apple-darwin/release/bundle/macos",
);
const archivePath = join(
  bundleDirectory,
  `ielts-speaking-test-copilot-${packageManifest.version}-arm64.zip`,
);
const archiveSha256 = createHash("sha256")
  .update(await readFile(archivePath))
  .digest("hex");
assertEqual(
  await readFile(`${archivePath}.sha256`, "utf8"),
  `${archiveSha256}  ${basename(archivePath)}\n`,
  "archive checksum sidecar",
);

const verificationDirectory = await mkdtemp(
  join(tmpdir(), "ielts-copilot-bundle-verification-"),
);
run("/usr/bin/ditto", ["-x", "-k", archivePath, verificationDirectory]);
const bundleEntries = await readdir(verificationDirectory, {
  withFileTypes: true,
});
const applicationEntries = bundleEntries.filter(
  (entry) => entry.isDirectory() && entry.name.endsWith(".app"),
);
if (applicationEntries.length !== 1) {
  throw new Error(
    `Expected one .app bundle, found ${applicationEntries.length}.`,
  );
}

const applicationPath = join(verificationDirectory, applicationEntries[0].name);
const contentsPath = join(applicationPath, "Contents");
const infoPlistPath = join(contentsPath, "Info.plist");
const resourcesPath = join(contentsPath, "Resources");
run("/usr/bin/plutil", ["-lint", infoPlistPath]);

const bundleIdentifier = readPlistValue(infoPlistPath, "CFBundleIdentifier");
const bundleVersion = readPlistValue(
  infoPlistPath,
  "CFBundleShortVersionString",
);
const bundleBuildVersion = readPlistValue(infoPlistPath, "CFBundleVersion");
const executableName = readPlistValue(infoPlistPath, "CFBundleExecutable");
const minimumSystemVersion = readPlistValue(
  infoPlistPath,
  "LSMinimumSystemVersion",
);
assertEqual(bundleIdentifier, tauriConfig.identifier, "bundle identifier");
assertEqual(bundleVersion, packageManifest.version, "bundle version");
assertEqual(
  bundleBuildVersion,
  tauriConfig.bundle.macOS.bundleVersion,
  "bundle build version",
);
assertEqual(minimumSystemVersion, "15.0", "minimum macOS version");

const executablePath = join(contentsPath, "MacOS", executableName);
assertEqual(
  run("/usr/bin/lipo", ["-archs", executablePath]),
  "arm64",
  "executable architecture",
);
run("/usr/bin/codesign", ["--verify", "--deep", "--strict", applicationPath]);
const signatureDetails = runWithStandardError("/usr/bin/codesign", [
  "-dv",
  "--verbose=4",
  applicationPath,
]);
if (
  !/Signature=adhoc\b/.test(signatureDetails) &&
  !/flags=.*\badhoc\b/.test(signatureDetails)
) {
  throw new Error("The application bundle is not ad-hoc signed.");
}

const bundledResourceFiles = await listFilesRecursively(resourcesPath);
for (const requiredResource of [
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
]) {
  if (
    !bundledResourceFiles.some(
      (filePath) => basename(filePath) === requiredResource,
    )
  ) {
    throw new Error(`App bundle is missing ${requiredResource}.`);
  }
}
if (!bundledResourceFiles.some((filePath) => filePath.endsWith(".icns"))) {
  throw new Error("App bundle is missing an ICNS application icon.");
}

console.log(
  `Verified ${applicationEntries[0].name}; archive SHA-256 ${archiveSha256}.`,
);

function readPlistValue(plistPath, key) {
  return run("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plistPath]);
}

function run(command, argumentsList) {
  return execFileSync(command, argumentsList, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function runWithStandardError(command, argumentsList) {
  const commandResult = spawnSync(command, argumentsList, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"],
  });
  if (commandResult.error) {
    throw commandResult.error;
  }
  if (commandResult.status !== 0) {
    throw new Error(
      `${basename(command)} exited with status ${commandResult.status}.`,
    );
  }
  return commandResult.stderr.trim();
}

async function listFilesRecursively(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(directoryPath, entry.name);
      return entry.isDirectory()
        ? listFilesRecursively(entryPath)
        : [entryPath];
    }),
  );
  return nestedFiles.flat();
}

function assertEqual(actualValue, expectedValue, label) {
  if (actualValue !== expectedValue) {
    throw new Error(
      `${label}: expected ${expectedValue}, received ${actualValue}.`,
    );
  }
}

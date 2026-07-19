import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const expectedApplicationVersion = "0.1.0-rc.1";
const expectedNodeVersion = "24.15.0";
const expectedPnpmVersion = "11.1.3";
const expectedRustVersion = "1.95.0";
const expectedBundleBuildVersion = "1";
const rustToolchainName = process.env.RUSTUP_TOOLCHAIN ?? expectedRustVersion;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const packageManifest = JSON.parse(
  await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
);
const cargoManifest = await readFile(
  resolve(repositoryRoot, "src-tauri/Cargo.toml"),
  "utf8",
);
const tauriManifest = JSON.parse(
  await readFile(resolve(repositoryRoot, "src-tauri/tauri.conf.json"), "utf8"),
);
const nodeVersionFile = (
  await readFile(resolve(repositoryRoot, ".node-version"), "utf8")
).trim();
const rustToolchainManifest = await readFile(
  resolve(repositoryRoot, "rust-toolchain.toml"),
  "utf8",
);
const settingsPageSource = await readFile(
  resolve(repositoryRoot, "src/features/settings/SettingsPage.tsx"),
  "utf8",
);
const changelog = await readFile(
  resolve(repositoryRoot, "CHANGELOG.md"),
  "utf8",
);
const releaseEvidence = JSON.parse(
  await readFile(
    resolve(repositoryRoot, "docs/release/evidence/0.1.0-rc.1.json"),
    "utf8",
  ),
);

assertEqual(
  packageManifest.version,
  expectedApplicationVersion,
  "package.json version",
);
assertEqual(
  packageManifest.packageManager,
  `pnpm@${expectedPnpmVersion}`,
  "package manager",
);
assertEqual(packageManifest.license, "Apache-2.0", "package license");
assertEqual(packageManifest.engines?.node, expectedNodeVersion, "Node engine");
assertEqual(nodeVersionFile, expectedNodeVersion, ".node-version");
assertMatch(
  cargoManifest,
  /^version = "0\.1\.0-rc\.1"$/m,
  "Cargo package version",
);
assertMatch(cargoManifest, /^rust-version = "1\.95"$/m, "Cargo rust-version");
assertMatch(cargoManifest, /^license = "Apache-2\.0"$/m, "Cargo license");
assertMatch(
  rustToolchainManifest,
  /^channel = "1\.95\.0"$/m,
  "Rust toolchain channel",
);
assertMatch(settingsPageSource, />v0\.1\.0-rc\.1</, "settings page version");
assertMatch(
  changelog,
  /^## \[0\.1\.0-rc\.1\] - 2026-07-19$/m,
  "CHANGELOG release heading",
);
assertEqual(
  releaseEvidence.releaseVersion,
  expectedApplicationVersion,
  "release evidence version",
);
if (
  tauriManifest.version !== "../package.json" &&
  tauriManifest.version !== expectedApplicationVersion
) {
  throw new Error(
    "Tauri version must reference ../package.json or equal the RC version.",
  );
}
assertEqual(
  tauriManifest.bundle?.macOS?.bundleVersion,
  expectedBundleBuildVersion,
  "macOS bundle build version",
);
assertEqual(tauriManifest.bundle?.license, "Apache-2.0", "bundle license");

assertEqual(process.versions.node, expectedNodeVersion, "running Node version");
assertEqual(
  runVersionCommand("pnpm", ["--version"]),
  expectedPnpmVersion,
  "running pnpm version",
);
assertMatch(
  runVersionCommand("rustc", [`+${rustToolchainName}`, "--version"]),
  new RegExp(`^rustc ${expectedRustVersion.replaceAll(".", "\\.")}\\b`),
  "running Rust version",
);
console.log(
  `Verified application ${expectedApplicationVersion} and pinned toolchains.`,
);

function runVersionCommand(command, argumentsList) {
  return execFileSync(command, argumentsList, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

function assertEqual(actualValue, expectedValue, label) {
  if (actualValue !== expectedValue) {
    throw new Error(
      `${label}: expected ${expectedValue}, received ${actualValue}.`,
    );
  }
}

function assertMatch(actualValue, expectedPattern, label) {
  if (!expectedPattern.test(actualValue)) {
    throw new Error(
      `${label}: ${JSON.stringify(actualValue)} does not match ${expectedPattern}.`,
    );
  }
}

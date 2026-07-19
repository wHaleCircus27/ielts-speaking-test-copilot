import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rustToolchain = process.env.RUSTUP_TOOLCHAIN ?? "1.95.0";
const buildResult = spawnSync(
  "pnpm",
  ["tauri", "build", "--bundles", "app", "--target", "aarch64-apple-darwin"],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      RUSTUP_TOOLCHAIN: rustToolchain,
    },
    stdio: "inherit",
  },
);

if (buildResult.error) {
  throw buildResult.error;
}
if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

const bundleDirectory = resolve(
  repositoryRoot,
  "src-tauri/target/aarch64-apple-darwin/release/bundle/macos",
);
const applicationNames = readdirSync(bundleDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
  .map((entry) => entry.name);
if (applicationNames.length !== 1) {
  throw new Error(
    `Expected one .app bundle after build, found ${applicationNames.length}.`,
  );
}

const applicationPath = join(bundleDirectory, applicationNames[0]);
runRequiredCommand("/usr/bin/xattr", ["-cr", applicationPath]);
runRequiredCommand("/usr/bin/codesign", [
  "--force",
  "--deep",
  "--sign",
  "-",
  applicationPath,
]);
runRequiredCommand("/usr/bin/xattr", ["-cr", applicationPath]);

function runRequiredCommand(command, argumentsList) {
  const commandResult = spawnSync(command, argumentsList, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (commandResult.error) {
    throw commandResult.error;
  }
  if (commandResult.status !== 0) {
    process.exit(commandResult.status ?? 1);
  }
}

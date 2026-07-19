import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
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
const archivePath = join(
  bundleDirectory,
  "ielts-speaking-test-copilot-0.1.0-rc.1-arm64.zip",
);
if (existsSync(archivePath)) {
  unlinkSync(archivePath);
}
runRequiredCommand("/bin/sh", [
  "-c",
  `set -eu
staging_root=$(/usr/bin/mktemp -d "$3/ielts-copilot-bundle.XXXXXX")
staging_app="$staging_root/$4"
/usr/bin/ditto --norsrc --noextattr --noqtn --noacl "$1" "$staging_app"
/usr/bin/xattr -cr "$staging_app"
/usr/bin/codesign --force --deep --sign - "$staging_app"
/usr/bin/xattr -cr "$staging_app"
/usr/bin/codesign --verify --deep --strict "$staging_app"
/usr/bin/ditto -c -k --norsrc --noextattr --noqtn --noacl --keepParent "$staging_app" "$2"`,
  "sign-and-archive",
  applicationPath,
  archivePath,
  tmpdir(),
  applicationNames[0],
]);
const archiveSha256 = createHash("sha256")
  .update(readFileSync(archivePath))
  .digest("hex");
writeFileSync(
  `${archivePath}.sha256`,
  `${archiveSha256}  ${basename(archivePath)}\n`,
  "utf8",
);

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

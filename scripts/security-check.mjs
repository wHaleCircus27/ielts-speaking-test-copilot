import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rustToolchain = process.env.RUSTUP_TOOLCHAIN ?? "1.95.0";
const securitySteps = [
  ["node", ["scripts/check-pnpm-audit.mjs"]],
  [
    "cargo",
    [
      `+${rustToolchain}`,
      "audit",
      "--file",
      "src-tauri/Cargo.lock",
      "--target-os",
      "macos",
      "--target-arch",
      "aarch64",
    ],
  ],
  ["gitleaks", ["git", "--redact=100", "--no-banner", "--exit-code", "1", "."]],
];

for (const [command, argumentsList] of securitySteps) {
  console.log(`\n> ${command} ${argumentsList.join(" ")}`);
  const commandResult = spawnSync(command, argumentsList, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (commandResult.error) {
    throw new Error(
      `${command} is unavailable. Install the pinned security tool before running security:check.`,
    );
  }
  if (commandResult.status !== 0) {
    process.exit(commandResult.status ?? 1);
  }
}

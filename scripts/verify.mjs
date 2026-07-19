import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rustToolchain = process.env.RUSTUP_TOOLCHAIN ?? "1.95.0";
const verificationSteps = [
  ["node", ["scripts/verify-wav-fixture.mjs"]],
  ["node", ["scripts/verify-config.mjs"]],
  ["node", ["scripts/verify-versions.mjs"]],
  [
    "node",
    [
      "--test",
      "scripts/acceptance-safety.test.mjs",
      "scripts/pnpm-audit-policy.test.mjs",
    ],
  ],
  [
    "pnpm",
    [
      "exec",
      "prettier",
      "--check",
      "src/**/*.{ts,tsx,css}",
      "scripts/**/*.mjs",
      ".github/**/*.yml",
      "package.json",
      "pnpm-workspace.yaml",
      "eslint.config.js",
      "index.html",
      "tailwind.config.ts",
      "tsconfig.json",
      "tsconfig.node.json",
      "vite.config.ts",
      "src-tauri/tauri.conf.json",
      "src-tauri/capabilities/main.json",
      "security/audit-exceptions.json",
      "docs/release/evidence/0.1.0-rc.1.json",
    ],
  ],
  ["pnpm", ["exec", "eslint", "."]],
  ["pnpm", ["typecheck"]],
  ["pnpm", ["test"]],
  ["pnpm", ["build"]],
  [
    "cargo",
    [
      `+${rustToolchain}`,
      "fmt",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--all",
      "--",
      "--check",
    ],
  ],
  [
    "cargo",
    [
      `+${rustToolchain}`,
      "clippy",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--locked",
      "--offline",
      "--all-targets",
      "--",
      "-D",
      "warnings",
    ],
  ],
  [
    "cargo",
    [
      `+${rustToolchain}`,
      "test",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--locked",
      "--offline",
    ],
  ],
];

for (const [command, argumentsList] of verificationSteps) {
  console.log(`\n> ${command} ${argumentsList.join(" ")}`);
  const commandResult = spawnSync(command, argumentsList, {
    cwd: repositoryRoot,
    env:
      command === "cargo"
        ? { ...process.env, CARGO_NET_OFFLINE: "true" }
        : process.env,
    stdio: "inherit",
  });
  if (commandResult.error) {
    throw commandResult.error;
  }
  if (commandResult.status !== 0) {
    process.exit(commandResult.status ?? 1);
  }
}

console.log("\nAll offline release verification steps passed.");

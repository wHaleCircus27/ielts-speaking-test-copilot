import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriConfig = JSON.parse(
  await readFile(resolve(repositoryRoot, "src-tauri/tauri.conf.json"), "utf8"),
);
const mainCapability = JSON.parse(
  await readFile(
    resolve(repositoryRoot, "src-tauri/capabilities/main.json"),
    "utf8",
  ),
);
const buildScript = await readFile(
  resolve(repositoryRoot, "src-tauri/build.rs"),
  "utf8",
);
const librarySource = await readFile(
  resolve(repositoryRoot, "src-tauri/src/lib.rs"),
  "utf8",
);
const cargoManifest = await readFile(
  resolve(repositoryRoot, "src-tauri/Cargo.toml"),
  "utf8",
);

assertEqual(tauriConfig.version, "../package.json", "Tauri version source");
assertEqual(tauriConfig.app.windows.length, 1, "window count");
assertEqual(tauriConfig.app.windows[0].label, "main", "main window label");
assertEqual(tauriConfig.app.windows[0].minWidth, 960, "minimum window width");
assertEqual(
  tauriConfig.app.security.assetProtocol.enable,
  true,
  "asset protocol enabled",
);
assertArrayEqual(
  tauriConfig.app.security.assetProtocol.scope,
  ["$APPDATA/generated-media/*.wav"],
  "asset protocol scope",
);
assertArrayEqual(
  tauriConfig.app.security.capabilities,
  ["main"],
  "enabled capabilities",
);
assertEqual(
  tauriConfig.app.security.freezePrototype,
  true,
  "prototype freezing",
);
assertEqual(mainCapability.identifier, "main", "capability identifier");
assertArrayEqual(mainCapability.windows, ["main"], "capability window scope");
if (
  "remote" in mainCapability ||
  mainCapability.permissions.includes("core:default")
) {
  throw new Error(
    "The main capability must not grant remote access or core:default.",
  );
}

const expectedConnectSources = [
  "'self'",
  "ipc:",
  "http://ipc.localhost",
  "https://ipc.localhost",
  "asset:",
  "http://asset.localhost",
  "https://asset.localhost",
  "wss://*.stt.speech.microsoft.com",
];
assertTokenSetEqual(
  tauriConfig.app.security.csp["connect-src"],
  expectedConnectSources,
  "production connect-src",
);
assertTokenSetEqual(
  tauriConfig.app.security.csp["media-src"],
  ["'self'", "asset:", "http://asset.localhost", "https://asset.localhost"],
  "production media-src",
);
const serializedProductionCsp = JSON.stringify(tauriConfig.app.security.csp);
if (
  serializedProductionCsp.includes("localhost:1420") ||
  serializedProductionCsp.includes("'unsafe-eval'")
) {
  throw new Error("Production CSP contains a development-only source.");
}
const serializedDevelopmentCsp = JSON.stringify(
  tauriConfig.app.security.devCsp,
);
if (
  !serializedDevelopmentCsp.includes("http://localhost:1420") ||
  !serializedDevelopmentCsp.includes("ws://localhost:1420")
) {
  throw new Error("Development CSP is missing Vite HMR sources.");
}

const buildCommands = extractBuildCommands(buildScript);
const handlerCommands = extractHandlerCommands(librarySource);
const capabilityCommands = mainCapability.permissions
  .filter((permission) => permission.startsWith("allow-"))
  .map((permission) => permission.slice("allow-".length).replaceAll("-", "_"));
assertArrayEqual(
  handlerCommands.toSorted(),
  buildCommands.toSorted(),
  "Tauri handler/build command set",
);
assertArrayEqual(
  capabilityCommands.toSorted(),
  buildCommands.toSorted(),
  "Tauri capability/build command set",
);

assertArrayEqual(tauriConfig.bundle.targets, ["app"], "bundle targets");
assertEqual(
  tauriConfig.bundle.macOS.minimumSystemVersion,
  "15.0",
  "minimum macOS version",
);
assertEqual(
  tauriConfig.bundle.macOS.signingIdentity,
  "-",
  "ad-hoc signing identity",
);
for (const requiredResource of [
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
]) {
  if (!Object.values(tauriConfig.bundle.resources).includes(requiredResource)) {
    throw new Error(`Bundle resources are missing ${requiredResource}.`);
  }
}
if (!/tauri\s*=\s*\{[^\n]*"protocol-asset"/.test(cargoManifest)) {
  throw new Error(
    "Cargo tauri dependency is missing the protocol-asset feature.",
  );
}
console.log(
  `Verified scoped Tauri config and ${buildCommands.length} explicit commands.`,
);

function extractBuildCommands(source) {
  const commandListMatch = source.match(
    /const COMMANDS:[\s\S]*?=\s*&\[([\s\S]*?)\];/,
  );
  if (!commandListMatch) {
    throw new Error("Unable to locate AppManifest command list in build.rs.");
  }
  return [...commandListMatch[1].matchAll(/"([a-z0-9_]+)"/g)].map(
    (match) => match[1],
  );
}

function extractHandlerCommands(source) {
  const handlerMatch = source.match(/generate_handler!\[([\s\S]*?)\]\)/);
  if (!handlerMatch) {
    throw new Error(
      "Unable to locate generate_handler command list in lib.rs.",
    );
  }
  return handlerMatch[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split("::").at(-1));
}

function assertEqual(actualValue, expectedValue, label) {
  if (actualValue !== expectedValue) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expectedValue)}, received ${JSON.stringify(actualValue)}.`,
    );
  }
}

function assertArrayEqual(actualValues, expectedValues, label) {
  if (JSON.stringify(actualValues) !== JSON.stringify(expectedValues)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expectedValues)}, received ${JSON.stringify(actualValues)}.`,
    );
  }
}

function assertTokenSetEqual(actualValue, expectedTokens, label) {
  assertArrayEqual(
    actualValue.split(/\s+/).filter(Boolean).toSorted(),
    expectedTokens.toSorted(),
    label,
  );
}

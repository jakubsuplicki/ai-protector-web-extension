#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE_INFRA = path.join(ROOT, "engine", "infra");
const EXTENSION_DIR = path.join(ROOT, "extension");
const CHROME_EXTENSION_DIR = path.join(EXTENSION_DIR, "dist", "chrome-mv3");
const ENGINE_URL = process.env.AI_PROTECTOR_ENGINE_URL ?? "http://localhost:8000";

process.on("uncaughtException", handleFatal);
process.on("unhandledRejection", handleFatal);

const BROWSERS = new Set(["auto", "chrome", "brave", "edge"]);
const firstArg = normalizeArg(process.argv[2] ?? "setup");
const secondArg = normalizeArg(process.argv[3] ?? "auto");
const mode =
  firstArg === "manual" || firstArg === "setup"
    ? "setup"
    : firstArg === "engine"
      ? "engine"
      : BROWSERS.has(firstArg)
        ? "setup"
        : "unknown";
const browserArg =
  mode === "setup" && BROWSERS.has(firstArg)
    ? firstArg
    : secondArg;

if (firstArg === "help" || firstArg === "--help" || firstArg === "-h") {
  printUsage();
  process.exit(0);
}

if (mode === "engine") {
  await startEngine();
  await waitForEngine();
  console.log(`Engine ready: ${ENGINE_URL}`);
  process.exit(0);
}

if (mode === "unknown") {
  console.error(`Unknown command: ${firstArg}`);
  printUsage();
  process.exit(2);
}

if (!BROWSERS.has(browserArg)) {
  console.error(`Unknown browser: ${browserArg}`);
  printUsage();
  process.exit(2);
}

await startEngine();
await waitForEngine();
await ensureExtensionDeps();
await prepareProfileInstall(browserArg);

function normalizeArg(value) {
  return value.toLowerCase().replace(/^--/, "");
}

function handleFatal(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exit(1);
}

function printUsage() {
  console.log(`AI Protector self-hosted setup runner

Usage:
  bun run setup            Start engine, build extension, open browser extensions page
  bun run setup:brave      Set up the extension in your normal Brave profile
  bun run setup:chrome     Set up the extension in your normal Chrome profile
  bun run setup:edge       Set up the extension in your normal Edge profile
  bun run engine           Start only the self-hosted engine

Environment:
  CHROME_PATH              Override the Chromium-family browser executable
  AI_PROTECTOR_NODE        Override the Node.js executable used for extension builds
  AI_PROTECTOR_ENGINE_URL  Engine URL, default http://localhost:8000
  AI_PROTECTOR_NO_OPEN     Set to 1 to skip opening the browser extensions page
`);
}

async function startEngine() {
  console.log("Starting self-hosted engine...");
  await run("docker", ["compose", "--profile", "self-hosted", "up", "--build", "-d"], {
    cwd: ENGINE_INFRA,
    env: { ...process.env, APP_MODE: "self-hosted" },
  });
}

async function waitForEngine(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${ENGINE_URL}/health`);
      const body = await res.json();
      if (res.ok && body.status === "ok") {
        const mode = body.mode ? ` (${body.mode})` : "";
        console.log(`Engine health ok${mode}: ${ENGINE_URL}/health`);
        return;
      }
      lastError = `health returned ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(1_000);
  }

  throw new Error(`Engine did not become healthy within ${timeoutMs / 1000}s: ${lastError}`);
}

async function ensureExtensionDeps() {
  if (existsSync(path.join(EXTENSION_DIR, "node_modules"))) return;

  console.log("Installing extension dependencies...");
  await run(bunExecutable(), ["install"], { cwd: EXTENSION_DIR });
}

async function prepareProfileInstall(browser) {
  const resolved = resolveBrowser(browser);
  console.log("Building unpacked extension...");
  await run(bunExecutable(), ["run", "build"], {
    cwd: EXTENSION_DIR,
    env: extensionBuildEnv(),
  });

  console.log("");
  console.log("Unpacked extension path:");
  console.log(`  ${CHROME_EXTENSION_DIR}`);
  console.log("");
  console.log(`In ${displayName(resolved.browser)}:`);
  console.log("  1. Enable Developer mode");
  console.log("  2. Click Load unpacked");
  console.log("  3. Select the folder above");
  console.log("  4. Open ChatGPT or Claude and test with a fake sensitive value");

  if (process.env.AI_PROTECTOR_NO_OPEN === "1") return;

  openExtensionsPage(resolved.browser, resolved.path);
}

function resolveBrowser(browser) {
  if (browser === "auto") {
    for (const candidate of ["brave", "chrome", "edge"]) {
      const resolved = tryResolveBrowser(candidate);
      if (resolved) return resolved;
    }
    console.error("Could not find Brave, Chrome, or Edge in common locations.");
    console.error("Set CHROME_PATH to a browser executable and rerun the command.");
    process.exit(1);
  }

  const resolved = tryResolveBrowser(browser);
  if (resolved) return resolved;

  console.error(`Could not find ${displayName(browser)} in common locations.`);
  console.error("Set CHROME_PATH to the browser executable and rerun the command.");
  console.error(`Example: CHROME_PATH="/path/to/${displayName(browser)}" bun run setup:${browser}`);
  process.exit(1);
}

function tryResolveBrowser(browser) {
  if (process.env.CHROME_PATH) {
    return { browser, path: process.env.CHROME_PATH };
  }

  const candidates = browserCandidates(browser);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return { browser, path: found };

  const pathCandidates = browserCommands(browser)
    .map((command) => which(command))
    .filter(Boolean);
  if (pathCandidates[0]) return { browser, path: pathCandidates[0] };

  return undefined;
}

function openExtensionsPage(browser, browserPath) {
  const url = extensionSettingsUrl(browser);
  console.log("");
  console.log(`Opening ${url}...`);

  const child = spawn(browserPath, [url], {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", (error) => {
    console.error(`Could not open ${displayName(browser)}: ${error.message}`);
  });
  child.unref();
}

function browserCandidates(browser) {
  const home = os.homedir();
  if (process.platform === "darwin") {
    const apps = ["/Applications", path.join(home, "Applications")];
    const names = {
      chrome: "Google Chrome.app/Contents/MacOS/Google Chrome",
      brave: "Brave Browser.app/Contents/MacOS/Brave Browser",
      edge: "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    };
    return apps.map((dir) => path.join(dir, names[browser]));
  }

  if (process.platform === "win32") {
    const programFiles = [
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"],
      process.env.LOCALAPPDATA,
    ].filter(Boolean);
    const names = {
      chrome: ["Google", "Chrome", "Application", "chrome.exe"],
      brave: ["BraveSoftware", "Brave-Browser", "Application", "brave.exe"],
      edge: ["Microsoft", "Edge", "Application", "msedge.exe"],
    };
    return programFiles.map((dir) => path.join(dir, ...names[browser]));
  }

  return browserCommands(browser);
}

function browserCommands(browser) {
  const commands = {
    chrome: ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"],
    brave: ["brave-browser", "brave"],
    edge: ["microsoft-edge", "microsoft-edge-stable", "msedge"],
  };
  return commands[browser] ?? [];
}

function displayName(browser) {
  return {
    auto: "default Chromium browser",
    chrome: "Google Chrome",
    brave: "Brave",
    edge: "Microsoft Edge",
  }[browser];
}

function extensionSettingsUrl(browser) {
  return {
    brave: "brave://extensions",
    chrome: "chrome://extensions",
    edge: "edge://extensions",
  }[browser];
}

function extensionBuildEnv() {
  const env = { ...process.env };
  if (env.AI_PROTECTOR_VERBOSE !== "1") {
    delete env.DEBUG;
  }
  const current = nodeMajor("node");
  if (current !== undefined && current >= 22) return env;

  const node22 = findNodeAtLeast(22);
  if (node22) {
    env.PATH = `${path.dirname(node22)}${path.delimiter}${env.PATH ?? ""}`;
    return env;
  }

  throw new Error(
    "Extension build requires Node 22+. Install Node 22+ or set AI_PROTECTOR_NODE to a Node 22+ executable.",
  );
}

function findNodeAtLeast(minMajor) {
  const explicit = process.env.AI_PROTECTOR_NODE;
  if (explicit && nodeMajor(explicit) >= minMajor) return explicit;

  const candidates = [
    ...nvmNodeCandidates(),
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    process.platform === "win32" ? "C:\\Program Files\\nodejs\\node.exe" : "",
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate) && nodeMajor(candidate) >= minMajor);
}

function nvmNodeCandidates() {
  const nvmRoot = path.join(os.homedir(), ".nvm", "versions", "node");
  if (!existsSync(nvmRoot)) return [];
  return readdirSync(nvmRoot)
    .filter((entry) => entry.startsWith("v"))
    .map((entry) => path.join(nvmRoot, entry, "bin", "node"))
    .sort()
    .reverse();
}

function nodeMajor(command) {
  const result = spawnSync(command, ["-v"], { encoding: "utf8" });
  if (result.status !== 0) return undefined;
  const match = result.stdout.trim().match(/^v(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function which(command) {
  const lookup = process.platform === "win32" ? "where" : "command";
  const args = process.platform === "win32" ? [command] : ["-v", command];
  const result = spawnSync(lookup, args, { encoding: "utf8", shell: process.platform !== "win32" });
  if (result.status !== 0) return undefined;
  return result.stdout.trim().split(/\r?\n/)[0];
}

function bunExecutable() {
  return process.versions.bun ? process.execPath : "bun";
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function usage() {
  console.log(`Usage:
  node scripts/web-release-smoke.mjs --binary /abs/path/to/cli-memory-web
  node scripts/web-release-smoke.mjs --url http://127.0.0.1:17666

Options:
  --binary <path>       Start and test a release binary
  --url <url>           Test an already-running web runtime
  --host <host>         Access host for smoke test when starting a binary
  --port <port>         Fixed port when starting a binary
  --timeout-secs <sec>  Startup/render timeout, default 60
  --keep-temp           Keep screenshots/logs/temp home even on success
`);
}

function parseArgs(argv) {
  const options = {
    binary: "",
    host: "127.0.0.1",
    keepTemp: false,
    port: 0,
    timeoutSecs: 60,
    url: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    switch (current) {
      case "--help":
      case "-h":
        usage();
        process.exit(0);
        break;
      case "--binary":
        index += 1;
        options.binary = argv[index] ?? "";
        break;
      case "--host":
        index += 1;
        options.host = argv[index] ?? "";
        break;
      case "--port":
        index += 1;
        options.port = Number(argv[index] ?? 0);
        break;
      case "--timeout-secs":
        index += 1;
        options.timeoutSecs = Number(argv[index] ?? 60);
        break;
      case "--url":
        index += 1;
        options.url = argv[index] ?? "";
        break;
      case "--keep-temp":
        options.keepTemp = true;
        break;
      default:
        fail(`unknown argument: ${current}`);
    }
  }

  if (!options.binary && !options.url) {
    fail("missing --binary or --url");
  }

  if (options.binary && !path.isAbsolute(options.binary)) {
    options.binary = path.resolve(options.binary);
  }

  if (options.binary && !fs.existsSync(options.binary)) {
    fail(`binary not found: ${options.binary}`);
  }

  if (!Number.isFinite(options.timeoutSecs) || options.timeoutSecs <= 0) {
    fail(`invalid --timeout-secs: ${options.timeoutSecs}`);
  }

  if (options.port && (!Number.isInteger(options.port) || options.port <= 0)) {
    fail(`invalid --port: ${options.port}`);
  }

  return options;
}

async function findFreePort(host) {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to resolve free port")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(port);
        }
      });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs, child, logFile) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (child?.exitCode !== null) {
      const logs = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
      throw new Error(
        `release binary exited early with code ${child.exitCode ?? "unknown"}\n${logs}`,
      );
    }

    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    await sleep(500);
  }

  const logs = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
  throw new Error(`timed out waiting for ${url}/health\n${logs}`);
}

function createTempHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cli-memory-web-release-smoke-"));
  const homeDir = path.join(root, "home");
  const appDataDir = path.join(homeDir, "AppData", "Roaming");
  const localAppDataDir = path.join(homeDir, "AppData", "Local");
  fs.mkdirSync(appDataDir, { recursive: true });
  fs.mkdirSync(localAppDataDir, { recursive: true });
  return { appDataDir, homeDir, localAppDataDir, root };
}

function startBinary(binary, port, host, timeoutSecs) {
  const temp = createTempHome();
  const logFile = path.join(temp.root, "server.log");
  const logStream = fs.createWriteStream(logFile, { flags: "a" });

  const env = {
    ...process.env,
    APPDATA: temp.appDataDir,
    CLI_MEMORY_AUTO_PORT: "false",
    CLI_MEMORY_PORT: String(port),
    HOME: temp.homeDir,
    LOCALAPPDATA: temp.localAppDataDir,
    USERPROFILE: temp.homeDir,
  };

  if (host) {
    env.CLI_MEMORY_HOST = host;
  }

  if (timeoutSecs) {
    env.CLI_MEMORY_START_TIMEOUT = String(timeoutSecs);
  }

  const child = spawn(binary, [], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  return { child, logFile, logStream, temp };
}

async function smokePage(url, timeoutMs, tempRoot) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message}\nInstall browser runtime with: npx playwright install chromium`,
    );
  }

  const page = await browser.newPage();
  const consoleEvents = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on("console", (msg) => {
    consoleEvents.push({ level: msg.type(), text: msg.text() });
  });
  page.on("pageerror", (error) => {
    pageErrors.push({
      message: error.message,
      stack: error.stack ?? "",
    });
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure();
    failedRequests.push({
      error: failure?.errorText ?? "",
      url: request.url(),
    });
  });

  const screenshotPath = path.join(tempRoot, "release-smoke.png");

  try {
    await page.goto(url, { timeout: timeoutMs, waitUntil: "networkidle" });
    await page.waitForFunction(
      () => {
        const root = document.getElementById("root");
        return Boolean(root && root.innerHTML.trim().length > 0);
      },
      { timeout: timeoutMs },
    );
    await page.screenshot({ fullPage: true, path: screenshotPath });

    const bodyText = await page.locator("body").innerText().catch(() => "");
    const rootLength = await page
      .locator("#root")
      .evaluate((node) => node.innerHTML.trim().length)
      .catch(() => 0);

    const ignoredPrefixes = [
      `${url}/favicon.ico`,
    ];
    const importantFailedRequests = failedRequests.filter(
      ({ url: requestUrl }) =>
        !ignoredPrefixes.some((prefix) => requestUrl.startsWith(prefix)),
    );

    if (pageErrors.length > 0) {
      throw new Error(
        `frontend runtime error:\n${JSON.stringify(pageErrors, null, 2)}`,
      );
    }

    if (importantFailedRequests.length > 0) {
      throw new Error(
        `frontend request failures:\n${JSON.stringify(importantFailedRequests, null, 2)}`,
      );
    }

    if (!rootLength) {
      throw new Error("frontend root did not render");
    }

    console.log(
      JSON.stringify(
        {
          bodyPreview: bodyText.slice(0, 300),
          rootLength,
          screenshotPath,
          url,
        },
        null,
        2,
      ),
    );
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const timeoutMs = options.timeoutSecs * 1000;
  let startedBinary = null;
  let tempRoot = null;
  let url = options.url;

  try {
    if (options.binary) {
      const port = options.port || (await findFreePort(options.host));
      startedBinary = startBinary(
        options.binary,
        port,
        "",
        options.timeoutSecs,
      );
      tempRoot = startedBinary.temp.root;
      url = `http://${options.host}:${port}`;
      await waitForHttp(url, timeoutMs, startedBinary.child, startedBinary.logFile);
    } else {
      tempRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "cli-memory-web-release-smoke-url-"),
      );
    }

    await smokePage(url, timeoutMs, tempRoot);
    console.log("✅ Web release smoke check passed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Web release smoke check failed\n${message}`);

    if (startedBinary?.logFile && fs.existsSync(startedBinary.logFile)) {
      console.error("\n--- server log ---");
      console.error(fs.readFileSync(startedBinary.logFile, "utf8"));
    }

    if (tempRoot) {
      console.error(`\nArtifacts kept at: ${tempRoot}`);
    }

    process.exitCode = 1;
  } finally {
    if (startedBinary) {
      startedBinary.logStream.end();
      if (startedBinary.child.exitCode === null) {
        startedBinary.child.kill("SIGTERM");
        await sleep(1000);
      }
      if (startedBinary.child.exitCode === null) {
        startedBinary.child.kill("SIGKILL");
      }
    }

    if (!process.exitCode && tempRoot && !options.keepTemp) {
      fs.rmSync(tempRoot, { force: true, recursive: true });
    }
  }
}

await main();

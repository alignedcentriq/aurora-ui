import { execFile, execFileSync, spawn } from "child_process";
import net from "net";
import os from "os";
import path from "path";

const isWindows = os.platform() === "win32";
const repoRoot = process.cwd();
const infraComposeFile = "docker-compose.infra.yml";
const processes = [];
let shuttingDown = false;

// 5 minutes — enough for Docker cold-start + venv install + DB init + uvicorn boot
const BACKEND_READY_TIMEOUT_MS = 300_000;

const waitForPort = (port, host = "127.0.0.1", timeout = BACKEND_READY_TIMEOUT_MS) => {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const check = () => {
      if (Date.now() - start > timeout) {
        reject(new Error(`Timeout waiting for ${host}:${port}`));
        return;
      }

      const socket = new net.Socket();
      socket.setTimeout(1000);
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        setTimeout(check, 1000);
      });
      socket.once("timeout", () => {
        socket.destroy();
        setTimeout(check, 1000);
      });
      socket.connect(port, host);
    };

    check();
  });
};

const spawnProcess = (name, args) => {
  const child = isWindows
    ? spawn("npm", args, { cwd: process.cwd(), env: process.env, shell: true, stdio: "inherit" })
    : spawn("npm", args, { cwd: process.cwd(), env: process.env, shell: false, stdio: "inherit" });
  processes.push(child);
  return child;
};

// Frontend: if it crashes, stop everything (unexpected).
const startFrontend = (args) => {
  const name = "frontend";
  console.log(`Starting ${name}: npm ${args.join(" ")}`);
  const child = spawnProcess(name, args);
  child.on("error", (err) => {
    console.error(`[${name}] failed to start: ${err.message}`);
    stopAll(1);
  });
  child.on("exit", (code) => {
    if (!shuttingDown && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      stopAll(code ?? 1);
    }
  });
};

// Backend: auto-restart on crash so a Python error doesn't bring down the frontend.
const startBackend = (args) => {
  const name = "backend";
  const launch = () => {
    if (shuttingDown) return;
    console.log(`Starting ${name}: npm ${args.join(" ")}`);
    const child = spawnProcess(name, args);
    child.on("error", (err) => {
      if (shuttingDown) return;
      console.error(`[${name}] failed to start: ${err.message}`);
      console.log(`[${name}] will retry in 5s...`);
      setTimeout(launch, 5000);
    });
    child.on("exit", (code) => {
      if (shuttingDown) return;
      if (code !== 0 && code !== null) {
        console.error(`[${name}] exited with code ${code} — restarting in 5s...`);
        setTimeout(launch, 5000);
      }
    });
  };
  launch();
};

const windowsPathToWslPath = (windowsPath) => {
  const parsed = path.win32.parse(windowsPath);
  const drive = parsed.root[0].toLowerCase();
  const relativePath = path.win32
    .relative(parsed.root, windowsPath)
    .split(path.win32.sep)
    .filter(Boolean)
    .join("/");
  return `/mnt/${drive}/${relativePath}`;
};

const shutdownDockerInfra = () => {
  if (!isWindows || process.env.SKIP_DOCKER === "true") return;
  console.log("\n--- Stopping Docker infrastructure ---");
  try {
    const wslPath = windowsPathToWslPath(repoRoot);
    execFileSync(
      "wsl",
      ["--cd", wslPath, "docker", "compose", "-f", infraComposeFile, "down"],
      { stdio: "inherit", timeout: 5_000 }
    );
    console.log("--- Docker infrastructure stopped ---");
  } catch (err) {
    console.warn("Could not stop Docker infrastructure:", err.message);
  }
};

const stopAll = (exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;

  // Kill child Node processes (backend uvicorn + vite frontend)
  for (const child of processes) {
    if (!child.killed) {
      if (isWindows && child.pid) {
        execFile("taskkill", ["/pid", String(child.pid), "/t", "/f"], () => {});
      } else {
        child.kill();
      }
    }
  }

  // Synchronously bring down Docker — we wait here intentionally
  shutdownDockerInfra();
  process.exit(exitCode);
};

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

const main = async () => {
  startBackend(["run", "dev:backend"]);
  console.log(
    "Waiting for backend on http://127.0.0.1:8080 " +
    "(may take up to 5 min on first run while Docker starts and deps install)..."
  );
  await waitForPort(8080);
  startFrontend(["run", "dev"]);
};

main().catch((err) => {
  console.error(`Startup failed: ${err.message}`);
  stopAll(1);
});

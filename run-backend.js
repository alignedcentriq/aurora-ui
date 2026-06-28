import { execFileSync, spawn } from "child_process";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";

const spawnedChildren = [];

/** On Windows: kill any process currently listening on the given port. */
const freePort = (port) => {
  if (os.platform() !== "win32") return;
  try {
    const out = execFileSync("netstat", ["-ano"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const pids = new Set();
    for (const line of out.split("\n")) {
      const m = line.match(/[:\s](\d+)\s+\S+\s+LISTENING\s+(\d+)/);
      if (m && parseInt(m[1], 10) === port) pids.add(m[2]);
    }
    for (const pid of pids) {
      try {
        execFileSync("taskkill", ["/PID", pid, "/F"], { stdio: "ignore" });
        console.log(`Freed port ${port} (killed PID ${pid})`);
      } catch {
        /* already dead */
      }
    }
  } catch {
    /* netstat unavailable */
  }
};

const repoRoot = process.cwd();
const backendDir = path.join(repoRoot, "backend");
const platform = os.platform();
const isWindows = platform === "win32";
const infraComposeFile = "docker-compose.infra.yml";
const localInfraHost = "127.0.0.1";
let wslKeepAliveProcess = null;

const infraPorts = [
  { name: "Postgres", port: 5433, required: true },
  { name: "Redis", port: 6380, required: true },
  { name: "Langfuse", port: 3003, required: false },
];

console.log(`Detected OS: ${platform}${isWindows ? " (Windows)" : ""}...`);

const isPortOpen = (port, host = "127.0.0.1") => {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
};

const waitForPort = (port, host = "127.0.0.1", timeout = 30000) => {
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

const runCommand = (command, args, options = {}) => {
  return new Promise((resolve, reject) => {
    console.log(`Executing: ${command} ${args.join(" ")}`);
    const child = spawn(command, args, {
      cwd: backendDir,
      stdio: "inherit",
      shell: false,
      ...options,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}: ${command} ${args.join(" ")}`));
      }
    });
    child.on("error", reject);
  });
};

const commandExists = (command, args = ["--version"]) => {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const windowsPathToWslPath = (windowsPath) => {
  const parsed = path.win32.parse(windowsPath);
  if (!parsed.root || !parsed.root.includes(":")) {
    throw new Error(`Cannot convert Windows path to WSL path: ${windowsPath}`);
  }

  const drive = parsed.root[0].toLowerCase();
  const relativePath = path.win32
    .relative(parsed.root, windowsPath)
    .split(path.win32.sep)
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");

  return `/mnt/${drive}/${relativePath}`;
};

const getWslRepoRoot = () => {
  const wslRepoRoot = windowsPathToWslPath(repoRoot);

  try {
    execFileSync("wsl", ["test", "-d", wslRepoRoot], { stdio: "ignore" });
    return wslRepoRoot;
  } catch (err) {
    throw new Error(
      [
        "WSL is required for Windows local infrastructure startup.",
        "Install/enable WSL, then ensure Docker and Docker Compose are available inside your WSL distro.",
        `Expected WSL repo path: ${wslRepoRoot}`,
        `Original error: ${err.message}`,
      ].join("\n"),
    );
  }
};

const runDockerCompose = async () => {
  console.log("--- Starting local infrastructure containers ---");

  const wslRepoRoot = getWslRepoRoot();

  // Ensure Docker service is running in WSL.
  try {
    console.log("--- Checking if Docker is responsive in WSL ---");
    execFileSync("wsl", ["docker", "ps"], { stdio: "ignore", timeout: 5000 });
    console.log("Docker is already running in WSL.");
  } catch (err) {
    console.log("--- Ensuring Docker service is running in WSL ---");
    try {
      await runCommand("wsl", ["sudo", "service", "docker", "start"], { stdio: "ignore" });
    } catch (sudoErr) {
      console.warn(
        "Failed to start Docker service in WSL via sudo. Assuming it's already running or manual start is needed.",
      );
    }
  }

  const composeArgs = [
    "--cd",
    wslRepoRoot,
    "docker",
    "compose",
    "-f",
    infraComposeFile,
    "up",
    "-d",
  ];

  try {
    await runCommand("wsl", composeArgs, { cwd: repoRoot });
    return;
  } catch (composePluginErr) {
    console.warn("WSL 'docker compose' (V2) exited non-zero:", composePluginErr.message);

    // Before falling back to V1, check if required ports are already up.
    // V2 may exit non-zero (e.g. a non-critical service failing its health check)
    // while the core infrastructure containers are actually running.
    const requiredAfterV2 = infraPorts.filter((p) => p.required);
    const allUpAfterV2 = await Promise.all(
      requiredAfterV2.map((p) => isPortOpen(p.port, localInfraHost)),
    );
    if (allUpAfterV2.every(Boolean)) {
      console.log(
        "--- Required infrastructure ports are open after V2 attempt; skipping V1 fallback ---",
      );
      return;
    }

    console.warn("Required ports not yet open — trying legacy 'docker-compose' (V1)...");
  }

  try {
    await runCommand(
      "wsl",
      ["--cd", wslRepoRoot, "docker-compose", "-f", infraComposeFile, "up", "-d"],
      { cwd: repoRoot },
    );
    return;
  } catch (legacyComposeErr) {
    console.warn("--- WSL Infrastructure Startup Warning ---");
    console.warn("Could not start Docker infrastructure from WSL automatically.");
    console.warn("Reason:", legacyComposeErr.message);
    console.warn(
      "\nIf you are running Redis, Postgres, etc. manually in WSL, the backend will try to use those.",
    );
    console.warn(
      "To fix the Docker error in WSL, try running: sudo apt-get install docker-compose-v2",
    );
    console.warn("-------------------------------------------\n");
    // Let waitForInfrastructure check the published Windows ports.
    return;
  }
};

const startWslKeepAlive = () => {
  if (wslKeepAliveProcess) {
    return;
  }

  wslKeepAliveProcess = spawn("wsl", ["sh", "-lc", "while true; do sleep 3600; done"], {
    cwd: repoRoot,
    stdio: "ignore",
    shell: false,
    windowsHide: true,
  });

  wslKeepAliveProcess.on("exit", () => {
    wslKeepAliveProcess = null;
  });
};

const stopWslKeepAlive = () => {
  if (wslKeepAliveProcess && !wslKeepAliveProcess.killed) {
    wslKeepAliveProcess.kill();
  }
};

const waitForInfrastructure = async () => {
  console.log("--- Waiting for local infrastructure ports ---");
  const host = localInfraHost;
  console.log(`Using host ${host} for infrastructure checks.`);

  for (const service of infraPorts) {
    try {
      await waitForPort(service.port, host, service.required ? 60000 : 30000);
      console.log(`${service.name} is reachable on ${host}:${service.port}`);
    } catch (err) {
      const message = `${service.name} is not reachable on ${host}:${service.port}. ${err.message}`;
      if (service.required) {
        throw new Error(message);
      }
      console.warn(`${message} Continuing; the backend will use fallbacks where available.`);
    }
  }
};

const resolvePython = () => {
  const candidates = ["python"];
  for (const candidate of candidates) {
    if (commandExists(candidate, ["--version"])) {
      return candidate;
    }
  }
  throw new Error("Python was not found. Install Python for Windows and add it to PATH.");
};

const getVenvPaths = () => {
  const venvDir = path.join(backendDir, "venv");
  const binDir = path.join(venvDir, "Scripts");
  return {
    venvDir,
    python: path.join(binDir, "python.exe"),
    uvicorn: path.join(binDir, "uvicorn.exe"),
    depsMarker: path.join(venvDir, ".deps-installed"),
  };
};

const needsDependencySync = ({ venvDir, depsMarker }) => {
  if (!fs.existsSync(venvDir) || !fs.existsSync(depsMarker)) {
    return true;
  }

  const markerTime = fs.statSync(depsMarker).mtimeMs;
  const dependencyFiles = ["requirements.txt", "pyproject.toml"]
    .map((file) => path.join(backendDir, file))
    .filter((file) => fs.existsSync(file));

  return dependencyFiles.some((file) => fs.statSync(file).mtimeMs > markerTime);
};

const syncPythonDependencies = async (pythonCmd, venvPaths) => {
  if (!fs.existsSync(venvPaths.venvDir)) {
    console.log("--- Creating Python virtual environment ---");
    await runCommand(pythonCmd, ["-m", "venv", "venv"]);
  }

  if (!fs.existsSync(venvPaths.python)) {
    throw new Error(
      [
        `The existing backend/venv does not contain the expected Python executable for ${platform}.`,
        `Expected: ${venvPaths.python}`,
        "Remove backend/venv and rerun npm start to recreate it for this OS.",
      ].join("\n"),
    );
  }

  if (!needsDependencySync(venvPaths)) {
    console.log("--- Python dependencies are already in sync ---");
    return;
  }

  console.log("--- Syncing Python dependencies ---");
  if (fs.existsSync(path.join(backendDir, "requirements.txt"))) {
    await runCommand(venvPaths.python, ["-m", "pip", "install", "-r", "requirements.txt"]);
  }
  if (fs.existsSync(path.join(backendDir, "pyproject.toml"))) {
    await runCommand(venvPaths.python, ["-m", "pip", "install", "-e", "."]);
  }
  fs.writeFileSync(venvPaths.depsMarker, new Date().toISOString());
};

let uvicornShuttingDown = false;

const runUvicornWithRestart = async (uvicornPath) => {
  const args = ["app.main:app", "--host", "0.0.0.0", "--port", "8080"];
  const env = { ...process.env, LANGFUSE_OTEL: "false" };

  while (!uvicornShuttingDown) {
    try {
      await runCommand(uvicornPath, args, { env });
      // Clean exit (code 0) — don't restart.
      break;
    } catch (err) {
      if (uvicornShuttingDown) break;
      console.error("--- Backend process crashed ---");
      console.error(err.message);
      console.log("--- Restarting uvicorn in 2s (infra already running) ---");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
};

/**
 * Start a mock uvicorn server in the background (fire-and-forget with auto-restart).
 * Used for mock_zoho_server (8090) and mock_manage_engine_server (8091).
 */
const startMockServer = (uvicornPath, appModule, port, label) => {
  const args = [appModule, "--host", "0.0.0.0", "--port", String(port)];
  const env = { ...process.env, LANGFUSE_OTEL: "false" };

  const launch = () => {
    if (uvicornShuttingDown) return;
    freePort(port);
    console.log(`--- Starting ${label} on port ${port} ---`);
    const child = spawn(uvicornPath, args, {
      cwd: backendDir,
      env,
      stdio: "inherit",
      shell: false,
    });
    spawnedChildren.push(child);
    child.on("error", (err) => {
      const idx = spawnedChildren.indexOf(child);
      if (idx !== -1) spawnedChildren.splice(idx, 1);
      if (uvicornShuttingDown) return;
      console.error(`[${label}] failed to start: ${err.message} — retrying in 5s`);
      setTimeout(launch, 5000);
    });
    child.on("exit", (code) => {
      const idx = spawnedChildren.indexOf(child);
      if (idx !== -1) spawnedChildren.splice(idx, 1);
      if (uvicornShuttingDown) return;
      if (code !== 0 && code !== null) {
        console.error(`[${label}] exited with code ${code} — restarting in 5s`);
        setTimeout(launch, 5000);
      }
    });
  };

  launch();
};

const startBackend = async () => {
  if (!isWindows) {
    throw new Error(
      `This local startup script is configured for Windows + WSL Docker only. Detected: ${platform}`,
    );
  }

  if (process.env.SKIP_DOCKER === "true") {
    console.log("--- SKIP_DOCKER is set; skipping infrastructure startup ---");
  } else {
    startWslKeepAlive();

    // Check if required ports are already open before trying to start Docker
    const requiredPorts = infraPorts.filter((p) => p.required);
    let allRequiredOpen = true;
    for (const p of requiredPorts) {
      if (!(await isPortOpen(p.port, localInfraHost))) {
        allRequiredOpen = false;
        break;
      }
    }

    if (allRequiredOpen && requiredPorts.length > 0) {
      console.log(
        "--- All required infrastructure ports are already open. Skipping Docker startup ---",
      );
    } else {
      await runDockerCompose();
    }
  }

  await waitForInfrastructure();

  const pythonCmd = resolvePython();
  const venvPaths = getVenvPaths();
  await syncPythonDependencies(pythonCmd, venvPaths);

  console.log("--- Ensuring database is ready ---");
  await runCommand(venvPaths.python, ["create_db.py"]);
  await runCommand(venvPaths.python, ["init_db_script.py"]);

  // Start mock servers in background (non-blocking, auto-restart)
  startMockServer(venvPaths.uvicorn, "mock_zoho_server:app", 8090, "Mock Zoho");
  startMockServer(venvPaths.uvicorn, "mock_manage_engine_server:app", 8091, "Mock ManageEngine");
  startMockServer(venvPaths.uvicorn, "mock_nexus_library_server:app", 8092, "Mock Nexus Library");

  freePort(8080);
  console.log("--- Starting backend on http://localhost:8080 ---");
  await runUvicornWithRestart(venvPaths.uvicorn);
};

startBackend().catch((err) => {
  console.error("Backend startup failed:");
  console.error(err.message);
  stopWslKeepAlive();
  process.exit(1);
});

const shutdownAll = () => {
  uvicornShuttingDown = true;
  for (const child of spawnedChildren) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
  stopWslKeepAlive();
  process.exit(0);
};

process.on("SIGINT", shutdownAll);
process.on("SIGTERM", shutdownAll);

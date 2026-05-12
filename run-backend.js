import { execFileSync, spawn } from "child_process";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";

const repoRoot = process.cwd();
const backendDir = path.join(repoRoot, "backend");
const platform = os.platform();
const isWindows = platform === "win32";
const isMac = platform === "darwin";
const isLinux = platform === "linux";
const infraComposeFile = "docker-compose.infra.yml";

const infraPorts = [
  { name: "Postgres", port: 5433, required: true },
  { name: "Redis", port: 6380, required: true },
  { name: "MinIO API", port: 9000, required: false },
  { name: "Loki", port: 3100, required: false },
  { name: "Grafana", port: 3001, required: false },
  { name: "Langfuse", port: 3002, required: false },
];

console.log(`Detected OS: ${platform}${isMac ? " (macOS)" : ""}${isLinux ? " (Linux)" : ""}...`);

const isPortOpen = (port, host = "localhost") => {
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

const waitForPort = (port, host = "localhost", timeout = 30000) => {
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
      ].join("\n")
    );
  }
};

const runDockerCompose = async () => {
  console.log("--- Starting local infrastructure containers ---");

  if (isWindows) {
    const wslRepoRoot = getWslRepoRoot();

    // Ensure Docker service is running in WSL
    try {
      console.log("--- Ensuring Docker service is running in WSL ---");
      await runCommand("wsl", ["sudo", "service", "docker", "start"], { stdio: "ignore" });
    } catch (err) {
      console.warn("Failed to start Docker service in WSL via sudo. Assuming it's already running or manual start is needed.");
    }

    const composeArgs = ["--cd", wslRepoRoot, "docker", "compose", "-f", infraComposeFile, "up", "-d"];

    try {
      await runCommand("wsl", composeArgs, { cwd: repoRoot });
      return;
    } catch (composePluginErr) {
      console.warn("WSL 'docker compose' (V2) failed. Trying legacy 'docker-compose' (V1)...");
    }

    try {
      await runCommand(
        "wsl",
        ["--cd", wslRepoRoot, "docker-compose", "-f", infraComposeFile, "up", "-d"],
        { cwd: repoRoot }
      );
      return;
    } catch (legacyComposeErr) {
      console.warn("--- WSL Infrastructure Startup Warning ---");
      console.warn("Could not start Docker infrastructure from WSL automatically.");
      console.warn("Reason:", legacyComposeErr.message);
      console.warn("\nIf you are running Redis, Postgres, etc. manually in WSL or Kubernetes, the backend will try to use those.");
      console.warn("To fix the Docker error in WSL, try running: sudo apt-get install docker-compose-v2");
      console.warn("-------------------------------------------\n");
      // We don't throw here anymore; we'll let waitForInfrastructure check the ports.
      return;
    }
  }

  if (!commandExists("docker")) {
    throw new Error(
      "Docker CLI is not available. On macOS, start Docker Desktop before running npm start."
    );
  }

  try {
    await runCommand("docker", ["compose", "-f", infraComposeFile, "up", "-d"], { cwd: repoRoot });
    return;
  } catch (composePluginErr) {
    console.warn("Docker Compose plugin failed; trying legacy docker-compose...");
  }

  if (commandExists("docker-compose")) {
    try {
      await runCommand("docker-compose", ["-f", infraComposeFile, "up", "-d"], { cwd: repoRoot });
      return;
    } catch (err) {
      console.warn("Legacy docker-compose failed:", err.message);
    }
  }

  console.warn("Could not start Docker infrastructure automatically. Will check if ports are already open...");
};

const waitForInfrastructure = async () => {
  console.log("--- Waiting for local infrastructure ports ---");

  for (const service of infraPorts) {
    try {
      await waitForPort(service.port, "localhost", service.required ? 60000 : 30000);
      console.log(`${service.name} is reachable on localhost:${service.port}`);
    } catch (err) {
      const message = `${service.name} is not reachable on localhost:${service.port}. ${err.message}`;
      if (service.required) {
        throw new Error(message);
      }
      console.warn(`${message} Continuing; the backend will use fallbacks where available.`);
    }
  }
};

const resolvePython = () => {
  const candidates = isWindows ? ["python"] : ["python3", "python"];
  for (const candidate of candidates) {
    if (commandExists(candidate, ["--version"])) {
      return candidate;
    }
  }
  throw new Error(`Python was not found. Install ${isWindows ? "python" : "python3"} and add it to PATH.`);
};

const getVenvPaths = () => {
  const venvDir = path.join(backendDir, "venv");
  const binDir = path.join(venvDir, isWindows ? "Scripts" : "bin");
  return {
    venvDir,
    python: path.join(binDir, isWindows ? "python.exe" : "python"),
    uvicorn: path.join(binDir, isWindows ? "uvicorn.exe" : "uvicorn"),
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
      ].join("\n")
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

const startBackend = async () => {
  if (!isWindows && !isMac && !isLinux) {
    throw new Error(`Unsupported OS for npm start backend orchestration: ${platform}`);
  }

  if (process.env.SKIP_DOCKER === "true") {
    console.log("--- SKIP_DOCKER is set; skipping infrastructure startup ---");
  } else {
    // Check if required ports are already open before trying to start Docker
    const requiredPorts = infraPorts.filter(p => p.required);
    let allRequiredOpen = true;
    for (const p of requiredPorts) {
      if (!(await isPortOpen(p.port))) {
        allRequiredOpen = false;
        break;
      }
    }

    if (allRequiredOpen && requiredPorts.length > 0) {
      console.log("--- All required infrastructure ports are already open. Skipping Docker startup ---");
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

  console.log("--- Starting backend on http://localhost:8080 ---");
  await runCommand(
    venvPaths.uvicorn,
    ["app.main:app", "--host", "0.0.0.0", "--port", "8080", "--reload", "--reload-dir", "app"],
    {
      env: {
        ...process.env,
        LANGFUSE_OTEL: "false",
      },
    }
  );
};

startBackend().catch((err) => {
  console.error("Backend startup failed:");
  console.error(err.message);
  process.exit(1);
});

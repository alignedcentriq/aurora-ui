import { execFile, spawn } from "child_process";
import net from "net";
import os from "os";

const isWindows = os.platform() === "win32";
const processes = [];
let shuttingDown = false;

const waitForPort = (port, host = "127.0.0.1", timeout = 120000) => {
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

const start = (name, args) => {
  console.log(`Starting ${name}: npm ${args.join(" ")}`);
  const child = isWindows
    ? spawn("npm", args, {
        cwd: process.cwd(),
        env: process.env,
        shell: true,
        stdio: "inherit",
      })
    : spawn("npm", args, {
        cwd: process.cwd(),
        env: process.env,
        shell: false,
        stdio: "inherit",
      });

  processes.push(child);
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

const stopAll = (exitCode = 0) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of processes) {
    if (!child.killed) {
      if (isWindows && child.pid) {
        execFile("taskkill", ["/pid", String(child.pid), "/t", "/f"], () => {});
      } else {
        child.kill();
      }
    }
  }
  setTimeout(() => process.exit(exitCode), 250);
};

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

const main = async () => {
  start("backend", ["run", "dev:backend"]);
  console.log("Waiting for backend on http://127.0.0.1:8080 before starting frontend...");
  await waitForPort(8080);
  start("frontend", ["run", "dev"]);
};

main().catch((err) => {
  console.error(`Startup failed: ${err.message}`);
  stopAll(1);
});

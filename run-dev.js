import { spawn } from "child_process";
import os from "os";

const isWindows = os.platform() === "win32";
const processes = [];
let shuttingDown = false;

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
      child.kill();
    }
  }
  setTimeout(() => process.exit(exitCode), 250);
};

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

start("frontend", ["run", "dev"]);
start("backend", ["run", "dev:backend"]);

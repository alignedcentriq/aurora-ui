import { spawn } from 'child_process';
import os from 'os';
import path from 'path';

const isWindows = os.platform() === 'win32';
const backendDir = path.join(process.cwd(), 'backend');

console.log(`🚀 Detected OS: ${os.platform()}...`);

const startBackend = () => {
  let command;
  let args;

  if (isWindows) {
    // Windows: Use PowerShell to run the ps1 script
    command = 'powershell.exe';
    args = ['-ExecutionPolicy', 'Bypass', '-File', './start.ps1'];
  } else {
    // Mac/Linux: Use bash to run the sh script
    command = 'bash';
    args = ['start.sh'];
  }

  console.log(`📂 Starting backend in: ${backendDir}`);
  
  const child = spawn(command, args, {
    cwd: backendDir,
    stdio: 'inherit',
    shell: true
  });

  child.on('error', (err) => {
    console.error('❌ Failed to start backend:', err);
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      console.log(`⚠️ Backend process exited with code ${code}`);
    }
  });
};

startBackend();

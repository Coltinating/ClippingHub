// Launcher script that ensures ELECTRON_RUN_AS_NODE is unset
// (VS Code terminals set this, which breaks Electron's API)
const { spawn } = require('child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const proc = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env,
  cwd: __dirname
});

proc.on('close', (code) => process.exit(code || 0));

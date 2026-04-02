/* ═══════════════════════════════════════════════════════════════
   BATCH TESTING IPC — FOR DEVELOPMENT PURPOSES
   Main-process IPC handlers for batch testing.
   Remove this file to fully disable batch testing in main process.
   ═══════════════════════════════════════════════════════════════ */

const { BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let batchProgressWindow = null;

function registerBatchIPC(debugLog) {
  // Open the batch progress window
  ipcMain.handle('open-batch-progress', () => {
    if (batchProgressWindow && !batchProgressWindow.isDestroyed()) {
      batchProgressWindow.focus();
      return { opened: true };
    }

    batchProgressWindow = new BrowserWindow({
      width: 600, height: 420,
      minWidth: 400, minHeight: 300,
      backgroundColor: '#0a0a0a',
      title: 'Batch Test Progress — Clipper Hub (DEV)',
      webPreferences: {
        preload: path.join(__dirname, '..', '..', 'preload-batch.js'),
        contextIsolation: true,
        nodeIntegration: false,
      }
    });
    batchProgressWindow.setMenuBarVisibility(false);
    batchProgressWindow.loadFile(path.join(__dirname, 'batch-progress.html'));
    batchProgressWindow.on('closed', () => { batchProgressWindow = null; });

    debugLog('SESSION', 'Batch progress window opened');
    return { opened: true };
  });

  // Send progress update to batch window
  ipcMain.on('batch-progress-update', (_, data) => {
    if (batchProgressWindow && !batchProgressWindow.isDestroyed()) {
      batchProgressWindow.webContents.send('batch-update', data);
    }
  });

  // Close batch progress window
  ipcMain.handle('close-batch-progress', () => {
    if (batchProgressWindow && !batchProgressWindow.isDestroyed()) {
      batchProgressWindow.close();
    }
    batchProgressWindow = null;
  });

  // Open batch output folder
  ipcMain.handle('open-batch-folder', (_, folderPath) => {
    if (fs.existsSync(folderPath)) {
      shell.openPath(folderPath);
    }
  });
}

module.exports = { registerBatchIPC };

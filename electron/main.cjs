const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

const isDev = process.env.NODE_ENV !== 'production';
let viteProcess;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    }
  });

  if (isDev) {
    win.loadURL('http://localhost:3000');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Open external links in default browser
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  if (isDev) {
    viteProcess = spawn('npm', ['run', 'vite:dev'], {
      shell: true, // Use shell to find npm.cmd on Windows
      stdio: 'pipe'
    });

    let windowCreated = false;
    let errorOutput = '';
    viteProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.error(`vite_error: ${data}`);
    });

    viteProcess.on('exit', (code) => {
      if (code !== 0 && !windowCreated) {
        const { dialog } = require('electron');
        dialog.showErrorBox(
          'Vite Development Server Failed',
          `The Vite server exited with code ${code}.\n\nError:\n${errorOutput}`
        );
        app.quit();
      }
    });
    
    viteProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log(`vite: ${output}`);
      }
      // Look for Vite's "ready" message
      if (output.includes('ready in') && !windowCreated) {
        createWindow();
        windowCreated = true;
      }
    });

    viteProcess.stderr.on('data', (data) => {
      console.error(`vite_error: ${data}`);
    });
  } else {
    createWindow();
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    if (viteProcess) {
      viteProcess.kill();
    }
    app.quit();
  }
});

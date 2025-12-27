/**
 * VOCAL_PRIME - Electron Main Process
 * Professional voice analysis for audio mastering
 */

import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { join } from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { config as dotenvConfig } from 'dotenv';

// AppImage sandbox workaround
if (process.env.APPIMAGE || process.platform === 'linux') {
  process.argv.push('--no-sandbox');
}

// ============================================================================
// IPC Channel Registry (domain:action pattern)
// ============================================================================
const IPC = {
  // Audio capture
  AUDIO_DEVICES: 'audio:devices',
  AUDIO_START: 'audio:start',
  AUDIO_STOP: 'audio:stop',
  AUDIO_DATA: 'audio:data',

  // File operations
  FILE_IMPORT: 'file:import',
  FILE_EXPORT_REPORT: 'file:export-report',
  FILE_GET_INFO: 'file:get-info',

  // Source separation
  SEPARATION_START: 'separation:start',
  SEPARATION_PROGRESS: 'separation:progress',
  SEPARATION_RESULT: 'separation:result',
  SEPARATION_CANCEL: 'separation:cancel',

  // Pitch detection
  PITCH_ANALYZE: 'pitch:analyze',
  PITCH_RESULT: 'pitch:result',
  PITCH_STREAM: 'pitch:stream',

  // Formant analysis
  FORMANT_ANALYZE: 'formant:analyze',
  FORMANT_RESULT: 'formant:result',
  FORMANT_STREAM: 'formant:stream',

  // Voice quality
  QUALITY_ANALYZE: 'quality:analyze',
  QUALITY_RESULT: 'quality:result',

  // Vibrato analysis
  VIBRATO_ANALYZE: 'vibrato:analyze',
  VIBRATO_RESULT: 'vibrato:result',

  // Python process management
  PYTHON_STATUS: 'python:status',
  PYTHON_RESTART: 'python:restart',

  // Window management
  WINDOW_FULLSCREEN: 'window:fullscreen',
  WINDOW_QUIT: 'window:quit',

  // Layout persistence
  LAYOUT_SAVE: 'layout:save',
  LAYOUT_LOAD: 'layout:load',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
} as const;

// ============================================================================
// Environment Configuration
// ============================================================================
const envPaths = [
  { path: join(os.homedir(), '.config', 'vocal-prime', '.env'), name: 'user config' },
  { path: join(__dirname, '../.env'), name: 'development' },
  { path: join(app.getAppPath(), '.env'), name: 'app' },
];

for (const env of envPaths) {
  if (fs.existsSync(env.path)) {
    dotenvConfig({ path: env.path });
    console.log(`Loaded .env from ${env.name}: ${env.path}`);
    break;
  }
}

// ============================================================================
// Global State
// ============================================================================
let mainWindow: BrowserWindow | null = null;
let pythonProcess: ChildProcess | null = null;
let audioProcess: ChildProcess | null = null;

// User data directory
const userDataDir = join(os.homedir(), '.config', 'vocal-prime');
if (!fs.existsSync(userDataDir)) {
  fs.mkdirSync(userDataDir, { recursive: true });
}

// ============================================================================
// Error Handlers
// ============================================================================
process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught Exception:', error.message);
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error('Unhandled Promise Rejection:', reason);
});

// ============================================================================
// Window Creation
// ============================================================================
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      sandbox: false, // Required for AppImage
    },
    show: false,
    title: 'VOCAL_PRIME',
    autoHideMenuBar: true,
  });

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Load the app
  if (process.env.NODE_ENV === 'development' || process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5174');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }

  // External link handling
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopAudioCapture();
    stopPythonProcess();
  });
}

// ============================================================================
// Python Process Management
// ============================================================================
function startPythonProcess(): void {
  if (pythonProcess) {
    console.log('Python process already running');
    return;
  }

  // Use virtual environment Python
  const pythonDir = join(__dirname, '../python');
  const venvPython = join(pythonDir, 'venv', 'bin', 'python');
  const pythonPath = process.env.PYTHON_PATH || (fs.existsSync(venvPython) ? venvPython : 'python3');

  console.log(`Starting Python analysis server with: ${pythonPath}`);

  pythonProcess = spawn(pythonPath, ['-m', 'vocal_prime'], {
    cwd: pythonDir,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      VIRTUAL_ENV: join(pythonDir, 'venv'),
    },
  });

  pythonProcess.stdout?.on('data', (data: Buffer) => {
    const message = data.toString().trim();
    console.log(`[Python] ${message}`);

    // Parse JSON messages from Python
    try {
      const parsed = JSON.parse(message);
      handlePythonMessage(parsed);
    } catch {
      // Not JSON, just log output
    }
  });

  pythonProcess.stderr?.on('data', (data: Buffer) => {
    console.error(`[Python Error] ${data.toString().trim()}`);
  });

  pythonProcess.on('close', (code: number | null) => {
    console.log(`Python process exited with code: ${code}`);
    pythonProcess = null;
  });

  pythonProcess.on('error', (err: Error) => {
    console.error('Failed to start Python process:', err.message);
    pythonProcess = null;
  });
}

function stopPythonProcess(): void {
  if (pythonProcess) {
    pythonProcess.kill('SIGTERM');
    pythonProcess = null;
  }
}

function handlePythonMessage(message: {
  type: string;
  id?: string;
  payload?: unknown;
}): void {
  switch (message.type) {
    case 'separation:progress':
      mainWindow?.webContents.send(IPC.SEPARATION_PROGRESS, message.payload);
      break;
    case 'separation:result':
      mainWindow?.webContents.send(IPC.SEPARATION_RESULT, message.payload);
      break;
    case 'pitch:result':
      mainWindow?.webContents.send(IPC.PITCH_RESULT, message.payload);
      break;
    case 'pitch:stream':
      mainWindow?.webContents.send(IPC.PITCH_STREAM, message.payload);
      break;
    case 'formant:result':
      mainWindow?.webContents.send(IPC.FORMANT_RESULT, message.payload);
      break;
    case 'formant:stream':
      mainWindow?.webContents.send(IPC.FORMANT_STREAM, message.payload);
      break;
    case 'quality:result':
      mainWindow?.webContents.send(IPC.QUALITY_RESULT, message.payload);
      break;
    case 'vibrato:result':
      mainWindow?.webContents.send(IPC.VIBRATO_RESULT, message.payload);
      break;
  }
}

function sendToPython(message: object): void {
  if (pythonProcess?.stdin) {
    pythonProcess.stdin.write(JSON.stringify(message) + '\n');
  }
}

// ============================================================================
// Audio Capture (Linux - parec)
// ============================================================================
interface AudioDevice {
  id: string;
  name: string;
  isMonitor: boolean;
}

async function getAudioDevices(): Promise<AudioDevice[]> {
  return new Promise((resolve) => {
    const pactl = spawn('pactl', ['list', 'sources', 'short']);
    let output = '';

    pactl.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    pactl.on('close', () => {
      const devices: AudioDevice[] = [];
      const lines = output.trim().split('\n');

      for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length >= 2) {
          const id = parts[1];
          const isMonitor = id.includes('.monitor');
          devices.push({
            id,
            name: isMonitor ? `Monitor: ${id.replace('.monitor', '')}` : id,
            isMonitor,
          });
        }
      }

      resolve(devices);
    });

    pactl.on('error', () => {
      resolve([]);
    });
  });
}

function startAudioCapture(deviceId: string): boolean {
  if (audioProcess) {
    stopAudioCapture();
  }

  console.log(`Starting audio capture from: ${deviceId}`);

  audioProcess = spawn('parec', [
    '--device', deviceId,
    '--rate', '48000',
    '--channels', '2',
    '--format', 'float32le',
    '--latency-msec', '20',
  ]);

  audioProcess.stdout?.on('data', (data: Buffer) => {
    // Convert buffer to Float32Array and send to renderer
    const samples = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
    mainWindow?.webContents.send(IPC.AUDIO_DATA, Array.from(samples));
  });

  audioProcess.stderr?.on('data', (data: Buffer) => {
    console.error(`[parec] ${data.toString().trim()}`);
  });

  audioProcess.on('close', (code: number | null) => {
    console.log(`Audio capture process exited with code: ${code}`);
    audioProcess = null;
  });

  audioProcess.on('error', (err: Error) => {
    console.error('Failed to start audio capture:', err.message);
    audioProcess = null;
  });

  return true;
}

function stopAudioCapture(): void {
  if (audioProcess) {
    audioProcess.kill('SIGTERM');
    audioProcess = null;
  }
}

// ============================================================================
// File Handlers
// ============================================================================
interface AudioFileInfo {
  path: string;
  name: string;
  duration: number;
  sampleRate: number;
  channels: number;
  format: string;
}

async function importAudioFile(): Promise<AudioFileInfo | null> {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Import Audio File',
    filters: [
      { name: 'Audio Files', extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];

  // Get file info via Python
  // For now, return basic info
  return {
    path: filePath,
    name: filePath.split('/').pop() || '',
    duration: 0, // Will be filled by Python
    sampleRate: 44100,
    channels: 2,
    format: filePath.split('.').pop() || 'unknown',
  };
}

// ============================================================================
// Layout Persistence
// ============================================================================
const layoutPath = join(userDataDir, 'vocal-prime-layout.json');

function saveLayout(data: unknown): { success: boolean } {
  try {
    fs.writeFileSync(layoutPath, JSON.stringify(data, null, 2));
    return { success: true };
  } catch (error) {
    console.error('Failed to save layout:', error);
    return { success: false };
  }
}

function loadLayout(): { data: unknown } | null {
  try {
    if (fs.existsSync(layoutPath)) {
      const data = JSON.parse(fs.readFileSync(layoutPath, 'utf-8'));
      return { data };
    }
  } catch (error) {
    console.error('Failed to load layout:', error);
  }
  return null;
}

// ============================================================================
// IPC Handlers Registration
// ============================================================================
function registerIpcHandlers(): void {
  // Audio handlers
  ipcMain.handle(IPC.AUDIO_DEVICES, async () => {
    return await getAudioDevices();
  });

  ipcMain.handle(IPC.AUDIO_START, async (_, deviceId: string) => {
    return startAudioCapture(deviceId);
  });

  ipcMain.handle(IPC.AUDIO_STOP, async () => {
    stopAudioCapture();
    return true;
  });

  // File handlers
  ipcMain.handle(IPC.FILE_IMPORT, async () => {
    return await importAudioFile();
  });

  // Separation handlers
  ipcMain.handle(IPC.SEPARATION_START, async (_, request: object) => {
    const taskId = crypto.randomUUID();
    sendToPython({ type: 'separation:start', id: taskId, payload: request });
    return { taskId };
  });

  ipcMain.handle(IPC.SEPARATION_CANCEL, async (_, taskId: string) => {
    sendToPython({ type: 'separation:cancel', id: taskId });
    return true;
  });

  // Pitch handlers
  ipcMain.handle(IPC.PITCH_ANALYZE, async (_, request: object) => {
    const taskId = crypto.randomUUID();
    sendToPython({ type: 'pitch:analyze', id: taskId, payload: request });
    return { taskId };
  });

  // Formant handlers
  ipcMain.handle(IPC.FORMANT_ANALYZE, async (_, request: object) => {
    const taskId = crypto.randomUUID();
    sendToPython({ type: 'formant:analyze', id: taskId, payload: request });
    return { taskId };
  });

  // Quality handlers
  ipcMain.handle(IPC.QUALITY_ANALYZE, async (_, request: object) => {
    const taskId = crypto.randomUUID();
    sendToPython({ type: 'quality:analyze', id: taskId, payload: request });
    return { taskId };
  });

  // Vibrato handlers
  ipcMain.handle(IPC.VIBRATO_ANALYZE, async (_, request: object) => {
    const taskId = crypto.randomUUID();
    sendToPython({ type: 'vibrato:analyze', id: taskId, payload: request });
    return { taskId };
  });

  // Python management
  ipcMain.handle(IPC.PYTHON_STATUS, async () => {
    return { running: pythonProcess !== null };
  });

  ipcMain.handle(IPC.PYTHON_RESTART, async () => {
    stopPythonProcess();
    startPythonProcess();
    return true;
  });

  // Window handlers
  ipcMain.handle(IPC.WINDOW_FULLSCREEN, async () => {
    if (mainWindow) {
      const isFullscreen = mainWindow.isFullScreen();
      mainWindow.setFullScreen(!isFullscreen);
      return !isFullscreen;
    }
    return false;
  });

  ipcMain.handle(IPC.WINDOW_QUIT, async () => {
    app.quit();
  });

  // Layout handlers
  ipcMain.handle(IPC.LAYOUT_SAVE, async (_, data: unknown) => {
    return saveLayout(data);
  });

  ipcMain.handle(IPC.LAYOUT_LOAD, async () => {
    return loadLayout();
  });
}

// ============================================================================
// App Lifecycle
// ============================================================================
app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  // Start Python process in the background
  // startPythonProcess(); // Uncomment when Python backend is ready

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopAudioCapture();
  stopPythonProcess();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopAudioCapture();
  stopPythonProcess();
});

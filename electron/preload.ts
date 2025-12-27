/**
 * VOCAL_PRIME - Preload Script
 * Type-safe context bridge for renderer process
 */

import { contextBridge, ipcRenderer } from 'electron';

// ============================================================================
// Type Definitions
// ============================================================================
export interface AudioDevice {
  id: string;
  name: string;
  isMonitor: boolean;
}

export interface AudioFileInfo {
  path: string;
  name: string;
  duration: number;
  sampleRate: number;
  channels: number;
  format: string;
}

export interface SeparationRequest {
  source: string;
  models: ('vocals' | 'drums' | 'bass' | 'other')[];
  quality: 'fast' | 'normal' | 'high';
}

export interface SeparationProgress {
  taskId: string;
  percent: number;
  stage: string;
  eta?: number;
}

export interface SeparationResult {
  taskId: string;
  stems: {
    [key: string]: {
      samples: number[];
      duration: number;
    };
  };
  sampleRate: number;
}

export interface PitchRequest {
  source: string;
  buffer?: number[];
  sampleRate: number;
  algorithm: 'crepe' | 'yin';
  hopSize?: number;
  minFreq?: number;
  maxFreq?: number;
}

export interface PitchResult {
  taskId: string;
  timestamps: number[];
  frequencies: number[];
  confidence: number[];
  voiced: number[];
  hopSize: number;
  sampleRate: number;
}

export interface PitchFrame {
  timestamp: number;
  frequency: number;
  confidence: number;
  voiced: boolean;
}

export interface StreamingPitchData {
  taskId: string;
  frequency: number;
  confidence: number;
  voiced: boolean;
  algorithm: 'torchcrepe' | 'melodia' | 'unknown';
  latencyMs: number;
}

export type PitchMode = 'auto' | 'crepe' | 'melodia';

export interface FormantRequest {
  source: string;
  buffer?: number[];
  sampleRate: number;
  maxFormants?: number;
  windowLength?: number;
  hopSize?: number;
}

export interface FormantResult {
  taskId: string;
  timestamps: number[];
  formants: {
    [key: string]: {
      frequencies: number[];
      bandwidths: number[];
    };
  };
}

export interface FormantFrame {
  timestamp: number;
  F1: number;
  F2: number;
  F3: number;
  F4: number;
}

export interface QualityRequest {
  source: string;
  buffer?: number[];
  sampleRate: number;
  windowLength?: number;
}

export interface QualityResult {
  taskId: string;
  jitter: {
    local: number;
    rap: number;
    ppq5: number;
  };
  shimmer: {
    local: number;
    apq3: number;
    apq5: number;
  };
  hnr: number;
}

export interface VibratoRequest {
  pitchContour: number[];
  timestamps: number[];
  sampleRate: number;
}

export interface VibratoResult {
  taskId: string;
  rate: number;
  extent: number;
  regularity: number;
  detected: boolean;
}

export interface PythonStatus {
  running: boolean;
}

export interface LayoutSaveResult {
  success: boolean;
}

export interface LayoutLoadResult {
  data: unknown;
}

export interface StreamVocalsData {
  taskId: string;
  vocals: string;  // base64 encoded float32 samples
  samples: number;
  latencyMs: number;
}

// ============================================================================
// Electron API Interface
// ============================================================================
export interface ElectronAPI {
  // Audio capture
  audio: {
    getDevices: () => Promise<AudioDevice[]>;
    start: (deviceId: string) => Promise<boolean>;
    stop: () => Promise<boolean>;
    onData: (callback: (samples: number[]) => void) => () => void;
  };

  // File operations
  file: {
    import: () => Promise<AudioFileInfo | null>;
    exportReport: (format: 'pdf' | 'json' | 'txt', data: object) => Promise<string>;
    getInfo: (path: string) => Promise<AudioFileInfo>;
  };

  // Source separation
  separation: {
    start: (request: SeparationRequest) => Promise<{ taskId: string }>;
    cancel: (taskId: string) => Promise<void>;
    onProgress: (callback: (progress: SeparationProgress) => void) => () => void;
    onResult: (callback: (result: SeparationResult) => void) => () => void;
  };

  // Real-time streaming separation
  stream: {
    start: (mode: 'full' | 'light') => Promise<{ taskId: string }>;
    stop: () => Promise<boolean>;
    onVocals: (callback: (data: StreamVocalsData) => void) => () => void;
  };

  // Pitch detection
  pitch: {
    analyze: (request: PitchRequest) => Promise<{ taskId: string }>;
    onResult: (callback: (result: PitchResult) => void) => () => void;
    onStream: (callback: (data: PitchFrame) => void) => () => void;
    // Streaming pitch detection (GPU-accelerated)
    startStreaming: (mode: PitchMode) => Promise<{ taskId: string }>;
    stopStreaming: () => Promise<boolean>;
    setMode: (mode: PitchMode) => Promise<boolean>;
    onData: (callback: (data: StreamingPitchData) => void) => () => void;
  };

  // Formant analysis
  formant: {
    analyze: (request: FormantRequest) => Promise<{ taskId: string }>;
    onResult: (callback: (result: FormantResult) => void) => () => void;
    onStream: (callback: (data: FormantFrame) => void) => () => void;
  };

  // Voice quality
  quality: {
    analyze: (request: QualityRequest) => Promise<{ taskId: string }>;
    onResult: (callback: (result: QualityResult) => void) => () => void;
  };

  // Vibrato analysis
  vibrato: {
    analyze: (request: VibratoRequest) => Promise<{ taskId: string }>;
    onResult: (callback: (result: VibratoResult) => void) => () => void;
  };

  // Python process status
  python: {
    getStatus: () => Promise<PythonStatus>;
    restart: () => Promise<boolean>;
  };

  // Window controls
  window: {
    toggleFullscreen: () => Promise<boolean>;
    quit: () => Promise<void>;
  };

  // Layout persistence
  layout: {
    save: (data: unknown) => Promise<LayoutSaveResult>;
    load: () => Promise<LayoutLoadResult | null>;
  };
}

// ============================================================================
// Context Bridge Exposure
// ============================================================================
const electronAPI: ElectronAPI = {
  // Audio capture
  audio: {
    getDevices: () => ipcRenderer.invoke('audio:devices'),
    start: (deviceId: string) => ipcRenderer.invoke('audio:start', deviceId),
    stop: () => ipcRenderer.invoke('audio:stop'),
    onData: (callback: (samples: number[]) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, samples: number[]) => callback(samples);
      ipcRenderer.on('audio:data', listener);
      return () => ipcRenderer.removeListener('audio:data', listener);
    },
  },

  // File operations
  file: {
    import: () => ipcRenderer.invoke('file:import'),
    exportReport: (format: 'pdf' | 'json' | 'txt', data: object) =>
      ipcRenderer.invoke('file:export-report', format, data),
    getInfo: (path: string) => ipcRenderer.invoke('file:get-info', path),
  },

  // Source separation
  separation: {
    start: (request: SeparationRequest) => ipcRenderer.invoke('separation:start', request),
    cancel: (taskId: string) => ipcRenderer.invoke('separation:cancel', taskId),
    onProgress: (callback: (progress: SeparationProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: SeparationProgress) =>
        callback(progress);
      ipcRenderer.on('separation:progress', listener);
      return () => ipcRenderer.removeListener('separation:progress', listener);
    },
    onResult: (callback: (result: SeparationResult) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, result: SeparationResult) =>
        callback(result);
      ipcRenderer.on('separation:result', listener);
      return () => ipcRenderer.removeListener('separation:result', listener);
    },
  },

  // Real-time streaming separation
  stream: {
    start: (mode: 'full' | 'light') => ipcRenderer.invoke('stream:start', mode),
    stop: () => ipcRenderer.invoke('stream:stop'),
    onVocals: (callback: (data: StreamVocalsData) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: StreamVocalsData) =>
        callback(data);
      ipcRenderer.on('stream:vocals', listener);
      return () => ipcRenderer.removeListener('stream:vocals', listener);
    },
  },

  // Pitch detection
  pitch: {
    analyze: (request: PitchRequest) => ipcRenderer.invoke('pitch:analyze', request),
    onResult: (callback: (result: PitchResult) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, result: PitchResult) =>
        callback(result);
      ipcRenderer.on('pitch:result', listener);
      return () => ipcRenderer.removeListener('pitch:result', listener);
    },
    onStream: (callback: (data: PitchFrame) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: PitchFrame) => callback(data);
      ipcRenderer.on('pitch:stream', listener);
      return () => ipcRenderer.removeListener('pitch:stream', listener);
    },
    // Streaming pitch detection (GPU-accelerated)
    startStreaming: (mode: PitchMode) => ipcRenderer.invoke('pitch:start', mode),
    stopStreaming: () => ipcRenderer.invoke('pitch:stop'),
    setMode: (mode: PitchMode) => ipcRenderer.invoke('pitch:set_mode', mode),
    onData: (callback: (data: StreamingPitchData) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: StreamingPitchData) =>
        callback(data);
      ipcRenderer.on('pitch:data', listener);
      return () => ipcRenderer.removeListener('pitch:data', listener);
    },
  },

  // Formant analysis
  formant: {
    analyze: (request: FormantRequest) => ipcRenderer.invoke('formant:analyze', request),
    onResult: (callback: (result: FormantResult) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, result: FormantResult) =>
        callback(result);
      ipcRenderer.on('formant:result', listener);
      return () => ipcRenderer.removeListener('formant:result', listener);
    },
    onStream: (callback: (data: FormantFrame) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: FormantFrame) => callback(data);
      ipcRenderer.on('formant:stream', listener);
      return () => ipcRenderer.removeListener('formant:stream', listener);
    },
  },

  // Voice quality
  quality: {
    analyze: (request: QualityRequest) => ipcRenderer.invoke('quality:analyze', request),
    onResult: (callback: (result: QualityResult) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, result: QualityResult) =>
        callback(result);
      ipcRenderer.on('quality:result', listener);
      return () => ipcRenderer.removeListener('quality:result', listener);
    },
  },

  // Vibrato analysis
  vibrato: {
    analyze: (request: VibratoRequest) => ipcRenderer.invoke('vibrato:analyze', request),
    onResult: (callback: (result: VibratoResult) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, result: VibratoResult) =>
        callback(result);
      ipcRenderer.on('vibrato:result', listener);
      return () => ipcRenderer.removeListener('vibrato:result', listener);
    },
  },

  // Python process status
  python: {
    getStatus: () => ipcRenderer.invoke('python:status'),
    restart: () => ipcRenderer.invoke('python:restart'),
  },

  // Window controls
  window: {
    toggleFullscreen: () => ipcRenderer.invoke('window:fullscreen'),
    quit: () => ipcRenderer.invoke('window:quit'),
  },

  // Layout persistence
  layout: {
    save: (data: unknown) => ipcRenderer.invoke('layout:save', data),
    load: () => ipcRenderer.invoke('layout:load'),
  },
};

// Expose API to renderer
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type declaration for global window
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

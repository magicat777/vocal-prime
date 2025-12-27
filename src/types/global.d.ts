/**
 * Global type declarations for VOCAL_PRIME
 */

// Audio device interface
interface AudioDevice {
  id: string;
  name: string;
  isMonitor: boolean;
}

// File info interface
interface AudioFileInfo {
  path: string;
  name: string;
  duration: number;
  sampleRate: number;
  channels: number;
  format: string;
}

// Stream vocals data
interface StreamVocalsData {
  taskId: string;
  vocals: string;  // base64 encoded float32 samples
  samples: number;
  latencyMs: number;
}

// Streaming pitch data from Python backend
interface StreamingPitchData {
  taskId: string;
  frequency: number;
  confidence: number;
  voiced: boolean;
  algorithm: string;
  latencyMs: number;
}

// Pitch detection mode
type PitchMode = 'auto' | 'crepe' | 'melodia';

// ElectronAPI interface matching preload.ts
interface ElectronAPI {
  audio: {
    getDevices: () => Promise<AudioDevice[]>;
    start: (deviceId: string) => Promise<boolean>;
    stop: () => Promise<void>;
    onData: (callback: (samples: number[]) => void) => () => void;
  };
  file: {
    import: () => Promise<AudioFileInfo | null>;
    exportReport: (data: unknown) => Promise<{ success: boolean; path?: string }>;
    getInfo: (path: string) => Promise<AudioFileInfo | null>;
  };
  separation: {
    start: (request: { audioPath: string; quality?: string }) => Promise<{ taskId: string }>;
    cancel: (taskId: string) => Promise<boolean>;
    onProgress: (callback: (progress: { taskId: string; percent: number; stage: string }) => void) => () => void;
    onResult: (callback: (result: { taskId: string; vocalsPath: string; instrumentalPath: string }) => void) => () => void;
  };
  stream: {
    start: (mode: 'full' | 'light') => Promise<{ taskId: string }>;
    stop: () => Promise<boolean>;
    onVocals: (callback: (data: StreamVocalsData) => void) => () => void;
  };
  pitch: {
    analyze: (request: { audioPath: string; model?: string }) => Promise<{ taskId: string }>;
    onResult: (callback: (result: unknown) => void) => () => void;
    onStream: (callback: (data: unknown) => void) => () => void;
    // Streaming pitch detection (GPU-accelerated)
    startStreaming: (mode: PitchMode) => Promise<{ taskId: string }>;
    stopStreaming: () => Promise<boolean>;
    setMode: (mode: PitchMode) => Promise<boolean>;
    onData: (callback: (data: StreamingPitchData) => void) => () => void;
  };
  formant: {
    analyze: (request: { audioPath: string }) => Promise<{ taskId: string }>;
    onResult: (callback: (result: unknown) => void) => () => void;
    onStream: (callback: (data: unknown) => void) => () => void;
  };
  quality: {
    analyze: (request: { audioPath: string }) => Promise<{ taskId: string }>;
    onResult: (callback: (result: unknown) => void) => () => void;
  };
  vibrato: {
    analyze: (request: { audioPath: string }) => Promise<{ taskId: string }>;
    onResult: (callback: (result: unknown) => void) => () => void;
  };
  python: {
    getStatus: () => Promise<{ running: boolean }>;
    restart: () => Promise<boolean>;
  };
  window: {
    toggleFullscreen: () => Promise<boolean>;
    quit: () => Promise<void>;
  };
  layout: {
    save: (data: unknown) => Promise<{ success: boolean }>;
    load: () => Promise<{ data: unknown } | null>;
  };
}

// Extend Window interface
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};

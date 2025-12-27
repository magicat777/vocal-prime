# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VOCAL_PRIME is a professional voice analysis application for audio mastering, featuring source separation (Demucs), pitch detection (CREPE), formant analysis (Parselmouth), and voice quality metrics. Built with Electron 35, Svelte 5, TypeScript, and Python backend.

## Build & Development Commands

```bash
# Development
npm run dev              # Start dev server (Vite on :5174, Electron auto-connects)
npm run electron:dev     # Launch Electron in dev mode only

# Python backend
npm run python:setup     # Create venv and install dependencies
npm run python:check     # Verify PyTorch and CUDA
npm run python:server    # Start ZeroMQ analysis server

# Production build
npm run build            # Full build (tsc + vite + electron-builder)
npm run python:build     # PyInstaller bundle for distribution

# Quality
npm run lint             # ESLint on src/ and electron/
npm run lint:fix         # ESLint with auto-fix
npm run type-check       # TypeScript validation
npm run test             # Run Vitest suite
```

## Architecture

### Process Separation
- **Electron Main** (`electron/main.ts`): IPC handlers, audio capture, Python subprocess management
- **Electron Preload** (`electron/preload.ts`): Context bridge exposing `window.electronAPI`
- **Python Backend** (`python/vocal_prime/`): ZeroMQ server for heavy analysis (Demucs, CREPE, Parselmouth)
- **Renderer** (`src/`): Svelte 5 SPA with Canvas/WebGL visualization

### Data Flow
```
Audio Source → Electron Main → Python Backend (ZeroMQ) → Analysis Results → Svelte Stores → UI
     ↓
System Audio (parec) / File Import
```

### Operating Modes

**Live Mode (Spotify/System Audio):**
- Immediate: Real-time spectral analysis (~10ms latency)
- Background: Async deep analysis with source separation (~500ms-2s)

**File Mode (MP3/WAV):**
- Full Demucs separation + comprehensive analysis

### Key Source Locations
- `electron/main.ts` - Main process, IPC handlers, Python bridge
- `electron/preload.ts` - Context bridge API
- `electron/python/PythonBridge.ts` - ZeroMQ client for Python communication
- `python/vocal_prime/server.py` - ZeroMQ analysis server
- `python/vocal_prime/separation/` - Demucs wrapper
- `python/vocal_prime/pitch/` - CREPE/YIN detectors
- `python/vocal_prime/formants/` - Parselmouth analyzer
- `src/core/VocalEngine.ts` - Central coordination
- `src/stores/` - Svelte stores (pitch, formants, quality)
- `src/components/panels/` - Visualization panels

### TypeScript Path Aliases
```
@/* → src/*
@core/* → src/core/*
@analysis/* → src/analysis/*
@rendering/* → src/rendering/*
@components/* → src/components/*
@stores/* → src/stores/*
@utils/* → src/utils/*
```

## System Requirements

- Linux (Ubuntu 22.04+)
- NVIDIA GPU with CUDA 11.8+ (RTX 3060+ recommended)
- Python 3.10+
- Node.js 20+
- 16GB+ RAM for Demucs

## Python Dependencies

```
demucs>=4.0.0          # Source separation
crepe>=0.0.16          # Neural pitch detection
parselmouth>=0.4.0     # Formant analysis, voice quality
librosa>=0.10.0        # Audio I/O
pyzmq>=25.0.0          # IPC with Electron
torch>=2.0.0           # PyTorch (CUDA)
```

## Security Considerations

- Electron context isolation enabled
- CSP headers in index.html
- Python subprocess sandboxed via ZeroMQ (no direct shell access)
- No eval() or dynamic requires

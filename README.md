# VOCAL_PRIME

Professional musical vocal analysis for audio mastering workflows.

## Features

- **Source Separation**: Extract vocals from stereo mix using Demucs v4
- **Pitch Detection**: Real-time pitch tracking with autocorrelation
- **Formant Analysis**: F1-F4 trajectories for vowel/timbre analysis
- **Musical Vocal Metrics**:
  - **Presence**: Vocal cut-through (1-5kHz energy ratio)
  - **Vibrato**: Rate (Hz) and extent (semitones) detection
  - **Dynamics**: Expressive loudness variation
  - **Clarity**: Harmonic quality (0-100%)
  - **Intensity**: Overall vocal power

## Operating Modes

### Live Mode (Real-time)
Analyze audio from Spotify or system audio with hybrid processing:
- Immediate layer: ~10ms latency spectral analysis
- Background layer: Deep analysis with source separation

### File Mode
Full analysis of WAV/MP3/FLAC files with comprehensive reporting.

## Requirements

- Linux (Ubuntu 22.04+)
- NVIDIA GPU with CUDA 11.8+
- Python 3.10+
- Node.js 20+
- 16GB RAM recommended

## Installation

```bash
# Clone repository
git clone https://github.com/magicat777/vocal-prime.git
cd vocal-prime

# Install Node dependencies
npm install

# Set up Python environment
npm run python:setup

# Verify CUDA
npm run python:check
```

## Development

```bash
# Start Python analysis server (terminal 1)
npm run python:server

# Start Electron app (terminal 2)
npm run dev
```

## Build

```bash
npm run build
```

## License

MIT

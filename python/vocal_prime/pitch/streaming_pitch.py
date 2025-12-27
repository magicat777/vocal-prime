"""
Streaming Pitch Detection for Real-Time Vocal Analysis

Provides GPU-accelerated pitch detection using torchcrepe and
polyphonic melody extraction using Essentia's Melodia algorithm.
"""

import sys
import numpy as np
import torch
from typing import Optional, Dict, Tuple
from collections import deque
import time


class TorchCREPEDetector:
    """
    GPU-accelerated pitch detection using torchcrepe.

    Best for: Single voice with high accuracy
    Latency: ~20-50ms depending on model size
    """

    def __init__(
        self,
        model: str = 'tiny',  # 'tiny', 'small', 'medium', 'large', 'full'
        sample_rate: int = 48000,
        hop_length: int = 480,  # 10ms at 48kHz
        fmin: float = 50.0,
        fmax: float = 2000.0,
        device: Optional[str] = None
    ):
        self.sample_rate = sample_rate
        self.hop_length = hop_length
        self.fmin = fmin
        self.fmax = fmax
        self.model = model

        # Device selection
        if device is None:
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        else:
            self.device = torch.device(device)

        print(f"TorchCREPE using device: {self.device}, model: {model}", file=sys.stderr)

        # Streaming buffer (need at least 1024 samples for CREPE)
        self.min_samples = 1024
        self.buffer = np.zeros(0, dtype=np.float32)

        # Pre-load model
        self._model_loaded = False
        self._load_model()

    def _load_model(self):
        """Pre-load torchcrepe model to GPU."""
        try:
            import torchcrepe
            # Warm up by processing silence
            dummy = torch.zeros(1, 1024, device=self.device)
            with torch.no_grad():
                torchcrepe.predict(
                    dummy,
                    16000,  # CREPE expects 16kHz
                    hop_length=160,
                    model=self.model,
                    device=self.device,
                    batch_size=1
                )
            self._model_loaded = True
            print(f"torchcrepe model '{self.model}' loaded", file=sys.stderr)
        except Exception as e:
            print(f"Failed to load torchcrepe: {e}", file=sys.stderr)
            self._model_loaded = False

    def process_chunk(self, audio: np.ndarray) -> Optional[Dict]:
        """
        Process audio chunk and return pitch data.

        Args:
            audio: Mono float32 samples at self.sample_rate

        Returns:
            Dict with frequency, confidence, voiced flag, or None if buffering
        """
        if not self._model_loaded:
            return None

        import torchcrepe
        import resampy

        # Accumulate in buffer
        self.buffer = np.concatenate([self.buffer, audio])

        if len(self.buffer) < self.min_samples:
            return None

        # Process the buffer
        to_process = self.buffer
        self.buffer = np.zeros(0, dtype=np.float32)

        try:
            # Resample to 16kHz (CREPE's native rate)
            if self.sample_rate != 16000:
                audio_16k = resampy.resample(to_process, self.sample_rate, 16000)
            else:
                audio_16k = to_process

            # Convert to tensor
            audio_tensor = torch.from_numpy(audio_16k).unsqueeze(0).to(self.device)

            # Run inference
            with torch.no_grad():
                pitch, periodicity = torchcrepe.predict(
                    audio_tensor,
                    16000,
                    hop_length=160,  # ~10ms at 16kHz
                    model=self.model,
                    device=self.device,
                    batch_size=1,
                    return_periodicity=True
                )

            # Get the last frame (most recent)
            freq = float(pitch[0, -1].cpu().numpy())
            conf = float(periodicity[0, -1].cpu().numpy())

            # Apply frequency range and voicing threshold
            voiced = conf > 0.5 and self.fmin <= freq <= self.fmax

            return {
                'frequency': freq if voiced else 0,
                'confidence': conf,
                'voiced': voiced,
                'algorithm': 'torchcrepe'
            }

        except Exception as e:
            print(f"torchcrepe error: {e}", file=sys.stderr)
            return None

    def reset(self):
        """Reset buffer state."""
        self.buffer = np.zeros(0, dtype=np.float32)


class MelodiaDetector:
    """
    Polyphonic melody extraction using Essentia's PredominantPitchMelodia.

    Best for: Multiple voices, extracting lead melody from harmony
    Based on: Salamon & Gómez (2012) "Melody Extraction from Polyphonic Music Signals"
    """

    def __init__(
        self,
        sample_rate: int = 48000,
        frame_size: int = 2048,
        hop_size: int = 128,
        min_freq: float = 55.0,    # A1 - covers bass vocals
        max_freq: float = 1800.0,  # Extended for soprano (up to ~A6)
        voice_vibrato: bool = True
    ):
        self.sample_rate = sample_rate
        self.frame_size = frame_size
        self.hop_size = hop_size
        self.min_freq = min_freq
        self.max_freq = max_freq
        self.voice_vibrato = voice_vibrato

        # Larger buffer for better continuity (reduces breaks)
        # At 48kHz: 4096 samples = 85ms, giving ~12Hz update rate
        self.buffer = np.zeros(0, dtype=np.float32)
        self.min_samples = frame_size * 2  # ~85ms at 48kHz - larger window = fewer breaks

        # Essentia algorithms (lazy loaded)
        self._melodia = None
        self._eqloud = None
        self._loaded = False

        self._load_essentia()

    def _load_essentia(self):
        """Load Essentia algorithms."""
        try:
            import essentia.standard as es

            # Equal loudness filter (recommended for Melodia)
            self._eqloud = es.EqualLoudness(sampleRate=self.sample_rate)

            # Melodia algorithm - tuned for continuous melody tracking with fewer breaks
            self._melodia = es.PredominantPitchMelodia(
                frameSize=self.frame_size,
                hopSize=self.hop_size,
                sampleRate=self.sample_rate,
                minFrequency=self.min_freq,
                maxFrequency=self.max_freq,
                voiceVibrato=self.voice_vibrato,
                voicingTolerance=0.5,  # More tolerant to reduce breaks
                peakDistributionThreshold=0.7,  # Lower threshold = more pitch detected
                peakFrameThreshold=0.7,
                pitchContinuity=50.0,  # Higher = smoother tracking across frames
                timeContinuity=80,  # Higher = bridge gaps between voiced sections
                minDuration=20  # Shorter = detect shorter notes (20ms minimum)
            )

            self._loaded = True
            print("Essentia Melodia algorithm loaded", file=sys.stderr)

        except ImportError as e:
            print(f"Essentia not available: {e}", file=sys.stderr)
            self._loaded = False
        except Exception as e:
            print(f"Failed to initialize Melodia: {e}", file=sys.stderr)
            self._loaded = False

    def process_chunk(self, audio: np.ndarray) -> Optional[Dict]:
        """
        Process audio chunk and return predominant pitch.

        Args:
            audio: Mono float32 samples at self.sample_rate

        Returns:
            Dict with frequency, confidence, voiced flag, or None if buffering
        """
        if not self._loaded:
            return None

        # Accumulate in buffer
        self.buffer = np.concatenate([self.buffer, audio])

        if len(self.buffer) < self.min_samples:
            return None

        # Process the buffer
        to_process = self.buffer.copy()
        # Keep half frame overlap for continuity (faster updates)
        self.buffer = self.buffer[-(self.frame_size // 2):]

        try:
            # Apply equal loudness filter
            audio_eq = self._eqloud(to_process)

            # Run Melodia
            pitch, confidence = self._melodia(audio_eq)

            if len(pitch) == 0:
                return {'frequency': 0, 'confidence': 0, 'voiced': False, 'algorithm': 'melodia'}

            # Get the last valid pitch
            # Melodia returns 0 for unvoiced frames
            valid_mask = pitch > 0

            if np.any(valid_mask):
                # Use the most recent valid pitch
                last_valid_idx = np.where(valid_mask)[0][-1]
                freq = float(pitch[last_valid_idx])
                conf = float(confidence[last_valid_idx])
                voiced = True
            else:
                freq = 0
                conf = 0
                voiced = False

            return {
                'frequency': freq,
                'confidence': conf,
                'voiced': voiced,
                'algorithm': 'melodia'
            }

        except Exception as e:
            print(f"Melodia error: {e}", file=sys.stderr)
            return None

    def reset(self):
        """Reset buffer state."""
        self.buffer = np.zeros(0, dtype=np.float32)


class HybridPitchDetector:
    """
    Hybrid pitch detector that combines torchcrepe and Melodia.

    Uses torchcrepe for speed when available, falls back to Melodia
    for complex polyphonic content.

    Modes:
    - 'auto': Use torchcrepe, switch to Melodia if low confidence
    - 'crepe': Always use torchcrepe (GPU-accelerated)
    - 'melodia': Always use Melodia (polyphonic)
    """

    def __init__(
        self,
        mode: str = 'auto',
        sample_rate: int = 48000,
        device: Optional[str] = None
    ):
        self.mode = mode
        self.sample_rate = sample_rate

        # Always initialize BOTH detectors for reliable mode switching
        self._crepe = None
        self._melodia = None

        # Try to initialize CREPE (GPU-accelerated)
        try:
            self._crepe = TorchCREPEDetector(
                model='small',  # Balance of speed and accuracy
                sample_rate=sample_rate,
                device=device
            )
            print(f"CREPE detector initialized successfully", file=sys.stderr)
        except Exception as e:
            print(f"Could not initialize torchcrepe: {e}", file=sys.stderr)
            self._crepe = None

        # Try to initialize Melodia (polyphonic)
        try:
            self._melodia = MelodiaDetector(sample_rate=sample_rate)
            print(f"Melodia detector initialized successfully", file=sys.stderr)
        except Exception as e:
            print(f"Could not initialize Melodia: {e}", file=sys.stderr)
            self._melodia = None

        # Report available modes
        available = []
        if self._crepe:
            available.append('crepe')
        if self._melodia:
            available.append('melodia')
        print(f"Available pitch modes: {available}, current: {mode}", file=sys.stderr)

        # Confidence threshold for auto-switching
        self.confidence_threshold = 0.6

        # Statistics
        self.last_algorithm = None
        self.avg_latency_ms = 0

    def process_chunk(self, audio: np.ndarray) -> Optional[Dict]:
        """
        Process audio chunk using selected algorithm(s).

        Args:
            audio: Mono float32 samples

        Returns:
            Dict with frequency, confidence, voiced, algorithm used
        """
        start_time = time.time()
        result = None

        if self.mode == 'crepe' and self._crepe:
            result = self._crepe.process_chunk(audio)

        elif self.mode == 'melodia' and self._melodia:
            result = self._melodia.process_chunk(audio)

        elif self.mode == 'auto':
            # Try torchcrepe first (faster)
            if self._crepe:
                result = self._crepe.process_chunk(audio)

                # If low confidence, try Melodia
                if result and result['confidence'] < self.confidence_threshold:
                    if self._melodia:
                        melodia_result = self._melodia.process_chunk(audio)
                        if melodia_result and melodia_result['confidence'] > result['confidence']:
                            result = melodia_result
            elif self._melodia:
                result = self._melodia.process_chunk(audio)

        # Update latency stats
        if result:
            latency = (time.time() - start_time) * 1000
            self.avg_latency_ms = self.avg_latency_ms * 0.9 + latency * 0.1
            self.last_algorithm = result.get('algorithm')

        return result

    def set_mode(self, mode: str):
        """Change detection mode."""
        if mode in ['auto', 'crepe', 'melodia']:
            self.mode = mode
            print(f"Pitch detection mode set to: {mode}", file=sys.stderr)

    def reset(self):
        """Reset all detector states."""
        if self._crepe:
            self._crepe.reset()
        if self._melodia:
            self._melodia.reset()

    def get_latency_ms(self) -> float:
        """Get average processing latency."""
        return self.avg_latency_ms

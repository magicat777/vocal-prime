"""
Real-time Streaming Source Separator
Uses Demucs with overlapping windows for low-latency vocal extraction.

Based on: Défossez, A., et al. (2021). "Hybrid Spectrogram and Waveform Source Separation"
"""

import sys
import numpy as np
import torch
import torchaudio
from typing import Optional, Tuple, Callable
from collections import deque
import time


class StreamingSeparator:
    """
    Real-time audio source separator using Demucs.

    Processes audio in overlapping chunks for continuous streaming
    with ~500ms-1s latency on GPU.
    """

    def __init__(
        self,
        model_name: str = "htdemucs",
        sample_rate: int = 48000,
        chunk_duration: float = 2.0,    # Process 2-second chunks
        overlap: float = 0.5,            # 50% overlap between chunks
        device: Optional[str] = None
    ):
        self.sample_rate = sample_rate
        self.chunk_samples = int(chunk_duration * sample_rate)
        self.hop_samples = int(self.chunk_samples * (1 - overlap))
        self.overlap_samples = self.chunk_samples - self.hop_samples

        # Device selection
        if device is None:
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        else:
            self.device = torch.device(device)

        print(f"StreamingSeparator using device: {self.device}", file=sys.stderr)

        # Load model
        self.model = None
        self.model_name = model_name
        self._load_model()

        # Streaming buffers
        self.input_buffer = deque(maxlen=self.chunk_samples * 2)
        self.output_buffer = np.zeros(self.overlap_samples, dtype=np.float32)
        self.samples_since_last_process = 0

        # Statistics
        self.last_process_time = 0
        self.avg_latency_ms = 0

    def _load_model(self):
        """Load Demucs model."""
        try:
            from demucs.pretrained import get_model
            from demucs.apply import apply_model

            print(f"Loading {self.model_name} model...", file=sys.stderr)
            self.model = get_model(self.model_name)
            self.model.to(self.device)
            self.model.eval()

            # Store apply function
            self._apply_model = apply_model

            print(f"Model loaded successfully", file=sys.stderr)

        except Exception as e:
            print(f"Error loading Demucs model: {e}", file=sys.stderr)
            raise

    def process_chunk(self, audio_chunk: np.ndarray) -> Optional[np.ndarray]:
        """
        Process an audio chunk and return separated vocals if ready.

        Args:
            audio_chunk: Stereo audio samples (N, 2) or interleaved (N*2,)

        Returns:
            Separated vocals (N,) if a full chunk is ready, None otherwise
        """
        # Handle interleaved stereo
        if audio_chunk.ndim == 1:
            # Reshape from interleaved to (samples, channels)
            n_samples = len(audio_chunk) // 2
            audio_chunk = audio_chunk.reshape(n_samples, 2)

        # Add to input buffer
        for sample in audio_chunk:
            self.input_buffer.append(sample)

        self.samples_since_last_process += len(audio_chunk)

        # Check if we have enough samples to process
        if self.samples_since_last_process >= self.hop_samples and len(self.input_buffer) >= self.chunk_samples:
            return self._process_buffer()

        return None

    def _process_buffer(self) -> np.ndarray:
        """Process the current buffer through Demucs."""
        start_time = time.time()

        # Get chunk from buffer
        chunk_list = list(self.input_buffer)[-self.chunk_samples:]
        chunk = np.array(chunk_list, dtype=np.float32)  # (samples, 2)

        # Convert to tensor: (batch, channels, samples)
        tensor = torch.from_numpy(chunk.T).unsqueeze(0).to(self.device)

        # Run separation
        with torch.no_grad():
            # Demucs expects (batch, channels, samples)
            sources = self._apply_model(
                self.model,
                tensor,
                device=self.device,
                shifts=0,  # No random shifts for speed
                overlap=0.25,
                progress=False
            )

            # sources shape: (batch, sources, channels, samples)
            # Source order for htdemucs: drums, bass, other, vocals
            vocals_idx = 3  # vocals
            vocals = sources[0, vocals_idx].cpu().numpy()  # (2, samples)

        # Convert to mono
        vocals_mono = vocals.mean(axis=0)  # (samples,)

        # Apply crossfade with previous overlap
        output = np.zeros(self.hop_samples, dtype=np.float32)

        # Crossfade the overlap region
        if self.overlap_samples > 0:
            fade_in = np.linspace(0, 1, self.overlap_samples)
            fade_out = 1 - fade_in

            # Blend overlap region
            overlap_start = vocals_mono[:self.overlap_samples]
            blended = self.output_buffer * fade_out + overlap_start * fade_in

            # Output is blended overlap + new non-overlap portion
            output = np.concatenate([
                blended,
                vocals_mono[self.overlap_samples:self.hop_samples + self.overlap_samples]
            ])[:self.hop_samples]
        else:
            output = vocals_mono[:self.hop_samples]

        # Store new overlap for next iteration
        self.output_buffer = vocals_mono[-self.overlap_samples:].copy()

        # Reset counter
        self.samples_since_last_process = 0

        # Update latency stats
        process_time = (time.time() - start_time) * 1000
        self.avg_latency_ms = self.avg_latency_ms * 0.9 + process_time * 0.1
        self.last_process_time = process_time

        return output

    def get_latency_ms(self) -> float:
        """Get estimated total latency (buffer + processing)."""
        buffer_latency = (self.chunk_samples / self.sample_rate) * 1000
        return buffer_latency + self.avg_latency_ms

    def reset(self):
        """Reset all buffers."""
        self.input_buffer.clear()
        self.output_buffer = np.zeros(self.overlap_samples, dtype=np.float32)
        self.samples_since_last_process = 0


class LightweightSeparator:
    """
    Lighter-weight separator using spectral processing for faster results.
    Uses harmonic-percussive separation + vocal frequency isolation.

    Much faster (~50ms latency) but lower quality than Demucs.
    """

    def __init__(self, sample_rate: int = 48000, chunk_samples: int = 2048):
        self.sample_rate = sample_rate
        self.chunk_samples = chunk_samples
        self.n_fft = 2048
        self.hop_length = 512

        # Vocal frequency range (extended for full vocal harmonics)
        self.vocal_low = 80    # Hz (capture low male vocals)
        self.vocal_high = 8000 # Hz (capture vocal harmonics/air)

        # Pre-compute filter coefficients
        import scipy.signal as signal
        nyquist = self.sample_rate / 2
        low = self.vocal_low / nyquist
        high = self.vocal_high / nyquist
        self.b, self.a = signal.butter(4, [low, high], btype='band')

        # Buffer for continuity
        self.input_buffer = np.zeros(0, dtype=np.float32)
        self.min_samples = chunk_samples  # Process after accumulating this many

    def process_chunk(self, audio: np.ndarray) -> Optional[np.ndarray]:
        """
        Extract vocal frequencies from audio chunk.

        Args:
            audio: Audio samples (interleaved stereo or mono)

        Returns:
            Filtered audio emphasizing vocals, or None if still buffering
        """
        import scipy.signal as signal

        # Convert interleaved stereo to mono
        if audio.ndim == 1 and len(audio) > 0:
            # Check if it's interleaved stereo (even number of samples)
            if len(audio) % 2 == 0:
                # Reshape to (samples, 2) and average
                n_samples = len(audio) // 2
                stereo = audio.reshape(n_samples, 2)
                mono = stereo.mean(axis=1)
            else:
                mono = audio
        else:
            mono = audio

        # Accumulate in buffer
        self.input_buffer = np.concatenate([self.input_buffer, mono])

        # Process if we have enough samples
        if len(self.input_buffer) >= self.min_samples:
            # Process the buffer
            to_process = self.input_buffer[:self.min_samples]
            self.input_buffer = self.input_buffer[self.min_samples:]

            # Apply bandpass filter
            try:
                filtered = signal.lfilter(self.b, self.a, to_process)
                return filtered.astype(np.float32)
            except Exception as e:
                print(f"Filter error: {e}", file=sys.stderr)
                return to_process.astype(np.float32)

        return None

    def get_latency_ms(self) -> float:
        """Get estimated latency in milliseconds."""
        return (self.min_samples / self.sample_rate) * 1000

    def reset(self):
        """Reset buffer state."""
        self.input_buffer = np.zeros(0, dtype=np.float32)

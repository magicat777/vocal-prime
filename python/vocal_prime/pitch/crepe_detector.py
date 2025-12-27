"""
CREPE Neural Pitch Detector
"""

import asyncio
from typing import Dict


class CREPEDetector:
    """
    Neural network pitch detector using CREPE.
    Returns pitch contour with confidence scores.
    """

    def __init__(self, model_capacity: str = 'full'):
        """
        Initialize CREPE pitch detector.

        Args:
            model_capacity: 'tiny', 'small', 'medium', 'large', or 'full'
        """
        self.model_capacity = model_capacity

    async def detect(
        self,
        audio_path: str,
        hop_size: float = 0.01,
        min_freq: float = 50.0,
        max_freq: float = 2000.0
    ) -> Dict:
        """
        Detect pitch using CREPE neural network.

        Args:
            audio_path: Path to audio file
            hop_size: Hop size in seconds (default 10ms)
            min_freq: Minimum frequency to detect (Hz)
            max_freq: Maximum frequency to detect (Hz)

        Returns:
            Dict with timestamps, frequencies, confidence, voiced flags
        """
        loop = asyncio.get_event_loop()

        result = await loop.run_in_executor(
            None,
            self._detect_sync,
            audio_path,
            hop_size,
            min_freq,
            max_freq
        )

        return result

    def _detect_sync(
        self,
        audio_path: str,
        hop_size: float,
        min_freq: float,
        max_freq: float
    ) -> Dict:
        """Synchronous detection (runs in thread pool)."""
        import crepe
        import librosa
        import numpy as np

        # Load audio at 16kHz (CREPE's expected sample rate)
        audio, sr = librosa.load(audio_path, sr=16000, mono=True)

        # Run CREPE
        time, frequency, confidence, activation = crepe.predict(
            audio,
            sr,
            model_capacity=self.model_capacity,
            step_size=int(hop_size * 1000),  # Convert to ms
            viterbi=True
        )

        # Apply frequency range filter
        valid_mask = (frequency >= min_freq) & (frequency <= max_freq)
        voiced = (confidence > 0.5) & valid_mask

        return {
            'timestamps': time.tolist(),
            'frequencies': frequency.tolist(),
            'confidence': confidence.tolist(),
            'voiced': voiced.astype(int).tolist(),
            'hopSize': hop_size,
            'sampleRate': sr
        }

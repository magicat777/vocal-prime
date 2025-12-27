"""
Demucs v4 Wrapper for Source Separation
"""

import asyncio
from pathlib import Path
from typing import List, Dict, Optional, Callable


class DemucsWrapper:
    """
    Wrapper for Demucs v4 source separation.
    GPU acceleration required for acceptable performance.
    """

    def __init__(self, model_name: str = 'htdemucs'):
        self.model_name = model_name
        self._separator = None

    def _load_model(self):
        """Lazy-load Demucs model."""
        if self._separator is None:
            import demucs.api
            self._separator = demucs.api.Separator(model=self.model_name)
        return self._separator

    async def separate(
        self,
        audio_path: str,
        stems: List[str] = ['vocals'],
        quality: str = 'normal',
        progress_callback: Optional[Callable[[float, str], None]] = None
    ) -> Dict:
        """
        Separate audio into stems using Demucs v4.

        Args:
            audio_path: Path to input audio file
            stems: List of stems to extract ['vocals', 'drums', 'bass', 'other']
            quality: 'fast', 'normal', or 'high'
            progress_callback: Optional callback for progress updates

        Returns:
            Dict with stem paths and metadata
        """
        loop = asyncio.get_event_loop()

        # Report starting
        if progress_callback:
            progress_callback(0, 'Loading model')

        result = await loop.run_in_executor(
            None,
            self._separate_sync,
            audio_path,
            stems,
            quality,
            progress_callback
        )

        return result

    def _separate_sync(
        self,
        audio_path: str,
        stems: List[str],
        quality: str,
        progress_callback: Optional[Callable[[float, str], None]] = None
    ) -> Dict:
        """Synchronous separation (runs in thread pool)."""
        import torch
        import numpy as np

        separator = self._load_model()

        # Configure based on quality
        if quality == 'fast':
            shifts = 1
            overlap = 0.1
        elif quality == 'high':
            shifts = 5
            overlap = 0.5
        else:  # normal
            shifts = 2
            overlap = 0.25

        if progress_callback:
            progress_callback(10, 'Loading audio')

        # Load and separate
        origin, separated = separator.separate_audio_file(
            Path(audio_path),
            shifts=shifts,
            overlap=overlap
        )

        if progress_callback:
            progress_callback(80, 'Extracting stems')

        # Extract requested stems
        result = {
            'stems': {},
            'sampleRate': 44100,  # Demucs output sample rate
        }

        for stem_name, stem_audio in separated.items():
            if stem_name in stems:
                # Convert to numpy
                if isinstance(stem_audio, torch.Tensor):
                    audio_np = stem_audio.cpu().numpy()
                else:
                    audio_np = np.array(stem_audio)

                # Flatten to mono for now (average channels)
                if len(audio_np.shape) > 1:
                    audio_mono = audio_np.mean(axis=0)
                else:
                    audio_mono = audio_np

                result['stems'][stem_name] = {
                    'samples': audio_mono.tolist(),
                    'duration': len(audio_mono) / 44100,
                }

        if progress_callback:
            progress_callback(100, 'Complete')

        return result

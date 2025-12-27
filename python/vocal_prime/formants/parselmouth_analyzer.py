"""
Parselmouth Formant Analyzer
Uses Praat algorithms via Parselmouth bindings
"""

import asyncio
from typing import Dict
import numpy as np


class ParselmouthAnalyzer:
    """
    Formant analysis using Parselmouth (Praat bindings).
    Extracts F1-F4 formant trajectories.
    """

    def __init__(self, max_formants: int = 4):
        self.max_formants = max_formants

    async def analyze(
        self,
        audio_path: str,
        max_formants: int = 4,
        window_length: float = 0.025,
        hop_size: float = 0.01
    ) -> Dict:
        """
        Extract formants using Parselmouth (Praat bindings).

        Args:
            audio_path: Path to audio file
            max_formants: Maximum number of formants to extract (default 4)
            window_length: Analysis window length in seconds
            hop_size: Hop size in seconds

        Returns:
            Dict with F1-F4 trajectories and bandwidths
        """
        loop = asyncio.get_event_loop()

        result = await loop.run_in_executor(
            None,
            self._analyze_sync,
            audio_path,
            max_formants,
            window_length,
            hop_size
        )

        return result

    def _analyze_sync(
        self,
        audio_path: str,
        max_formants: int,
        window_length: float,
        hop_size: float
    ) -> Dict:
        """Synchronous analysis (runs in thread pool)."""
        import parselmouth

        # Load sound
        sound = parselmouth.Sound(audio_path)

        # Create formant object using Burg algorithm
        formant = sound.to_formant_burg(
            time_step=hop_size,
            max_number_of_formants=max_formants,
            window_length=window_length,
            pre_emphasis_from=50.0
        )

        # Extract formant trajectories
        n_frames = formant.n_frames
        timestamps = np.array([
            formant.get_time_from_frame_number(i + 1)
            for i in range(n_frames)
        ])

        formants_data = {
            'timestamps': timestamps.tolist(),
            'formants': {}
        }

        for f_num in range(1, max_formants + 1):
            frequencies = []
            bandwidths = []

            for i in range(n_frames):
                f = formant.get_value_at_time(f_num, timestamps[i])
                b = formant.get_bandwidth_at_time(f_num, timestamps[i])
                frequencies.append(f if not np.isnan(f) else 0)
                bandwidths.append(b if not np.isnan(b) else 0)

            formants_data['formants'][f'F{f_num}'] = {
                'frequencies': frequencies,
                'bandwidths': bandwidths
            }

        return formants_data

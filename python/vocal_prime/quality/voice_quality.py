"""
Voice Quality Analyzer
Calculates jitter, shimmer, and harmonics-to-noise ratio
"""

import asyncio
from typing import Dict


class VoiceQualityAnalyzer:
    """
    Voice quality metrics using Parselmouth/Praat algorithms.
    Calculates jitter, shimmer, and HNR.
    """

    async def analyze(
        self,
        audio_path: str,
        pitch_floor: float = 75.0,
        pitch_ceiling: float = 600.0
    ) -> Dict:
        """
        Calculate voice quality metrics.

        Args:
            audio_path: Path to audio file
            pitch_floor: Minimum pitch for analysis (Hz)
            pitch_ceiling: Maximum pitch for analysis (Hz)

        Returns:
            Dict with jitter, shimmer, and HNR values
        """
        loop = asyncio.get_event_loop()

        result = await loop.run_in_executor(
            None,
            self._analyze_sync,
            audio_path,
            pitch_floor,
            pitch_ceiling
        )

        return result

    def _analyze_sync(
        self,
        audio_path: str,
        pitch_floor: float,
        pitch_ceiling: float
    ) -> Dict:
        """Synchronous analysis (runs in thread pool)."""
        import parselmouth
        from parselmouth.praat import call

        # Load sound
        sound = parselmouth.Sound(audio_path)

        # Extract pitch for period analysis
        pitch = sound.to_pitch(
            pitch_floor=pitch_floor,
            pitch_ceiling=pitch_ceiling
        )

        # Create PointProcess for period detection
        point_process = call([sound, pitch], "To PointProcess (cc)")

        # Calculate jitter variants
        try:
            jitter_local = call(
                point_process, "Get jitter (local)",
                0, 0, 0.0001, 0.02, 1.3
            )
        except Exception:
            jitter_local = 0.0

        try:
            jitter_rap = call(
                point_process, "Get jitter (rap)",
                0, 0, 0.0001, 0.02, 1.3
            )
        except Exception:
            jitter_rap = 0.0

        try:
            jitter_ppq5 = call(
                point_process, "Get jitter (ppq5)",
                0, 0, 0.0001, 0.02, 1.3
            )
        except Exception:
            jitter_ppq5 = 0.0

        # Calculate shimmer variants
        try:
            shimmer_local = call(
                [sound, point_process], "Get shimmer (local)",
                0, 0, 0.0001, 0.02, 1.3, 1.6
            )
        except Exception:
            shimmer_local = 0.0

        try:
            shimmer_apq3 = call(
                [sound, point_process], "Get shimmer (apq3)",
                0, 0, 0.0001, 0.02, 1.3, 1.6
            )
        except Exception:
            shimmer_apq3 = 0.0

        try:
            shimmer_apq5 = call(
                [sound, point_process], "Get shimmer (apq5)",
                0, 0, 0.0001, 0.02, 1.3, 1.6
            )
        except Exception:
            shimmer_apq5 = 0.0

        # Calculate HNR
        try:
            harmonicity = call(
                sound, "To Harmonicity (cc)",
                0.01, pitch_floor, 0.1, 1.0
            )
            hnr = call(harmonicity, "Get mean", 0, 0)
        except Exception:
            hnr = 0.0

        return {
            'jitter': {
                'local': jitter_local * 100 if jitter_local else 0,
                'rap': jitter_rap * 100 if jitter_rap else 0,
                'ppq5': jitter_ppq5 * 100 if jitter_ppq5 else 0
            },
            'shimmer': {
                'local': shimmer_local * 100 if shimmer_local else 0,
                'apq3': shimmer_apq3 * 100 if shimmer_apq3 else 0,
                'apq5': shimmer_apq5 * 100 if shimmer_apq5 else 0
            },
            'hnr': hnr if hnr else 0
        }

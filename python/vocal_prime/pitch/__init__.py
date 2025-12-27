"""
VOCAL_PRIME - Pitch Detection Module

Provides multiple pitch detection algorithms:
- CREPEDetector: File-based neural pitch detection
- TorchCREPEDetector: GPU-accelerated streaming pitch
- MelodiaDetector: Polyphonic melody extraction
- HybridPitchDetector: Auto-switching between algorithms
"""

from .crepe_detector import CREPEDetector
from .streaming_pitch import TorchCREPEDetector, MelodiaDetector, HybridPitchDetector

__all__ = [
    'CREPEDetector',
    'TorchCREPEDetector',
    'MelodiaDetector',
    'HybridPitchDetector'
]

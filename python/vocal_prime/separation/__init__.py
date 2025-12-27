"""
VOCAL_PRIME - Source Separation Module
Uses Demucs v4 for vocal extraction
Supports both file-based and real-time streaming separation.
"""

from .demucs_wrapper import DemucsWrapper
from .streaming_separator import StreamingSeparator, LightweightSeparator

__all__ = ['DemucsWrapper', 'StreamingSeparator', 'LightweightSeparator']

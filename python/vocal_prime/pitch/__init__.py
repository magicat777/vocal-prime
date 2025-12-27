"""
VOCAL_PRIME - Pitch Detection Module
Uses CREPE neural network for accurate pitch tracking
"""

from .crepe_detector import CREPEDetector

__all__ = ['CREPEDetector']

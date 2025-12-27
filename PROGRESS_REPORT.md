# VOCAL_PRIME Progress Report

**Date:** December 26, 2024
**Session Focus:** Musical Vocal Analysis Redesign & Pitch Detection

---

## Completed Work

### 1. Architecture Redesign: Clinical → Musical Metrics

Removed clinical voice quality metrics (jitter, shimmer, HNR) and replaced with musical vocal metrics relevant to singers and audio mastering:

- **Presence** (0-100%): Vocal cut-through measured as 1-5kHz energy ratio
- **Vibrato**: FFT-based detection of 4-8Hz pitch modulation with rate (Hz) and extent (semitones)
- **Dynamics** (0-100%): Short-term loudness variation for expressive delivery
- **Clarity** (0-100%): Harmonic clarity scaled for music
- **Intensity** (0-100%): Overall vocal power

### 2. Vibrato Detection System

Implemented sophisticated vibrato detection independent of melody tracking:

- **High-pass filtering**: Removes melody drift, isolates true vibrato oscillation
- **Separate pitch history**: Local autocorrelation for vibrato (independent of Melodia)
- **Jump filter**: Excludes tracking errors > 50 cents on mixed audio
- **3-second hold display**: Keeps vibrato metrics visible after detection stops

### 3. Streaming Pitch Detection (Python GPU Backend)

Implemented real-time pitch detection with multiple algorithms:

#### Melodia (Polyphonic)
- Extended frequency range: 55-1800 Hz (bass to high soprano)
- Larger buffer (85ms) for fewer breaks in tracking
- Tuned parameters: higher timeContinuity (80), lower thresholds (0.7)
- Best for: Mixed audio with instruments

#### CREPE (GPU-Accelerated)
- Fixed model selection: `tiny` model (only `tiny` and `full` supported)
- 50% buffer overlap for more frequent output
- Low voicing threshold (0.15) for mixed audio
- Best for: Clean vocals with high accuracy

#### Auto Mode
- Tries CREPE first, falls back to Melodia on low confidence
- Both detectors initialize regardless of mode for reliable switching

### 4. Pitch Panel Improvements

- **Extended range**: 50-2200 Hz (covers whistle register up to C7)
- **Reference lines**: C2 through C7, plus A notes and E6
- **Confidence bar**: Labeled "CONF" with percentage, color-coded (green/yellow/red)
- **Mode switching**: Properly stops old stream before starting new mode

### 5. Source Separation Integration

- Streaming separator with Demucs (full) and lightweight (bandpass) modes
- IPC handlers for real-time vocal isolation
- Separated vocals buffer for improved voice quality analysis

---

## Files Modified/Created

### New Files
- `src/core/VocalEngine.ts` - Central audio coordination with musical metrics
- `src/components/panels/VocalMetricsPanel.svelte` - Real-time vocal metrics display
- `python/vocal_prime/pitch/streaming_pitch.py` - TorchCREPE and Melodia hybrid detector
- `python/vocal_prime/separation/streaming_separator.py` - Demucs streaming wrapper
- `src/types/global.d.ts` - TypeScript declarations for Electron API

### Modified Files
- `electron/main.ts` - IPC handlers for pitch/separation streaming
- `electron/preload.ts` - Context bridge for new APIs
- `src/components/panels/PitchPanel.svelte` - Extended range, confidence display
- `src/App.svelte` - Updated panel layout

### Deleted Files
- `python/vocal_prime/quality/` - Removed clinical metrics (jitter/shimmer/HNR)

---

## Current Commit History

```
de6b2bf Fix CREPE pitch detection for mixed audio
9881a5a Improve pitch detection range and mode switching
55f7be1 Add vibrato hold display and extend pitch panel range
e1687c8 Redesign for musical vocal analysis with real-time streaming
```

---

## Known Issues & Future Work

### HIGH PRIORITY: Formant Panel Review

**Issue:** The formant detection hasn't been updated and may need recalculation based on changes made to signal detection in other panels.

**Tasks:**
- [ ] Review formant estimation algorithm in `VocalEngine.ts`
- [ ] Verify formant frequency ranges are appropriate for musical vocals
- [ ] Consider using separated vocals for cleaner formant detection
- [ ] Update formant panel visualization if needed

### PLANNED: Spectrum Panel Enhancements

**Feature Requests:**
1. **Adjustable FFT Size**
   - [ ] Add dropdown/slider for FFT size (1024, 2048, 4096, 8192)
   - [ ] Trade-off: larger = better frequency resolution, worse time resolution
   - [ ] Update frequency bin calculations dynamically

2. **A-Weighting Filter**
   - [ ] Implement A-weighting curve (IEC 61672:2003)
   - [ ] Applies frequency-dependent gain matching human hearing sensitivity
   - [ ] Toggle button in spectrum panel header

3. **Perceptual Bias Weighting**
   - [ ] Research and implement psychoacoustic weighting curves
   - [ ] Options: A-weighting, C-weighting, K-weighting (ITU-R BS.1770)
   - [ ] Consider equal-loudness contours (ISO 226:2003)

### Other Considerations

- [ ] CREPE `full` model option for higher accuracy (at cost of latency)
- [ ] Pitch history visualization improvements
- [ ] Vibrato waveform display in metrics panel
- [ ] Export metrics to file for analysis

---

## Technical Notes

### Pitch Detection Update Rates
- Local autocorrelation: ~50 Hz (from FFT hop rate)
- Melodia: ~12-24 Hz (depends on buffer size)
- CREPE: ~20-40 Hz (depends on buffer overlap)

### Vibrato Detection Parameters
- Rate range: 4-8 Hz (typical singing vibrato)
- Extent range: 0.1-4 semitones
- Local window: 16 samples (~320ms) for high-pass filtering
- FFT size: 128 points for pitch contour analysis

### Confidence Thresholds
- Melodia: Reports confidence 0.01-0.15 on mixed audio (very low)
- CREPE: Reports confidence 0.15-0.65 on mixed audio
- CREPE voicing threshold: 0.15 (lowered for mixed audio tolerance)

---

## Session End Notes

Excellent progress on the vocal analysis redesign. The core musical metrics are working well, with vibrato detection now functioning correctly on Taylor Swift vocals. CREPE and Auto modes are operational with good pitch tracking.

Next session should focus on:
1. Formant panel review and potential updates
2. Spectrum panel FFT and weighting features
3. Testing with various vocal styles and ranges

"""
VOCAL_PRIME - Analysis Server Entry Point
Supports both file-based and real-time streaming analysis.
"""

import sys
import json
import asyncio
import base64
import numpy as np
from typing import Dict, Any, Optional

# Check CUDA availability
try:
    import torch
    CUDA_AVAILABLE = torch.cuda.is_available()
    if CUDA_AVAILABLE:
        print(f"CUDA available: {torch.cuda.get_device_name(0)}", file=sys.stderr)
    else:
        print("WARNING: CUDA not available, using CPU (slower)", file=sys.stderr)
except ImportError:
    CUDA_AVAILABLE = False
    print("ERROR: PyTorch not installed", file=sys.stderr)


class AnalysisServer:
    """
    JSON-based IPC server for voice analysis.
    Reads requests from stdin, writes responses to stdout.
    Supports both file analysis and real-time streaming.
    """

    def __init__(self):
        self.handlers: Dict[str, Any] = {
            # File-based analysis
            'separation:start': self.handle_separation,
            'separation:cancel': self.handle_separation_cancel,
            'pitch:analyze': self.handle_pitch,
            'formant:analyze': self.handle_formant,
            'vibrato:analyze': self.handle_vibrato,

            # Real-time streaming (source separation)
            'stream:start': self.handle_stream_start,
            'stream:audio': self.handle_stream_audio,
            'stream:stop': self.handle_stream_stop,

            # Real-time streaming (pitch detection)
            'pitch:start': self.handle_pitch_start,
            'pitch:stream': self.handle_pitch_stream,
            'pitch:stop': self.handle_pitch_stop,
            'pitch:set_mode': self.handle_pitch_set_mode,

            # Real-time streaming (formant detection)
            'formant:start': self.handle_formant_start,
            'formant:stream': self.handle_formant_stream,
            'formant:stop': self.handle_formant_stop,

            # Analysis mode control
            'analysis:use_separated': self.handle_use_separated,
        }

        self.active_tasks: Dict[str, Any] = {}

        # Lazy-load analyzers
        self._separator = None
        self._streaming_separator = None
        self._pitch_detector = None
        self._streaming_pitch_detector = None
        self._formant_analyzer = None

        # Streaming state
        self._streaming_active = False
        self._stream_mode = 'full'  # 'full' (Demucs) or 'light' (bandpass)

        # Streaming pitch state
        self._pitch_streaming_active = False
        self._pitch_mode = 'auto'  # 'auto', 'crepe', 'melodia'

        # Streaming formant state
        self._formant_streaming_active = False
        self._streaming_formant_detector = None

        # Use separated vocals for pitch/formant analysis (cleaner signal)
        self._use_separated_vocals = False
        self._separated_vocals_for_pitch = None  # Buffer for feeding to pitch
        self._separated_vocals_for_formant = None  # Buffer for feeding to formant

    @property
    def separator(self):
        if self._separator is None:
            from .separation import DemucsWrapper
            self._separator = DemucsWrapper()
        return self._separator

    @property
    def streaming_separator(self):
        if self._streaming_separator is None:
            from .separation.streaming_separator import StreamingSeparator, LightweightSeparator
            if self._stream_mode == 'full' and CUDA_AVAILABLE:
                print("Initializing Demucs streaming separator...", file=sys.stderr)
                self._streaming_separator = StreamingSeparator(
                    model_name="htdemucs",
                    sample_rate=48000,
                    chunk_duration=1.5,    # Reduced from 2.0 for lower latency
                    overlap=0.5            # 50% overlap gives 0.75s hop
                )
            else:
                print("Initializing lightweight separator...", file=sys.stderr)
                self._streaming_separator = LightweightSeparator(
                    sample_rate=48000
                )
        return self._streaming_separator

    @property
    def pitch_detector(self):
        if self._pitch_detector is None:
            from .pitch import CREPEDetector
            self._pitch_detector = CREPEDetector()
        return self._pitch_detector

    @property
    def streaming_pitch_detector(self):
        if self._streaming_pitch_detector is None:
            from .pitch import HybridPitchDetector
            print(f"Initializing streaming pitch detector in '{self._pitch_mode}' mode...", file=sys.stderr)
            self._streaming_pitch_detector = HybridPitchDetector(
                mode=self._pitch_mode,
                sample_rate=48000
            )
        return self._streaming_pitch_detector

    @property
    def formant_analyzer(self):
        if self._formant_analyzer is None:
            from .formants import ParselmouthAnalyzer
            self._formant_analyzer = ParselmouthAnalyzer()
        return self._formant_analyzer

    @property
    def streaming_formant_detector(self):
        if self._streaming_formant_detector is None:
            from .formants import StreamingFormantDetector
            print("Initializing streaming formant detector...", file=sys.stderr)
            self._streaming_formant_detector = StreamingFormantDetector(
                sample_rate=48000,
                max_formants=4,
                window_length=0.025,  # 25ms
                hop_size=0.010        # 10ms hop for smooth updates
            )
        return self._streaming_formant_detector

    def send_message(self, message: dict):
        """Send JSON message to stdout for Electron."""
        print(json.dumps(message), flush=True)

    async def handle_stream_start(self, task_id: str, payload: dict) -> dict:
        """Start real-time streaming mode."""
        self._stream_mode = payload.get('mode', 'full')
        self._streaming_active = True

        # Reset separator if mode changed
        self._streaming_separator = None

        # Pre-initialize the separator
        _ = self.streaming_separator

        latency = self.streaming_separator.get_latency_ms() if hasattr(self.streaming_separator, 'get_latency_ms') else 50

        print(f"Streaming started in {self._stream_mode} mode", file=sys.stderr)

        return {
            'taskId': task_id,
            'status': 'started',
            'mode': self._stream_mode,
            'estimatedLatencyMs': latency
        }

    async def handle_stream_audio(self, task_id: str, payload: dict) -> dict:
        """Process streaming audio chunk."""
        if not self._streaming_active:
            return {'taskId': task_id, 'error': 'Streaming not active'}

        # Decode audio data (base64 encoded float32 samples)
        audio_b64 = payload.get('audio', '')
        if not audio_b64:
            return {'taskId': task_id, 'error': 'No audio data'}

        try:
            audio_bytes = base64.b64decode(audio_b64)
            audio = np.frombuffer(audio_bytes, dtype=np.float32)

            # Process through separator
            vocals = self.streaming_separator.process_chunk(audio)

            if vocals is not None:
                # Encode output
                vocals_b64 = base64.b64encode(vocals.astype(np.float32).tobytes()).decode('ascii')

                latency = self.streaming_separator.get_latency_ms() if hasattr(self.streaming_separator, 'get_latency_ms') else 0

                # Send separated vocals back
                self.send_message({
                    'type': 'stream:vocals',
                    'payload': {
                        'taskId': task_id,
                        'vocals': vocals_b64,
                        'samples': len(vocals),
                        'latencyMs': latency
                    }
                })

                # TODO: Feeding separated vocals to detectors causes buffer conflicts
                # when both raw and separated audio hit the same detector.
                # Need to implement exclusive routing (skip raw when SEP is ON).
                # For now, just send separated vocals to frontend for visualization.
                # if self._use_separated_vocals and self._pitch_streaming_active:
                #     await self._process_vocals_for_pitch(task_id, vocals)
                # if self._use_separated_vocals and self._formant_streaming_active:
                #     await self._process_vocals_for_formant(task_id, vocals)

            return {'taskId': task_id, 'status': 'processed', 'buffered': vocals is None}

        except Exception as e:
            print(f"Stream processing error: {e}", file=sys.stderr)
            return {'taskId': task_id, 'error': str(e)}

    async def handle_stream_stop(self, task_id: str, payload: dict) -> dict:
        """Stop streaming mode."""
        self._streaming_active = False

        if self._streaming_separator and hasattr(self._streaming_separator, 'reset'):
            self._streaming_separator.reset()

        print("Streaming stopped", file=sys.stderr)

        return {
            'taskId': task_id,
            'status': 'stopped'
        }

    async def _process_vocals_for_pitch(self, task_id: str, vocals: np.ndarray):
        """Feed separated vocals to pitch detector."""
        try:
            # Convert to mono if needed (vocals from Demucs are usually mono or need conversion)
            if vocals.ndim > 1:
                mono = vocals.mean(axis=0).astype(np.float32)
            else:
                mono = vocals.astype(np.float32)

            print(f"[SEP→Pitch] Processing {len(mono)} samples", file=sys.stderr)

            # Process through pitch detector
            result = self.streaming_pitch_detector.process_chunk(mono)

            if result is not None:
                latency = self.streaming_pitch_detector.get_latency_ms()

                # Send pitch data back (with marker that it's from separated vocals)
                self.send_message({
                    'type': 'pitch:data',
                    'payload': {
                        'taskId': task_id,
                        'frequency': result['frequency'],
                        'confidence': result['confidence'],
                        'voiced': result['voiced'],
                        'algorithm': result.get('algorithm', 'unknown') + '_sep',
                        'latencyMs': latency,
                        'fromSeparated': True
                    }
                })

        except Exception as e:
            print(f"Vocals→Pitch error: {e}", file=sys.stderr)

    async def _process_vocals_for_formant(self, task_id: str, vocals: np.ndarray):
        """Feed separated vocals to formant detector."""
        try:
            # Convert to mono if needed
            if vocals.ndim > 1:
                mono = vocals.mean(axis=0).astype(np.float32)
            else:
                mono = vocals.astype(np.float32)

            # Process through formant detector
            result = self.streaming_formant_detector.process_chunk(mono)

            if result is not None:
                latency = self.streaming_formant_detector.get_latency_ms()

                # Send formant data back (with marker that it's from separated vocals)
                self.send_message({
                    'type': 'formant:data',
                    'payload': {
                        'taskId': task_id,
                        'F1': result['F1'],
                        'F2': result['F2'],
                        'F3': result['F3'],
                        'F4': result['F4'],
                        'B1': result.get('B1', 0),
                        'B2': result.get('B2', 0),
                        'B3': result.get('B3', 0),
                        'B4': result.get('B4', 0),
                        'detected': result['detected'],
                        'latencyMs': latency,
                        'fromSeparated': True
                    }
                })

        except Exception as e:
            print(f"Vocals→Formant error: {e}", file=sys.stderr)

    async def handle_separation(self, task_id: str, payload: dict) -> dict:
        """Handle source separation request."""
        source = payload.get('source', '')
        models = payload.get('models', ['vocals'])
        quality = payload.get('quality', 'normal')

        # Progress callback
        def on_progress(percent: float, stage: str):
            self.send_message({
                'type': 'separation:progress',
                'payload': {
                    'taskId': task_id,
                    'percent': percent,
                    'stage': stage
                }
            })

        result = await self.separator.separate(
            audio_path=source,
            stems=models,
            quality=quality,
            progress_callback=on_progress
        )

        return {
            'taskId': task_id,
            **result
        }

    async def handle_separation_cancel(self, task_id: str, payload: dict) -> dict:
        """Cancel separation task."""
        if task_id in self.active_tasks:
            # TODO: Implement cancellation
            pass
        return {'taskId': task_id, 'cancelled': True}

    async def handle_pitch(self, task_id: str, payload: dict) -> dict:
        """Handle pitch detection request."""
        source = payload.get('source', '')
        algorithm = payload.get('algorithm', 'crepe')
        hop_size = payload.get('hopSize', 0.01)
        min_freq = payload.get('minFreq', 50)
        max_freq = payload.get('maxFreq', 2000)

        result = await self.pitch_detector.detect(
            audio_path=source,
            hop_size=hop_size,
            min_freq=min_freq,
            max_freq=max_freq
        )

        return {
            'taskId': task_id,
            **result
        }

    async def handle_formant(self, task_id: str, payload: dict) -> dict:
        """Handle formant analysis request."""
        source = payload.get('source', '')
        max_formants = payload.get('maxFormants', 4)
        window_length = payload.get('windowLength', 0.025)
        hop_size = payload.get('hopSize', 0.01)

        result = await self.formant_analyzer.analyze(
            audio_path=source,
            max_formants=max_formants,
            window_length=window_length,
            hop_size=hop_size
        )

        return {
            'taskId': task_id,
            **result
        }

    async def handle_vibrato(self, task_id: str, payload: dict) -> dict:
        """Handle vibrato analysis request."""
        pitch_contour = payload.get('pitchContour', [])
        timestamps = payload.get('timestamps', [])

        # TODO: Implement vibrato analysis
        return {
            'taskId': task_id,
            'rate': 0,
            'extent': 0,
            'regularity': 0,
            'detected': False
        }

    # =========================================================================
    # Streaming Pitch Detection Handlers
    # =========================================================================

    async def handle_pitch_start(self, task_id: str, payload: dict) -> dict:
        """Start real-time streaming pitch detection."""
        mode = payload.get('mode', 'auto')  # 'auto', 'crepe', 'melodia'
        self._pitch_mode = mode
        self._pitch_streaming_active = True

        # Reset detector if mode changed
        self._streaming_pitch_detector = None

        # Pre-initialize the detector
        _ = self.streaming_pitch_detector

        latency = self.streaming_pitch_detector.get_latency_ms()

        print(f"Streaming pitch detection started in '{mode}' mode", file=sys.stderr)

        return {
            'taskId': task_id,
            'status': 'started',
            'mode': mode,
            'estimatedLatencyMs': latency
        }

    async def handle_pitch_stream(self, task_id: str, payload: dict) -> dict:
        """Process streaming audio chunk for pitch detection."""
        if not self._pitch_streaming_active:
            return {'taskId': task_id, 'error': 'Pitch streaming not active'}

        # Decode audio data (base64 encoded float32 samples)
        audio_b64 = payload.get('audio', '')
        if not audio_b64:
            return {'taskId': task_id, 'error': 'No audio data'}

        try:
            audio_bytes = base64.b64decode(audio_b64)
            audio = np.frombuffer(audio_bytes, dtype=np.float32)

            # Convert stereo to mono if needed
            if len(audio) % 2 == 0:
                # Assume interleaved stereo
                n_samples = len(audio) // 2
                stereo = audio.reshape(n_samples, 2)
                mono = stereo.mean(axis=1).astype(np.float32)
            else:
                mono = audio

            # Process through pitch detector
            result = self.streaming_pitch_detector.process_chunk(mono)

            if result is not None:
                latency = self.streaming_pitch_detector.get_latency_ms()

                # Debug: log pitch updates occasionally
                import random
                if random.random() < 0.05:
                    print(f"[Pitch] freq={result['frequency']:.1f}Hz conf={result['confidence']:.2f} voiced={result['voiced']}", file=sys.stderr)

                # Send pitch data back
                self.send_message({
                    'type': 'pitch:data',
                    'payload': {
                        'taskId': task_id,
                        'frequency': result['frequency'],
                        'confidence': result['confidence'],
                        'voiced': result['voiced'],
                        'algorithm': result.get('algorithm', 'unknown'),
                        'latencyMs': latency
                    }
                })

            return {'taskId': task_id, 'status': 'processed', 'buffered': result is None}

        except Exception as e:
            import traceback
            print(f"Pitch stream error: {traceback.format_exc()}", file=sys.stderr)
            return {'taskId': task_id, 'error': str(e)}

    async def handle_pitch_stop(self, task_id: str, payload: dict) -> dict:
        """Stop streaming pitch detection."""
        self._pitch_streaming_active = False

        if self._streaming_pitch_detector:
            self._streaming_pitch_detector.reset()

        print("Streaming pitch detection stopped", file=sys.stderr)

        return {
            'taskId': task_id,
            'status': 'stopped'
        }

    async def handle_pitch_set_mode(self, task_id: str, payload: dict) -> dict:
        """Change pitch detection algorithm mode."""
        mode = payload.get('mode', 'auto')

        if mode not in ['auto', 'crepe', 'melodia']:
            return {'taskId': task_id, 'error': f'Invalid mode: {mode}'}

        self._pitch_mode = mode

        if self._streaming_pitch_detector:
            self._streaming_pitch_detector.set_mode(mode)

        print(f"Pitch detection mode changed to: {mode}", file=sys.stderr)

        return {
            'taskId': task_id,
            'status': 'mode_changed',
            'mode': mode
        }

    # =========================================================================
    # Streaming Formant Detection Handlers
    # =========================================================================

    async def handle_formant_start(self, task_id: str, payload: dict) -> dict:
        """Start real-time streaming formant detection."""
        self._formant_streaming_active = True

        # Reset detector if exists
        self._streaming_formant_detector = None

        # Pre-initialize the detector
        _ = self.streaming_formant_detector

        latency = self.streaming_formant_detector.get_latency_ms()

        print(f"Streaming formant detection started", file=sys.stderr)

        return {
            'taskId': task_id,
            'status': 'started',
            'estimatedLatencyMs': latency
        }

    async def handle_formant_stream(self, task_id: str, payload: dict) -> dict:
        """Process streaming audio chunk for formant detection."""
        if not self._formant_streaming_active:
            return {'taskId': task_id, 'error': 'Formant streaming not active'}

        # Decode audio data (base64 encoded float32 samples)
        audio_b64 = payload.get('audio', '')
        if not audio_b64:
            return {'taskId': task_id, 'error': 'No audio data'}

        try:
            audio_bytes = base64.b64decode(audio_b64)
            audio = np.frombuffer(audio_bytes, dtype=np.float32)

            # Convert stereo to mono if needed
            if len(audio) % 2 == 0:
                # Assume interleaved stereo
                n_samples = len(audio) // 2
                stereo = audio.reshape(n_samples, 2)
                mono = stereo.mean(axis=1).astype(np.float32)
            else:
                mono = audio

            # Process through formant detector
            result = self.streaming_formant_detector.process_chunk(mono)

            if result is not None:
                latency = self.streaming_formant_detector.get_latency_ms()

                # Debug: log formant updates occasionally
                import random
                if random.random() < 0.03:
                    print(f"[Formant] F1={result['F1']:.0f} F2={result['F2']:.0f} F3={result['F3']:.0f} detected={result['detected']}", file=sys.stderr)

                # Send formant data back
                self.send_message({
                    'type': 'formant:data',
                    'payload': {
                        'taskId': task_id,
                        'F1': result['F1'],
                        'F2': result['F2'],
                        'F3': result['F3'],
                        'F4': result['F4'],
                        'B1': result.get('B1', 0),
                        'B2': result.get('B2', 0),
                        'B3': result.get('B3', 0),
                        'B4': result.get('B4', 0),
                        'detected': result['detected'],
                        'latencyMs': latency
                    }
                })

            return {'taskId': task_id, 'status': 'processed', 'buffered': result is None}

        except Exception as e:
            import traceback
            print(f"Formant stream error: {traceback.format_exc()}", file=sys.stderr)
            return {'taskId': task_id, 'error': str(e)}

    async def handle_formant_stop(self, task_id: str, payload: dict) -> dict:
        """Stop streaming formant detection."""
        self._formant_streaming_active = False

        if self._streaming_formant_detector:
            self._streaming_formant_detector.reset()

        print("Streaming formant detection stopped", file=sys.stderr)

        return {
            'taskId': task_id,
            'status': 'stopped'
        }

    async def handle_use_separated(self, task_id: str, payload: dict) -> dict:
        """Toggle using separated vocals for pitch/formant analysis."""
        enabled = payload.get('enabled', False)
        self._use_separated_vocals = enabled

        status = "enabled" if enabled else "disabled"
        print(f"Using separated vocals for analysis: {status}", file=sys.stderr)

        if enabled:
            print("  → Pitch and formant will now use Demucs-separated vocals", file=sys.stderr)
            print("  → Make sure streaming separation is active!", file=sys.stderr)

        return {
            'taskId': task_id,
            'status': status,
            'useSeparatedVocals': enabled
        }

    async def process_message(self, message: dict):
        """Process incoming message from Electron."""
        msg_type = message.get('type', '')
        task_id = message.get('id', '')
        payload = message.get('payload', {})

        handler = self.handlers.get(msg_type)

        if handler:
            try:
                self.active_tasks[task_id] = True
                result = await handler(task_id, payload)

                # Send result for non-streaming handlers
                if not msg_type.startswith('stream:'):
                    result_type = msg_type.replace(':start', ':result').replace(':analyze', ':result')
                    self.send_message({
                        'type': result_type,
                        'payload': result
                    })
                else:
                    # For streaming, send stream-specific result
                    self.send_message({
                        'type': f'{msg_type}:result',
                        'payload': result
                    })

            except Exception as e:
                import traceback
                print(f"Handler error: {traceback.format_exc()}", file=sys.stderr)
                self.send_message({
                    'type': 'error',
                    'payload': {
                        'taskId': task_id,
                        'error': str(e)
                    }
                })
            finally:
                if task_id in self.active_tasks:
                    del self.active_tasks[task_id]
        else:
            self.send_message({
                'type': 'error',
                'payload': {
                    'taskId': task_id,
                    'error': f'Unknown message type: {msg_type}'
                }
            })

    async def run(self):
        """Main server loop - read from stdin, process, write to stdout."""
        print("VOCAL_PRIME Analysis Server started", file=sys.stderr)

        loop = asyncio.get_event_loop()
        reader = asyncio.StreamReader()
        protocol = asyncio.StreamReaderProtocol(reader)
        await loop.connect_read_pipe(lambda: protocol, sys.stdin)

        while True:
            try:
                line = await reader.readline()
                if not line:
                    break

                message = json.loads(line.decode().strip())
                await self.process_message(message)

            except json.JSONDecodeError as e:
                print(f"Invalid JSON: {e}", file=sys.stderr)
            except Exception as e:
                import traceback
                print(f"Error processing message: {traceback.format_exc()}", file=sys.stderr)


async def main():
    server = AnalysisServer()
    await server.run()


if __name__ == '__main__':
    asyncio.run(main())

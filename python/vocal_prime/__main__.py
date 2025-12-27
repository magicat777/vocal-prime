"""
VOCAL_PRIME - Analysis Server Entry Point
"""

import sys
import json
import asyncio
from typing import Dict, Any

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
    """

    def __init__(self):
        self.handlers: Dict[str, Any] = {
            'separation:start': self.handle_separation,
            'separation:cancel': self.handle_separation_cancel,
            'pitch:analyze': self.handle_pitch,
            'formant:analyze': self.handle_formant,
            'quality:analyze': self.handle_quality,
            'vibrato:analyze': self.handle_vibrato,
        }

        self.active_tasks: Dict[str, Any] = {}

        # Lazy-load analyzers
        self._separator = None
        self._pitch_detector = None
        self._formant_analyzer = None
        self._quality_analyzer = None

    @property
    def separator(self):
        if self._separator is None:
            from .separation import DemucsWrapper
            self._separator = DemucsWrapper()
        return self._separator

    @property
    def pitch_detector(self):
        if self._pitch_detector is None:
            from .pitch import CREPEDetector
            self._pitch_detector = CREPEDetector()
        return self._pitch_detector

    @property
    def formant_analyzer(self):
        if self._formant_analyzer is None:
            from .formants import ParselmouthAnalyzer
            self._formant_analyzer = ParselmouthAnalyzer()
        return self._formant_analyzer

    @property
    def quality_analyzer(self):
        if self._quality_analyzer is None:
            from .quality import VoiceQualityAnalyzer
            self._quality_analyzer = VoiceQualityAnalyzer()
        return self._quality_analyzer

    def send_message(self, message: dict):
        """Send JSON message to stdout for Electron."""
        print(json.dumps(message), flush=True)

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

    async def handle_quality(self, task_id: str, payload: dict) -> dict:
        """Handle voice quality analysis request."""
        source = payload.get('source', '')

        result = await self.quality_analyzer.analyze(audio_path=source)

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

                # Send result
                result_type = msg_type.replace(':start', ':result').replace(':analyze', ':result')
                self.send_message({
                    'type': result_type,
                    'payload': result
                })
            except Exception as e:
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
                print(f"Error processing message: {e}", file=sys.stderr)


async def main():
    server = AnalysisServer()
    await server.run()


if __name__ == '__main__':
    asyncio.run(main())

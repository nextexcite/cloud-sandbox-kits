"""Offline helper behavior; image smoke separately validates real codecs/model."""
import contextlib
import io
import os
from pathlib import Path
import subprocess
import sys
import types
import unittest
from unittest.mock import patch
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parents[1]
media = types.ModuleType('media')
exec(compile((ROOT / 'kits/v3/media/scripts/media.py').read_text(), 'media.py', 'exec'), media.__dict__)


class MediaTests(unittest.TestCase):
    def test_descriptor_and_image_contract(self):
        manifest = (ROOT / 'kits/v3/media/media.yaml').read_text()
        for domain in ['huggingface.co', '*.huggingface.co', '*.hf.co', 'cdn-lfs*.huggingface.co',
                       'pypi.org', 'files.pythonhosted.org', 'github.com', '*.githubusercontent.com',
                       'youtube.com', '*.youtube.com', '*.googlevideo.com', '*.ytimg.com', 'youtu.be']:
            self.assertIn(domain + ':443', manifest)
        self.assertNotIn('sandbox/credential', manifest)
        self.assertIn('contentFile: ./media-context.md', manifest)
        recipe = (ROOT / 'kits/v3/media/media.dockerfile').read_text()
        for pin in ['yt-dlp==2026.10.26', 'faster-whisper==1.2.1', 'av==16.0.1', 'numpy==2.3.5']:
            self.assertIn(pin, recipe)
        self.assertIn('USER agent', recipe)

    def test_encode_codecs_and_threads(self):
        with patch.object(media, 'threads', return_value='2'), patch.object(media, 'run') as run:
            for codec, library in [('h264', 'libx264'), ('hevc', 'libx265')]:
                media.encode(['in.mov', 'out.mp4', '--codec', codec])
                args = run.call_args.args[0]
                self.assertIn(library, args)
                self.assertEqual(args[args.index('-threads') + 1], '2')

    def test_invalid_and_empty_arguments(self):
        for command in [media.encode, media.transcribe, media.fetch]:
            with self.subTest(command=command), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as result:
                    command([])
                self.assertEqual(result.exception.code, 2)

    def test_encode_propagates_failure(self):
        with patch.object(media, 'threads', return_value='2'), patch.object(
                media, 'run', side_effect=subprocess.CalledProcessError(1, 'ffmpeg')):
            with self.assertRaises(subprocess.CalledProcessError):
                media.encode(['missing', 'out.mp4'])

    def test_fetch_options_and_failure_guidance(self):
        with patch.dict(os.environ, {'YT_COOKIES_FILE': '/private/cookies', 'YT_PROXY': 'http://proxy'}), \
                patch.object(media.subprocess, 'run') as run:
            run.return_value.returncode = 0
            media.fetch(['https://example.com/video', 'out.%(ext)s', '--format', 'm4a'])
            args = run.call_args.args[0]
            for value in ['/private/cookies', 'http://proxy', 'm4a', 'node']:
                self.assertIn(value, args)
            run.return_value.returncode = 1
            errors = io.StringIO()
            with contextlib.redirect_stderr(errors), self.assertRaises(subprocess.CalledProcessError):
                media.fetch(['https://example.com/video', 'out.wav'])
            self.assertIn('bot-checks cloud IPs', errors.getvalue())

    def test_srt_timestamp(self):
        self.assertEqual(media.timestamp(3661.125), '01:01:01,125')

    def test_transcribe_formats_empty_and_decode_failure(self):
        numpy = MagicMock()
        whisper = MagicMock()
        segment = types.SimpleNamespace(start=0.0, end=1.5, text=' hello ')
        model = whisper.WhisperModel.return_value
        model.transcribe.return_value = ([segment], types.SimpleNamespace(language='en'))
        with patch.dict(sys.modules, {'numpy': numpy, 'faster_whisper': whisper}), \
                patch.object(media, 'threads', return_value='2'), \
                patch.object(media.subprocess, 'check_output', return_value=b'pcm') as decode:
            for format, expected in [('text', 'hello'), ('json', '"language": "en"'),
                                     ('srt', '00:00:00,000 --> 00:00:01,500')]:
                stdout = io.StringIO()
                with contextlib.redirect_stdout(stdout):
                    media.transcribe(['input.mp4', '--format', format])
                self.assertIn(expected, stdout.getvalue())
                self.assertEqual(decode.call_args.args[0][0], 'ffmpeg')
                self.assertIn('f32le', decode.call_args.args[0])
                model.transcribe.assert_called_with(numpy.frombuffer.return_value.copy.return_value, beam_size=5)
            whisper.WhisperModel.assert_called_with('/opt/media/models/tiny.en', device='cpu',
                                                    compute_type='int8', cpu_threads=2)
            model.transcribe.return_value = ([], types.SimpleNamespace(language='en'))
            with contextlib.redirect_stdout(io.StringIO()) as stdout:
                media.transcribe(['silent.wav', '--model', '/local/model'])
            self.assertEqual(stdout.getvalue(), '\n')
            self.assertEqual(whisper.WhisperModel.call_args.args[0], '/local/model')
            decode.return_value = b''
            with self.assertRaisesRegex(ValueError, 'no audio samples'):
                media.transcribe(['empty.wav'])
            decode.side_effect = subprocess.CalledProcessError(1, 'ffmpeg')
            with self.assertRaises(subprocess.CalledProcessError):
                media.transcribe(['missing.wav'])

    def test_smoke_offline_and_optional_warning(self):
        def output(args, **kwargs):
            if args[0] == 'media-transcribe':
                self.assertEqual(kwargs['env']['HF_HUB_OFFLINE'], '1')
                return 'Ask not what your country can do for you'
            return 'hevc' if args[-1].endswith('hevc.mp4') else 'h264'
        with patch.object(media, 'run'), patch.object(media, 'encode'), \
                patch.object(media.subprocess, 'check_output', side_effect=output), \
                patch.object(media, 'fetch', side_effect=subprocess.CalledProcessError(1, 'yt-dlp')) as fetch:
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertFalse(media.smoke([]))
                fetch.assert_not_called()
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                self.assertFalse(media.smoke(['--url', 'https://example.com']))
            self.assertIn('WARN:', stdout.getvalue())
        with patch.object(media, 'run', side_effect=OSError('missing tool')), \
                patch.object(media, 'encode', side_effect=ValueError('codec failed')), \
                patch.object(media.subprocess, 'check_output', return_value=''), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertTrue(media.smoke([]))

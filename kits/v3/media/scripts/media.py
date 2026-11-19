#!/opt/media/bin/python
"""CPU media helpers; all decoding is delegated to ffmpeg."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def threads():
    return subprocess.check_output(['nproc'], text=True).strip()


def encode(argv):
    parser = argparse.ArgumentParser(description='Encode video with CPU H.264 or HEVC')
    parser.add_argument('input')
    parser.add_argument('output')
    parser.add_argument('--codec', choices=['h264', 'hevc'], default='h264')
    args = parser.parse_args(argv)
    codec = 'libx264' if args.codec == 'h264' else 'libx265'
    options = ['-x265-params', f'pools={threads()}:frame-threads=2'] if args.codec == 'hevc' else []
    run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-i', args.input,
         '-c:v', codec, '-preset', 'fast', '-threads', threads(), *options,
         '-c:a', 'aac', args.output])


def timestamp(seconds):
    milliseconds = round(seconds * 1000)
    hours, milliseconds = divmod(milliseconds, 3600000)
    minutes, milliseconds = divmod(milliseconds, 60000)
    seconds, milliseconds = divmod(milliseconds, 1000)
    return f'{hours:02}:{minutes:02}:{seconds:02},{milliseconds:03}'


def transcribe(argv):
    parser = argparse.ArgumentParser(description='Transcribe audio/video using CPU int8 Whisper')
    parser.add_argument('input')
    parser.add_argument('--model', default='tiny.en', help='Model name or local model directory')
    parser.add_argument('--format', choices=['text', 'json', 'srt'], default='text')
    args = parser.parse_args(argv)
    import numpy as np
    from faster_whisper import WhisperModel
    pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-nostdin', '-i', args.input,
                                   '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'])
    if not pcm:
        raise ValueError('Input contains no audio samples')
    audio = np.frombuffer(pcm, dtype='<f4').copy()
    model_path = '/opt/media/models/tiny.en' if args.model == 'tiny.en' else args.model
    model = WhisperModel(model_path, device='cpu', compute_type='int8', cpu_threads=int(threads()))
    segments, info = model.transcribe(audio, beam_size=5)
    rows = [dict(start=s.start, end=s.end, text=s.text.strip()) for s in segments]
    if args.format == 'json':
        print(json.dumps(dict(language=info.language, segments=rows)))
    elif args.format == 'srt':
        for index, row in enumerate(rows, 1):
            print(f"{index}\n{timestamp(row['start'])} --> {timestamp(row['end'])}\n{row['text']}\n")
    else:
        print(' '.join(row['text'] for row in rows))


def fetch(argv):
    parser = argparse.ArgumentParser(description='Fetch best audio with yt-dlp; YouTube may require cookies')
    parser.add_argument('url')
    parser.add_argument('output', help='Output filename template, e.g. audio.%%(ext)s')
    parser.add_argument('--format', choices=['wav', 'm4a'], default='wav')
    parser.add_argument('--cookies', default=os.environ.get('YT_COOKIES_FILE'))
    parser.add_argument('--proxy', default=os.environ.get('YT_PROXY'))
    args = parser.parse_args(argv)
    options = []
    for flag, value in [('--cookies', args.cookies), ('--proxy', args.proxy)]:
        if value:
            options.extend([flag, value])
    result = subprocess.run(['yt-dlp', '--js-runtimes', 'node', '--no-playlist',
                             '--socket-timeout', '30', '--retries', '1', '-f', 'bestaudio',
                             '-x', '--audio-format', args.format, '-o', args.output, *options, '--', args.url])
    if result.returncode:
        print('Audio retrieval failed. YouTube often bot-checks cloud IPs; supply an authorized '
              'cookies file with --cookies / YT_COOKIES_FILE and optionally --proxy / YT_PROXY. '
              'A JS runtime alone does not resolve bot checks.', file=sys.stderr)
        raise subprocess.CalledProcessError(result.returncode, 'yt-dlp')


def smoke(argv):
    parser = argparse.ArgumentParser(description='Offline media checks, with optional network download')
    parser.add_argument('--url', help='Optional download probe; failures are WARN only')
    args = parser.parse_args(argv)
    failures = []

    def check(name, action):
        try:
            action()
            print(f'PASS: {name}', flush=True)
        except (subprocess.CalledProcessError, ValueError, OSError) as error:
            failures.append(name)
            print(f'FAIL: {name}: {error}', flush=True)

    with tempfile.TemporaryDirectory(prefix='media-smoke-') as temp:
        source = f'{temp}/source.mp4'
        def video(codec):
            output = f'{temp}/{codec}.mp4'
            encode([source, output, '--codec', codec])
            actual = subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                      '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', output], text=True).strip()
            if actual != codec:
                raise ValueError(f'Expected {codec}, got {actual}')

        check('lavfi source', lambda: run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-f', 'lavfi',
              '-i', 'testsrc2=size=320x180:rate=24', '-t', '1', '-c:v', 'libx264', source]))
        for codec in ['h264', 'hevc']:
            check(codec, lambda codec=codec: video(codec))

        def speech():
            result = subprocess.check_output(['media-transcribe', '/opt/media/jfk.flac'], text=True,
                                            env={**os.environ, 'HF_HUB_OFFLINE': '1'})
            if 'ask not what your country' not in result.lower():
                raise ValueError(f'Unexpected transcript: {result}')
            print(result.strip(), flush=True)
        check('offline tiny.en transcription', speech)
        check('yt-dlp version', lambda: run(['yt-dlp', '--version']))
        if args.url:
            try:
                fetch([args.url, f'{temp}/download.%(ext)s'])
                print('PASS: optional audio download', flush=True)
            except subprocess.CalledProcessError:
                print('WARN: optional download failed (including possible cloud-IP bot check)', flush=True)
    return bool(failures)


if __name__ == '__main__':
    commands = {'media-encode': encode, 'media-transcribe': transcribe,
                'media-fetch-audio': fetch, 'media-smoke': smoke}
    try:
        sys.exit(commands[Path(sys.argv[0]).name](sys.argv[1:]))
    except (subprocess.CalledProcessError, ValueError, OSError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)

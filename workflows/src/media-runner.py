import hashlib
import hmac
import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path


def command(argv, timeout=900):
    return subprocess.run(argv, check=True, capture_output=True, timeout=timeout)


def encode(config):
    data = config["data"]
    stats = []
    source = ["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24"]
    if data.get("sourceUrl"):
        command(["curl", "-fL", "--max-time", "180", "--max-filesize", "100000000", data["sourceUrl"], "-o", "/root/input.media"])
        source = ["-i", "/root/input.media"]
    for codec in data["codecs"]:
        path = f"/root/{codec}.mp4"
        started = time.monotonic()
        command(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *source,
                 "-t", str(data["durationSec"]), "-an", "-c:v", "libx264" if codec == "h264" else "libx265",
                 "-preset", "veryfast", "-threads", "4", "-pix_fmt", "yuv420p", path])
        stats.append({"codec": codec, "seconds": round(time.monotonic() - started, 3),
                      "bytes": os.path.getsize(path), "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest(), "path": path})
    return "completed", {"outputs": stats}


def transcribe(config):
    data = config["data"]
    started = time.monotonic()
    if data.get("youtubeUrl"):
        argv = ["/opt/media/bin/yt-dlp", "--no-playlist", "--socket-timeout", "30", "--retries", "1", "-x", "--audio-format", "wav", "-o", "/root/audio.%(ext)s"]
        if config.get("cookies"):
            Path("/root/youtube.cookies").write_text(config["cookies"])
            os.chmod("/root/youtube.cookies", 0o600)
            argv += ["--cookies", "/root/youtube.cookies"]
        if config.get("proxy"):
            argv += ["--proxy", config["proxy"]]
        download = subprocess.run([*argv, data["youtubeUrl"]], capture_output=True, timeout=180)
        if download.returncode:
            message = download.stderr.decode(errors="replace").lower()
            if any(x in message for x in ["sign in", "bot", "cookies", "429", "403", "confirm you"]):
                return "needs_cookies", {"reason": "YouTube rejected unauthenticated or insufficiently authenticated retrieval", "downloadSeconds": round(time.monotonic() - started, 3)}
            return "failed", {"reason": "YouTube download failed"}
        source = "/root/audio.wav"
    else:
        source = "/root/audio.download"
        command(["curl", "-fL", "--max-time", "180", "--max-filesize", "100000000", data["audioUrl"], "-o", source])
    download_seconds = time.monotonic() - started
    duration = float(command(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", source]).stdout)
    command(["ffmpeg", "-y", "-v", "error", "-i", source, "-f", "f32le", "-ac", "1", "-ar", "16000", "/root/audio.pcm"])
    import numpy as np
    from faster_whisper import WhisperModel
    started = time.monotonic()
    model = WhisperModel(data["model"], device="cpu", compute_type="int8", cpu_threads=4)
    load_seconds = time.monotonic() - started
    started = time.monotonic()
    segments, info = model.transcribe(np.fromfile("/root/audio.pcm", dtype=np.float32), beam_size=1)
    transcript = " ".join(segment.text.strip() for segment in segments)
    return "completed", {"transcript": transcript, "language": info.language, "audioSeconds": duration,
                         "downloadSeconds": round(download_seconds, 3), "modelLoadSeconds": round(load_seconds, 3),
                         "transcribeSeconds": round(time.monotonic() - started, 3)}


config = json.loads(Path("/root/job.json").read_text())
started = time.monotonic()
try:
    status, result = encode(config) if config["kind"] == "encode" else transcribe(config)
except Exception as error:
    status, result = "failed", {"reason": type(error).__name__}
result["workSeconds"] = round(time.monotonic() - started, 3)
payload = {"jobId": config["jobId"], "status": status, "result": result}
Path("/root/result.json").write_text(json.dumps(payload))
body = json.dumps(payload, separators=(",", ":")).encode()
signature = hmac.new(config["callbackKey"].encode(), body, hashlib.sha256).hexdigest()
for attempt in range(8):
    try:
        request = urllib.request.Request(config["callbackUrl"], data=body, headers={"Content-Type": "application/json", "x-sandbox-signature": signature})
        with urllib.request.urlopen(request, timeout=30) as response:
            if response.status == 200:
                Path("/root/callback-delivered").touch()
                break
    except Exception:
        time.sleep(min(2 ** attempt, 30))

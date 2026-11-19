import json
from pathlib import Path
import runpy
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


RUNNER = Path(__file__).with_name("media-runner.py")


class MediaRunnerTest(unittest.TestCase):
    def run_transcription(self, transcript, error=False, probe_duration=b"10"):
        config = {"kind": "transcribe", "data": {"audioUrl": "https://example.com/audio", "model": "tiny"},
                  "jobId": "test-job", "callbackUrl": "https://example.com/callback", "callbackKey": "test-only"}
        model = Mock()
        model.transcribe.return_value = (iter([SimpleNamespace(text=transcript)]), SimpleNamespace(language="en"))
        whisper = Mock(return_value=model, side_effect=RuntimeError if error else None)
        response = Mock()
        response.__enter__ = Mock(return_value=SimpleNamespace(status=200))
        response.__exit__ = Mock(return_value=False)
        with patch.dict("sys.modules", {"numpy": SimpleNamespace(float32="float32", fromfile=lambda *a, **kw: SimpleNamespace(size=160000)),
                                        "faster_whisper": SimpleNamespace(WhisperModel=whisper)}), \
                patch("pathlib.Path.read_text", return_value=json.dumps(config)), \
                patch("pathlib.Path.write_text") as write, patch("pathlib.Path.touch"), \
                patch("subprocess.run", return_value=subprocess.CompletedProcess([], 0, probe_duration, b"")), \
                patch("urllib.request.urlopen", return_value=response) as send:
            runpy.run_path(str(RUNNER))
        return json.loads(write.call_args.args[0]), send.call_args.args[0].data

    def test_large_transcript_stays_in_artifact_not_callback(self):
        transcript = "中" * 100000
        artifact, body = self.run_transcription(transcript)
        self.assertLessEqual(len(body), 65536)
        self.assertEqual(artifact["result"]["transcript"], transcript)
        self.assertNotIn("transcript", json.loads(body)["result"])

    def test_unknown_container_duration_uses_decoded_audio(self):
        for duration in [b"N/A", b"", b"nan"]:
            with self.subTest(duration=duration):
                artifact, _ = self.run_transcription("speech", probe_duration=duration)
                self.assertEqual(artifact["status"], "completed")
                self.assertEqual(artifact["result"]["audioSeconds"], 10)

    def test_normal_empty_and_failed_transcriptions_deliver_status(self):
        for transcript, error in [("speech", False), ("", False), ("", True)]:
            with self.subTest(transcript=transcript, error=error):
                artifact, body = self.run_transcription(transcript, error)
                callback = json.loads(body)
                self.assertEqual(callback["status"], "failed" if error else "completed")
                self.assertEqual(callback["status"], artifact["status"])
                if not error:
                    self.assertEqual(artifact["result"]["transcript"], transcript)


if __name__ == "__main__":
    unittest.main()

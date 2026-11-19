"""Browser smoke control-flow tests; no real browser or network access."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class BrowserTests(unittest.TestCase):
    def test_browser_image_contract(self):
        kit = ROOT / 'kits/v3/browser'
        recipe = (kit / 'browser.dockerfile').read_text()
        for expected in ['agent-browser@0.43.0', 'install --with-deps', 'fonts-noto-cjk',
                         'fonts-noto-color-emoji', 'fonts-liberation', 'AGENT_BROWSER_EXECUTABLE_PATH',
                         'USER agent', 'Acquire::Retries', 'Acquire::https::Timeout']:
            self.assertIn(expected, recipe)
        self.assertEqual((kit / 'browser.yaml').read_text().splitlines()[0],
                         (ROOT / 'kits/v3/amp/amp.yaml').read_text().splitlines()[0])

    @unittest.skipUnless(shutil.which('node'), 'Node needed for smoke control-flow tests')
    def test_smoke_success_empty_and_error(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            fake = directory / 'agent-browser'
            fake.write_text('''#!/usr/bin/env python3
import os, pathlib, sys
args = sys.argv[3:]
if args[0] == 'snapshot':
    print('Example Domain 中文 日本語 한국어' if os.environ['CASE'] != 'empty' else '')
if args[0] == 'screenshot':
    pathlib.Path(args[1]).write_bytes(bytes.fromhex('89504e470d0a1a0a'))
if args[0] == 'download':
    pathlib.Path(args[2]).write_text('Browser Kit download: 中文 日本語 한국어 😀\\n')
if os.environ['CASE'] == 'error' and args[0] == 'open':
    sys.exit(7)
''')
            fake.chmod(0o755)
            command = ['node', '--import', 'data:text/javascript,process.getuid=()=>1000',
                       str(ROOT / 'kits/v3/browser/scripts/browser-smoke.mjs')]
            for case in ['success', 'empty', 'error']:
                with self.subTest(case=case):
                    result = subprocess.run(command + [str(directory / case)],
                                            env={**os.environ, 'PATH': f'{temp}:{os.environ["PATH"]}',
                                                 'CASE': case}, capture_output=True, text=True, timeout=20)
                    if case == 'success':
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertIn('PASS:', result.stdout)
                    else:
                        self.assertNotEqual(result.returncode, 0)
                        self.assertNotIn('PASS:', result.stdout)
            existing = subprocess.run(command + [str(directory / 'success')],
                                      capture_output=True, text=True, timeout=20)
            self.assertNotEqual(existing.returncode, 0)
            self.assertIn('EEXIST', existing.stderr)

"""Offline tests only: never install tools, authenticate, or create resources."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class ReferenceTests(unittest.TestCase):
    def run_script(self, name, destination, **environment):
        return subprocess.run(['bash', str(ROOT / 'scripts' / name), str(destination)],
                              env={**os.environ, **environment}, capture_output=True, text=True)

    def test_v2_render(self):
        with tempfile.TemporaryDirectory() as temp:
            result = self.run_script('render-v2.sh', temp, IMAGE_REFERENCE='example.invalid/agent/runtime:local')
            self.assertEqual(result.returncode, 0, result.stderr)
            content = (Path(temp) / 'spec.yaml').read_text()
            self.assertIn('image: "example.invalid/agent/runtime:local"', content)
            self.assertNotIn('@IMAGE_REFERENCE@', content)

    def test_v2_rejects_injection(self):
        for reference in ['bad\nvalue', 'bad"value', 'bad|value', 'bad&value', 'bad value', '']:
            with self.subTest(reference=reference), tempfile.TemporaryDirectory() as temp:
                result = self.run_script('render-v2.sh', temp, IMAGE_REFERENCE=reference)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((Path(temp) / 'spec.yaml').exists())

    def test_v3_stages_exact_source(self):
        with tempfile.TemporaryDirectory() as temp:
            self.assertEqual(self.run_script('stage-v3.sh', temp).returncode, 0)
            expected = {'amp.yaml', 'amp.dockerfile', 'amp-context.md',
                        'scripts/install-toolchains.sh', 'scripts/refresh-node-lts.sh', 'scripts/verify-runtime.sh'}
            actual = {str(p.relative_to(temp)) for p in Path(temp).rglob('*') if p.is_file()}
            self.assertEqual(actual, expected)
            for name in expected:
                source = ROOT / 'kits/v3/amp' / name
                self.assertEqual((Path(temp) / name).read_bytes(), source.read_bytes())

    def test_vendored_scripts_match_source(self):
        result = subprocess.run(['bash', str(ROOT / 'scripts/sync-kits.sh'), '--check'],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        for source in (ROOT / 'kits/v3/amp/scripts').glob('*.sh'):
            self.assertEqual(source.read_bytes(), (ROOT / 'scripts' / source.name).read_bytes())
            self.assertTrue(os.access(source, os.X_OK))

    def test_sync_detects_and_repairs_drift(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'scripts').mkdir()
            for name in ['sync-kits.sh', 'install-toolchains.sh', 'refresh-node-lts.sh', 'verify-runtime.sh']:
                (root / 'scripts' / name).write_bytes((ROOT / 'scripts' / name).read_bytes())
            command = ['bash', str(root / 'scripts/sync-kits.sh')]
            self.assertNotEqual(subprocess.run(command + ['--check'], capture_output=True).returncode, 0)
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual(subprocess.run(command + ['--check'], capture_output=True).returncode, 0)
            (root / 'kits/v3/amp/scripts/verify-runtime.sh').write_text('drift\n')
            self.assertNotEqual(subprocess.run(command + ['--check'], capture_output=True).returncode, 0)
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual(subprocess.run(command + ['--check'], capture_output=True).returncode, 0)
            self.assertEqual(subprocess.run(command + ['--invalid'], capture_output=True).returncode, 2)

    def test_nonroot_and_no_permission_bypass(self):
        for name in ['kits/v2/Dockerfile', 'kits/v3/amp/amp.dockerfile']:
            content = (ROOT / name).read_text()
            self.assertIn('USER agent', content)
            self.assertIn('ENTRYPOINT ["amp"]', content)
            self.assertIn('ARG BASE_IMAGE=docker.io/sbx/shell-docker-image:latest', content)
            self.assertNotIn('--dangerously-allow-all', content)
        self.assertNotIn('--dangerously-allow-all', (ROOT / 'kits/v2/spec.yaml.in').read_text())

    def test_lts_and_shared_installer(self):
        self.assertIn('fnm list-remote --lts --latest', (ROOT / 'scripts/refresh-node-lts.sh').read_text())
        self.assertIn('process.release.lts', (ROOT / 'scripts/verify-runtime.sh').read_text())
        for name in ['kits/v2/Dockerfile', 'kits/v3/amp/amp.dockerfile']:
            self.assertIn('COPY scripts/install-toolchains.sh', (ROOT / name).read_text())

    def test_ci_is_read_only_and_builds_public_kit(self):
        workflows = list((ROOT / '.github/workflows').glob('*'))
        self.assertEqual(len(workflows), 1)
        content = workflows[0].read_text()
        for expected in ['contents: read', 'persist-credentials: false', 'runs-on: ubuntu-24.04', 'timeout-minutes: 5']:
            self.assertIn(expected, content)
        for forbidden in ['secrets.', 'self-hosted', 'pull_request_target', 'docker login', 'docker push', 'sbx ', '--privileged']:
            self.assertNotIn(forbidden, content)
        self.assertIn('timeout-minutes: 30', content)
        self.assertIn('docker buildx build -f kits/v3/amp/amp.yaml kits/v3/amp -t sbx-agent-kits/amp:ci --load', content)
        self.assertIn('docker run --rm --entrypoint sbx-agent-kits-verify sbx-agent-kits/amp:ci', content)
        self.assertNotIn('--push', content)

if __name__ == '__main__':
    unittest.main()

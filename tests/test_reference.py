"""Offline tests only: never install tools, authenticate, or create resources."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
KITS = sorted(path.name for path in (ROOT / 'kits/v3').iterdir() if path.is_dir())

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
        self.assertEqual(KITS, ['amp', 'claude', 'codex'])
        for kit in KITS:
            with self.subTest(kit=kit), tempfile.TemporaryDirectory() as temp:
                result = subprocess.run(['bash', str(ROOT / 'scripts/stage-v3.sh'), kit, temp],
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                expected = {f'{kit}.yaml', f'{kit}.dockerfile', f'{kit}-context.md',
                            'scripts/install-toolchains.sh', 'scripts/refresh-node-lts.sh', 'scripts/verify-runtime.sh'}
                actual = {str(p.relative_to(temp)) for p in Path(temp).rglob('*') if p.is_file()}
                self.assertEqual(actual, expected)
                for name in expected:
                    source = ROOT / 'kits/v3' / kit / name
                    self.assertEqual((Path(temp) / name).read_bytes(), source.read_bytes())

    def test_staging_rejects_unknown_and_invalid_kits(self):
        for kit in ['', 'missing', '../amp']:
            with self.subTest(kit=kit), tempfile.TemporaryDirectory() as temp:
                result = subprocess.run(['bash', str(ROOT / 'scripts/stage-v3.sh'), kit, temp],
                                        capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(list(Path(temp).iterdir()), [])

    def test_vendored_scripts_match_source(self):
        result = subprocess.run(['bash', str(ROOT / 'scripts/sync-kits.sh'), '--check'],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        for source in (ROOT / 'kits/v3').glob('*/scripts/*.sh'):
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
            for kit in KITS:
                (root / 'kits/v3' / kit).mkdir(parents=True)
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual(subprocess.run(command + ['--check'], capture_output=True).returncode, 0)
            for kit in KITS:
                (root / 'kits/v3' / kit / 'scripts/verify-runtime.sh').write_text('drift\n')
                self.assertNotEqual(subprocess.run(command + ['--check'], capture_output=True).returncode, 0)
                self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
                self.assertEqual(subprocess.run(command + ['--check'], capture_output=True).returncode, 0)
            self.assertEqual(subprocess.run(command + ['--invalid'], capture_output=True).returncode, 2)

    def test_nonroot_and_no_permission_bypass(self):
        recipes = [ROOT / 'kits/v2/Dockerfile'] + list((ROOT / 'kits/v3').glob('*/*.dockerfile'))
        for path in recipes:
            content = path.read_text()
            self.assertIn('USER agent', content)
            agent = 'amp' if path.name == 'Dockerfile' else path.stem
            self.assertIn(f'ENTRYPOINT ["{agent}"]', content)
            self.assertIn('ARG BASE_IMAGE=docker.io/sbx/shell-docker-image:latest', content)
        for path in (ROOT / 'kits').rglob('*'):
            if path.is_file():
                content = path.read_text()
                for forbidden in ['--dangerously-', 'bypassPermissions', 'danger-full-access',
                                  'skipDangerousModePermissionPrompt']:
                    self.assertNotIn(forbidden, content, str(path))
                self.assertNotRegex(content, r'approval_policy\s*=\s*[\'\"]never[\'\"]')
                self.assertNotRegex(content, r'(?i)defaultMode[\'\"]?\s*:\s*[\'\"](?:auto|dontAsk)')

    def test_lts_and_shared_installer(self):
        self.assertIn('fnm list-remote --lts --latest', (ROOT / 'scripts/refresh-node-lts.sh').read_text())
        self.assertIn('process.release.lts', (ROOT / 'scripts/verify-runtime.sh').read_text())
        for path in [ROOT / 'kits/v2/Dockerfile'] + list((ROOT / 'kits/v3').glob('*/*.dockerfile')):
            self.assertIn('COPY scripts/install-toolchains.sh', path.read_text())

    def test_ci_is_read_only_and_builds_public_kit(self):
        workflows = list((ROOT / '.github/workflows').glob('*'))
        self.assertEqual(len(workflows), 1)
        content = workflows[0].read_text()
        for expected in ['contents: read', 'persist-credentials: false', 'runs-on: ubuntu-24.04', 'timeout-minutes: 5']:
            self.assertIn(expected, content)
        for forbidden in ['secrets.', 'self-hosted', 'pull_request_target', 'docker login', 'docker push', 'sbx ', '--privileged']:
            self.assertNotIn(forbidden, content)
        self.assertIn('timeout-minutes: 30', content)
        self.assertIn('kit: [amp, claude, codex]', content)
        self.assertIn('docker buildx build -f kits/v3/${{ matrix.kit }}/${{ matrix.kit }}.yaml kits/v3/${{ matrix.kit }} -t sbx-agent-kits/${{ matrix.kit }}:ci --load', content)
        self.assertIn('docker run --rm --entrypoint sbx-agent-kits-verify sbx-agent-kits/${{ matrix.kit }}:ci', content)
        self.assertNotIn('--push', content)

if __name__ == '__main__':
    unittest.main()

"""Offline auth-seed and per-agent smoke-test behavior; no credentials or services."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import textwrap
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[1]


def install_commands(kit):
    descriptor = (ROOT / f'kits/v3/{kit}/{kit}.yaml').read_text()
    return [textwrap.dedent(command) for command in re.findall(
        r'^        - command: \|\n((?:^            .*\n|^\n)+)', descriptor, re.MULTILINE)]


class AuthSeedTests(unittest.TestCase):
    def run_seed(self, command, home, **environment):
        bin_dir = home / 'bin'
        bin_dir.mkdir(exist_ok=True)
        chown = bin_dir / 'chown'
        chown.write_text('#!/bin/sh\nexit 0\n')
        chown.chmod(0o755)
        result = subprocess.run(['/bin/sh', '-c', command.replace('/home/agent', str(home))],
                                env={**os.environ, 'PATH': str(bin_dir) + ':' + os.environ['PATH'],
                                     **environment}, capture_output=True, text=True)
        return result

    def test_claude_modes_and_workspace_escaping(self):
        commands = install_commands('claude')
        self.assertEqual(len(commands), 2)
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            workspace = '/workspace/quote" slash\\ tab\t newline\n'
            result = self.run_seed(commands[0], home, WORKSPACE_DIR=workspace)
            self.assertEqual(result.returncode, 0, result.stderr)
            onboarding = json.loads((home / '.claude.json').read_text())
            self.assertTrue(onboarding['hasCompletedOnboarding'])
            self.assertTrue(onboarding['projects'][workspace]['hasTrustDialogAccepted'])
            for mode in ['none', 'apikey', 'oauth', '', 'none']:
                with self.subTest(mode=mode):
                    result = self.run_seed(commands[1], home, SBX_CRED_ANTHROPIC_MODE=mode)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    settings = json.loads((home / '.claude/settings.json').read_text())
                    expected = {'apiKeyHelper': 'echo proxy-managed'} if mode in ('apikey', 'oauth') else {}
                    self.assertEqual(settings, expected)
            self.assertEqual(self.run_seed(commands[0], home, WORKSPACE_DIR='').returncode, 0)
            self.assertIn('/', json.loads((home / '.claude.json').read_text())['projects'])

    def test_codex_modes_and_stale_auth_removal(self):
        commands = install_commands('codex')
        self.assertEqual(len(commands), 1)
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            (home / '.codex').mkdir()
            workspace = '/workspace/quote" slash\\ tab\t newline\n'
            for mode in ['none', 'apikey', 'oauth', '', 'none']:
                with self.subTest(mode=mode):
                    result = self.run_seed(commands[0], home, SBX_CRED_OPENAI_MODE=mode, WORKSPACE_DIR=workspace)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    config = tomllib.loads((home / '.codex/config.toml').read_text())
                    self.assertEqual(config['projects'][workspace]['trust_level'], 'trusted')
                    self.assertNotIn('approval_policy', config)
                    self.assertNotIn('sandbox_mode', config)
                    self.assertEqual(config.get('forced_login_method'), 'api' if mode in ('apikey', 'oauth') else None)
                    self.assertEqual(config.get('model_provider'), 'sandboxd' if mode == 'oauth' else None)
                    if mode == 'oauth':
                        self.assertEqual(config['model_providers']['sandboxd']['experimental_bearer_token'],
                                         'oai-oat01-proxy-managed')
                    auth = home / '.codex/auth.json'
                    if mode in ('apikey', 'oauth'):
                        self.assertEqual(json.loads(auth.read_text()), {'OPENAI_API_KEY': 'proxy-managed'})
                    else:
                        self.assertFalse(auth.exists())

    def test_seed_write_failures_are_not_swallowed(self):
        for kit in ['claude', 'codex']:
            with self.subTest(kit=kit), tempfile.TemporaryDirectory() as temp:
                result = self.run_seed(install_commands(kit)[-1], Path(temp))
                self.assertNotEqual(result.returncode, 0)


class RuntimeVerifyTests(unittest.TestCase):
    def test_agent_selection_and_toolchain_only_mode(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            tools = 'mise uv agent-browser pnpm fnm pi bun deno skills gh node npm chromium'.split()
            for name in tools:
                path = directory / name
                path.write_text('#!/bin/sh\nexit 0\n')
                path.chmod(0o755)
            identity = directory / 'id'
            identity.write_text('#!/bin/sh\necho 1000\n')
            identity.chmod(0o755)
            command = ['/bin/bash', str(ROOT / 'scripts/verify-runtime.sh')]
            for agent in ['amp', 'claude', 'codex']:
                with self.subTest(agent=agent):
                    environment = {**os.environ, 'PATH': temp, 'SBX_AGENT_BINARY': agent}
                    missing = subprocess.run(command, env=environment, capture_output=True, text=True)
                    self.assertNotEqual(missing.returncode, 0)
                    self.assertIn(f'MISSING:{agent}', missing.stderr)
                    self.assertEqual(subprocess.run(command + ['--toolchains-only'], env=environment,
                                                    capture_output=True).returncode, 0)
                    (directory / agent).symlink_to('/bin/true')
                    self.assertEqual(subprocess.run(command, env=environment, capture_output=True).returncode, 0)
            environment = {**os.environ, 'PATH': temp, 'SBX_AGENT_BINARY': ''}
            self.assertEqual(subprocess.run(command, env=environment, capture_output=True).returncode, 0)
            self.assertEqual(subprocess.run(command + ['--invalid'], env=environment, capture_output=True).returncode, 2)


if __name__ == '__main__':
    unittest.main()

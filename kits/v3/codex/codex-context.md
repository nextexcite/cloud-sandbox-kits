# Codex development sandbox

- Work as the non-root agent user. Keep Codex's default approval behavior
  and filesystem sandbox; do not disable either to work around a failure.
- Toolchains: mise, uv, fnm Node LTS, pnpm, Pi, Bun, Deno, agent-browser,
  Chromium, skills and GitHub CLI. Prefer project-local manifests.
- Credentials are resolved by the runtime; local auth files may contain
  proxy sentinels. Never print credentials or secret contents.
- Follow the repository's AGENTS.md. Work in a branch, test changes,
  and report changed files and validation results.
- Network access is scoped. Obtain approval before requesting other hosts.

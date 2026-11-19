# Claude Code development sandbox

- Work as the non-root agent user. Keep Claude's default approval behavior.
- Toolchains: mise, uv, fnm Node LTS, pnpm, Pi, Bun, Deno, agent-browser,
  Chromium, skills and GitHub CLI. Prefer project-local manifests.
- Credentials are resolved by the runtime; local auth files may contain
  proxy sentinels. Never print credentials or secret contents.
- Follow the repository's CLAUDE.md and AGENTS.md. Work in a branch,
  test changes, and report changed files and validation results.
- Network access is scoped. Obtain approval before requesting other hosts.

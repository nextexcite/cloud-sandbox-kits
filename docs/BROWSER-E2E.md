# Browser Kit v3 Cloud acceptance

Measured 2026-11-19, Linux amd64 client, sbx v0.54.0, branch
`devin/1795087544-browser-kit`, image inputs at commit `bc94e40`.
This is a single smoke run, not a benchmark or an anti-bot compatibility claim.

## Results

The committed Git-source Browser Kit built, uploaded, created and applied in
94.37 seconds total, using the local Docker Buildx cache from the preceding
local image build. CLI stage timings: build 7s, upload/template preparation
approximately 77s (upload approximately 30s, then preparation), sandbox creation
6s, kit apply 1s. Local successful cold-layer build took 64.51s; a smoke-only
rebuild reused those layers. This is **not** a cold Git Kit provisioning time.

Local Docker smoke: 1.15s. Cloud smoke: 2.68s, including exec client overhead.
Both printed:

```text
PASS: UID 1000, Node LTS, HTTPS open, snapshot, CJK screenshot, browser download (exact bytes)
Artifacts: /home/agent/workspace/browser-smoke
```

Cloud identity/version checks printed:

```text
uid=1000(agent) gid=1000(agent) groups=1000(agent)
v24.22.3
agent-browser 0.43.0
```

The smoke asserted HTTPS page snapshot text, PNG headers, CJK snapshot text and
all 54 bytes of a browser-downloaded HTTP attachment. The attachment is served by
an in-process loopback HTTP server, not fetched by curl or synthesized directly
into the output file. `sbx --cloud cp` downloaded all four output files into
`/home/ubuntu/browser-smoke-artifacts/cloud/` on the trial client:

- `example.png` (56,400 bytes)
- `cjk.png` (15,563 bytes)
- `snapshot.txt` (107 bytes)
- `download.txt` (54 bytes)

The CJK screenshot was visually inspected: Chinese, Japanese and Korean glyphs
and a color emoji rendered, with no missing-glyph boxes. Local screenshot also
passed visual inspection. Artifacts/logs remain on the trial client, not in Git.

## Platform and build gotchas

- Git sources require the scoped client environment override
  `DOCKER_SANDBOXES_KIT_ALLOWED_SOURCES='["docker.io/","dhi.io/","github.com/nextexcite/"]'`.
  `#ref=devin/1795087544-browser-kit&dir=kits/v3/browser` resolved successfully.
- Explicit `policy init allow-all --sandbox browser-kit-1795087544` was applied
  before smoke. The manifest's conservative example.com rule is not a claim
  about inherited Cloud policy defaults. No account-wide policy was changed.
- agent-browser 0.43.0 downloads Chrome under `/root/.agent-browser/browsers`,
  not `/root/.cache`; the image copies Chrome to a globally readable `/opt/chrome`
  before removing root's browser cache. An initial local build exposed this.
- example.com's snapshot no longer necessarily contains an "Example Domain"
  heading. The first local smoke caught this; the assertion accepts the heading
  or its documentation-examples text. CJK/download fixtures are deterministic.
- The CLI warned it could not keep the image in the local sandbox daemon cache
  (`sandboxd.sock: connect: no such file or directory`), but upload and Cloud
  execution succeeded. Local Docker Buildx cache remained usable.
- Headless CLI login warned that no keychain was available and stored credentials
  protected by filesystem permissions. Credentials were bound only for login,
  never passed into the image or repository.

## Cleanup

Only the trial sandbox `browser-kit-1795087544`
(`sbx_001m7ss51f4gv8gx4h3k941w1qa`) and its auto-created template
`kit3src-browser-87ed90e75387-linux-amd64-2c4096m`
(`tmpl_001m7ss2n2dy4tvt2jwkkf27nbh`) were removed after artifact export.
Two pre-existing stopped sandboxes were left untouched. No quota settings,
account policy, or unrelated resources were changed.

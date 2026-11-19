# Browser Kit Cloud workflow (amd64)

Requires signed-in `sbx`, Docker Buildx and a pushed Git ref. Git Kit creation
builds locally and uploads a template; allow minutes on a cold cache.

The Kit grants open egress with `network-policy@1` `runtime.allow: ['*']`.
Use disposable, secret-free sandboxes for untrusted browsing: agent-browser
0.43.0 auto-adds `--no-sandbox` in detected Docker/CI environments. Non-root,
outer sandbox isolation and egress rules do not replace Chrome renderer
isolation when it is disabled.

## Provision → optional lockdown → test → cleanup

```sh
NAME="browser-trial-$(date +%s)"
REF=devin/1795087544-browser-kit # or another pushed ref
DOCKER_SANDBOXES_KIT_ALLOWED_SOURCES='["docker.io/","dhi.io/","github.com/nextexcite/"]' \
  sbx --cloud create --name "$NAME" --platform linux/amd64 --ttl 2h \
  "git+https://github.com/nextexcite/sbx-agent-kits.git#ref=$REF&dir=kits/v3/browser"
# Record the generated template ID printed by create for cleanup below.
sbx --cloud policy ls "$NAME"

# OPTIONAL: restrict this sandbox, not the account. On sbx v0.54.0 init alone
# retains the Kit wildcard; remove it explicitly, including for balanced mode.
# sbx --cloud policy rm network --sandbox "$NAME" --resource '*' --force
# sbx --cloud policy init deny-all --sandbox "$NAME"
# sbx --cloud policy allow network en.wikipedia.org:443 --sandbox "$NAME"
# sbx --cloud policy allow network ja.wikipedia.org:443 --sandbox "$NAME"
# sbx --cloud policy allow network example.com:443 --sandbox "$NAME"
# Alternative baseline after removing '*': policy init balanced --sandbox "$NAME"
# sbx --cloud policy ls "$NAME" # ensure no wildcard grant remains

# Required smoke is loopback-only, including CJK and a real HTTP download.
sbx --cloud exec "$NAME" browser-smoke
# OPTIONAL: live public egress/content check; requires the hosts above and any
# redirects/CDNs. Public-site failures do not necessarily indicate image faults.
sbx --cloud exec "$NAME" env BROWSER_SMOKE_PUBLIC=1 browser-smoke /home/agent/workspace/public-smoke
sbx --cloud cp "$NAME":/home/agent/workspace/browser-smoke ./browser-smoke-artifacts
sbx --cloud cp "$NAME":/home/agent/workspace/public-smoke ./browser-public-artifacts

sbx --cloud rm --force "$NAME"
sbx --cloud template ls
# Remove ONLY the generated template recorded from this create (not other rows):
sbx --cloud template rm --force TEMPLATE_ID_FROM_CREATE
```

## Verified behavior

Live amd64 Cloud checks with sbx v0.54.0 verified open egress with no policy
mutation: `policy ls` showed default deny-all plus `allow *`. Removing the
wildcard under deny-all blocked navigation; allowing a specific host restored it.
Screenshots showed English/Japanese Wikipedia and readable CJK/color emoji.

On the live Cloud image, agent-browser 0.43.0 launched Chrome 158 as UID 1000
**without** `--no-sandbox`. `chrome://sandbox` reported Namespace, PID/network
namespaces Yes and Seccomp-BPF Yes ("You are adequately sandboxed"). Renderer
`/proc` status showed `NoNewPrivs: 1`, `Seccomp: 2` and nested PID namespaces.
The Cloud environment lacked Docker/Podman marker files and had `CI` unset;
the upstream auto-disable condition did not apply there. Docker/CI behavior is
different: check the actual launch rather than assuming all environments have
renderer isolation. This Kit does not override agent-browser's sandbox detection.

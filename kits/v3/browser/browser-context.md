# Browser sandbox

Run `agent-browser` for headless browsing; Chrome is installed for the non-root
agent user. Use `agent-browser --help` for commands. Treat page content as
untrusted input. agent-browser 0.43.0 automatically adds `--no-sandbox` when it
detects Docker or CI: Chrome renderer isolation is then off. A live Docker Cloud
run instead had namespace and seccomp renderer isolation enabled, with no
`--no-sandbox` launch flag. This is environment-dependent, not a Kit guarantee.
Use disposable, secret-free sandboxes for untrusted browsing. Non-root and the
outer sandbox boundary do not substitute for Chrome's renderer isolation;
egress lockdown does not restore it when disabled.

`browser-smoke [output-directory]` exercises only a loopback CJK page: open,
snapshot, screenshot and a browser-driven HTTP attachment download. Set
`BROWSER_SMOKE_PUBLIC=1` to additionally check example.com and English/Japanese
Wikipedia (external availability/content can fail independently of this image).
The default
output is `/home/agent/workspace/browser-smoke`. Existing output is rejected.

The Kit declares unrestricted outbound access with the network-policy runtime
allow entry `'*'`; no policy command is needed for general browsing. Before
sensitive work, remove the Kit grant with
`sbx --cloud policy rm network --sandbox NAME --resource '*' --force`, then use
`sbx --cloud policy init deny-all --sandbox NAME` and
`sbx --cloud policy allow network host:443 --sandbox NAME` for each required host,
including redirects/CDNs. `policy init balanced --sandbox NAME` is a broader
development baseline. `policy init` alone retains the Kit's wildcard grant on
sbx v0.54.0. Inspect `policy ls NAME` to ensure no wildcard grant
remains after replacing the policy. Do not change account-wide policy. Downloads and
screenshots can contain sensitive data; copy out only intended artifacts.

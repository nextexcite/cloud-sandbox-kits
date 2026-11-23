# Instabox Android development overlay

This directory is a portable setup overlay, not an Instabox image or an sbx
Kit. Create a machine from Instabox's `android` template first: OCI snapshot
imports use the `agent-browser` base and do not establish the Android kernel.
Copy or clone this directory into the machine, then run `bash setup.sh`. It
installs the pinned mise version and the tools in `mise.toml` into the current
user's home, and verifies Android boot and tool availability.

From this directory run `~/.local/share/instabox-android/bin/mise exec -- just verify` to check the
environment, or `~/.local/share/instabox-android/bin/mise exec -- just update` to deliberately update
tool versions in `mise.toml`. Review the resulting changes before sharing.
Verification waits up to 120 seconds for Android to finish booting; it fails
with a timeout message if the device never becomes ready.
Use `mise exec -- <command>` in this directory for the tools; it does not alter
global shell setup or an existing Node installation. fnm is installed but no
Node version is selected by this overlay.

Setup fetches a pinned mise binary directly from GitHub, verifies its pinned
SHA-256 digest, and uses mise to fetch the configured tools. To update mise,
change both its version and digest in setup.sh. This bundle contains no credentials
and does not sign in to Amp, configure fnox providers, publish an image, or
create a machine. Never include credentials or Android app data in a bundle.

An OCI image can distribute these files without changing the Android template.
Build from the repository root so the overlay includes the project `LICENSE`:

```sh
docker build -f kits/instabox-android/Dockerfile -t instabox-android-overlay:local .
id=$(docker create instabox-android-overlay:local /unused)
docker cp "$id:/instabox-android" ./instabox-android-overlay
docker rm "$id"
cd instabox-android-overlay && bash setup.sh
```

Build and publish to a registry only after reviewing the bundle. Pull the image
in each Android VM and use the same create/copy/remove commands with its image
reference. Do not run the scratch image or import it as an Instabox snapshot.

Copyright 2026 NextExcite. The overlay files are licensed under Apache-2.0;
see `LICENSE` in the extracted bundle. The downloaded tools and provider
software are not included and remain under their own terms.

## Real-project Android development

The template supplies containerized Android 14 (Redroid), not a KVM-backed AVD.
On x86_64, ADB installation, UI Automator, `adb exec-out screencap -p`, and Android
`screenrecord` worked in the ObtainX Flutter trial. Installed scrcpy could see
the device but headless recording failed in that shell; use Android's recorder
as the tested fallback. Keep physical-device, hardware graphics, and other ABI
testing separate.

Use the project's pinned Flutter, Gradle, SDK, and NDK versions. For ObtainX,
the stock SDK 34 was insufficient: dependency provisioning took about 12m 35s
across two build attempts, while the warm rebuild took 19s. The first attempt
hit the API exec limit; use SSH or a background job for cold provisioning.
Keep Flutter, Gradle, and pub caches on persistent storage, and monitor disk
and swap. A future prewarmed toolchain should be opt-in and pinned to a project
or profile, rather than adding one app's SDK/NDK to every overlay install.

## GitHub Actions instrumentation smoke test

In the repository's **Settings → Environments**, configure an `instabox-android`
environment with the `INSTABOX_API_KEY` secret (a key with `machines:write` for
the workspace that owns the Android sandbox) and the `INSTABOX_MACHINE_ID`
variable (the sandbox's `m_…` ID). Limit the environment to trusted branches:
the workflow executes the selected branch's sample app and tests on that machine.

Start the Android sandbox if it was manually stopped, then run **Instabox Android
instrumentation** from the Actions tab. The job sends the checked-out sample to
the sandbox, waits for Android to boot, and runs Gradle connected tests against
its single ADB device. Download `android-instrumentation-junit` from the run's
artifacts, including on assertion failures. If the job fails before tests run,
there may be no XML. The job neither stops nor restarts the sandbox.

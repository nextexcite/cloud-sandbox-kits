# Release policy

Version each kit independently with SemVer. Git tags use
`<provider>-<workload>-vMAJOR.MINOR.PATCH`; OCI artifacts use
`MAJOR.MINOR.PATCH` under a kit-specific package name. For example, the
first Android preview could be `instabox-android-v0.1.0-rc.1` in Git and
`ghcr.io/nextexcite/instabox-android-overlay:0.1.0-rc.1` in GHCR. No version has
been assigned to the experiments. Docker Kit v2 and v3 are specification
versions, and Instabox's Android template version is provider-owned.

- **Major:** a breaking change to a documented entry point, artifact, or setup contract.
- **Minor:** a compatible capability in the kit.
- **Patch:** a compatible fix, dependency refresh, or documentation correction.
- **Release candidate:** use `-rc.N` when inviting testing before a release;
  never reuse a candidate or release tag for different content.

Release notes list the full source commit, kit path, provider/template version,
tested architecture, exact artifact digests, and tested capabilities. For OCI
artifacts, record both the index and tested platform digests when applicable;
bind the Docker v2 descriptor to its runtime image digest. A Git commit pins a
Docker v3 recipe, not the image it produces if base images or downloads float.
Do not claim reproducible builds unless the resolved inputs are pinned.

Use digests in CI and repeatable setup instructions; do not publish `latest` or
date-based experiment tags as supported releases. Package only the documented
overlay files, not tool caches, app data, signing keys, or sandbox snapshots.

## Gate the first release on verification and licensing

1. Include the project [Apache-2.0 license](../LICENSE) in distributions of
   project files. Preserve the licenses and applicable notices of third-party
   components actually shipped. The first release should keep Docker kits as
   recipes until their prebuilt images have a separate redistribution review.
2. Run the **Reference checks** workflow, including the credential-free Android
   overlay build and content check and the Docker v3 build/smoke matrix. For a
   Docker kit release, also launch it from the pinned Git ref through `sbx`.
   Keep the published `kits/v2` and `kits/v3` entry points working.
3. For an Android release, build the bundle from the release commit. Confirm
   its source and license labels and exact payload (`LICENSE`, `README.md`,
   `mise.toml`, `setup.sh`, `justfile`), then pull it by digest without
   credentials from a clean client. Install and reinstall on a fresh Instabox
   Android template, check stop/start persistence, and wait for a ready ADB
   device. Run instrumentation from a trusted ref and verify JUnit is uploaded
   on both a pass and a deliberate test failure. Record the tested toolchain and
   Redroid limitations. The connected CI smoke alone does not install the overlay.
4. Verify the release notes match the artifacts, then publish only with release
   approval. Do not claim support for E2B or Daytona before provider-specific
   setup and runtime checks pass.

## Retire experiments after the replacement works

The current `instabox-android-overlay` package contains
`experiment-20261123` and `experiment-linked-20261123`. Neither is a formal
release. Publish and validate the replacement first, inventory any references
to both tags **and their digests**, migrate known consumers, and announce a
retention window that leaves a known-good digest available for rollback.
Request approval for the exact package versions before deletion; deleting a
manifest can break digest-pinned callers even when they do not use its tags.
Keep the package name and surviving versions intact.

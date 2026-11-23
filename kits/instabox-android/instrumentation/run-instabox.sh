#!/usr/bin/env bash
set -euo pipefail

: "${INSTABOX_API_KEY:?Set the Instabox API key}"
: "${INSTABOX_MACHINE_ID:?Set the Instabox machine ID}"
[[ $INSTABOX_MACHINE_ID =~ ^m_[a-z0-9]+$ ]] || { echo 'Invalid Instabox machine ID' >&2; exit 1; }
report=${1:?Pass the destination for the JUnit XML}
rm -f -- "$report"
endpoint="https://api.instabox.sh/v1/machines/$INSTABOX_MACHINE_ID"
auth="X-API-Key: $INSTABOX_API_KEY"

remote_exec() {
    jq -n --arg cmd "$1" --argjson seconds "$2" '{cmd:$cmd,timeoutSeconds:$seconds}' |
        curl -fsS --max-time "$(($2 + 30))" -H "$auth" -H 'Content-Type: application/json' --data-binary @- "$endpoint/exec"
}

remote_dir=$(remote_exec 'mktemp -d /data/tmp/android-ci.XXXXXXXX' 15 | jq -er 'select(.exitCode == 0) | .stdout | rtrimstr("\n")')
[[ $remote_dir =~ ^/data/tmp/android-ci\.[a-zA-Z0-9]+$ ]] || exit 1
trap 'remote_exec "rm -rf -- $remote_dir" 15 >/dev/null || true' EXIT

tar -C "$(dirname "$0")" -czf - app build.gradle gradle.properties settings.gradle |
    curl -fsS --max-time 30 -X PUT -H "$auth" -H 'Content-Type: application/octet-stream' \
        --data-binary @- "$endpoint/files?path=$remote_dir/source.tar.gz" >/dev/null

result=$(remote_exec "cd $remote_dir && tar -xzf source.tar.gz &&
    timeout 120 bash -c 'until [ \"\$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d \"\r\")\" = 1 ]; do sleep 2; done' &&
    CI=true gradle --no-daemon --max-workers=2 --console=plain :app:connectedDebugAndroidTest" 600)
jq -r '.stdout' <<<"$result"
jq -r '.stderr' <<<"$result" >&2
status=$(jq -er '.exitCode | numbers' <<<"$result")

# The fixture targets the single Android device attached to the sandbox.
xml=$(remote_exec "find $remote_dir/app/build/outputs/androidTest-results/connected/debug -maxdepth 1 -name 'TEST-*.xml' -type f" 15 |
    jq -r 'select(.exitCode == 0) | .stdout | rtrimstr("\n")')
if [[ $xml == "$remote_dir"/app/build/outputs/androidTest-results/connected/debug/TEST-*.xml && $xml != *$'\n'* ]]; then
    curl -fsS --max-time 30 -H "$auth" --get --data-urlencode "path=$xml" "$endpoint/files/content" -o "$report"
elif (( status == 0 )); then
    echo 'Expected one JUnit XML report from the connected Android device' >&2
    exit 1
fi
exit "$status"

#!/usr/bin/env bash
set -euo pipefail

# Read once, verify the exact known helper, and extract only its library.
verify_and_extract() {
  /usr/bin/python3 -I - "$1" "$2" <<'PY_CHECK'
import hashlib, pathlib, sys
source = pathlib.Path(sys.argv[1]).read_bytes()
if hashlib.sha256(source).hexdigest() != "2c0b180e42d3fd89002c9a2bf89995ab2a49866ea687588ed689878a468e419d":
    raise SystemExit("unexpected helper digest")
lines = source.splitlines(keepends=True)
markers = [index for index, line in enumerate(lines) if line.startswith(b"# STAGES:")]
if len(markers) != 1:
    raise SystemExit("expected exactly one stage marker")
with pathlib.Path(sys.argv[2]).open("xb") as output:
    output.write(b"".join(lines[:markers[0]]))
PY_CHECK
}

# This check-only mode never enters the hosted experiment or invokes sudo.
if [[ "${1-}" == --verify-template ]]; then
  [[ $# == 3 ]] || exit 2
  verify_and_extract "$2" "$3"
  exit
fi

# Research fixture only: never run on a workstation or self-hosted runner.
[[ "${GITHUB_ACTIONS-}" == true && "${RUNNER_ENVIRONMENT-}" == github-hosted && "${RUNNER_OS-}" == Linux ]] || {
  printf 'This fixture requires a GitHub-hosted Linux runner.\n' >&2; exit 1;
}
[[ $(id -u) != 0 ]] || { printf 'The wizard owner must not be root.\n' >&2; exit 1; }
command -v cmp >/dev/null || exit 1
[[ -x /usr/bin/sudo && -x /usr/bin/setpriv && -x /usr/bin/python3 ]] || exit 1
/usr/bin/python3 -I -c 'import hashlib, pathlib, sys'
reader_uid=$(id -u nobody)
reader_gid=$(id -g nobody)
writer_uid=$(id -u)
writer_gid=$(id -g)
[[ "$reader_uid" != "$writer_uid" && "$reader_gid" != "$writer_gid" ]] || exit 1

fixture=$(mktemp -d /tmp/wizard-reader-research.XXXXXXXX)
trap 'rm -rf -- "$fixture"' EXIT
chmod 0711 "$fixture"
verify_and_extract skills/engineering/wizard/template.sh "$fixture/library.sh"
chmod 0600 "$fixture/library.sh"
# shellcheck source=/dev/null
source "$fixture/library.sh"

printf "KEEP='synthetic-old'\nTOKEN='synthetic-new'\n" > "$fixture/expected"
chmod 0644 "$fixture/expected"
mkdir "$fixture/project"
chmod 0711 "$fixture/project"
# ENV_FILE is consumed by configure_destinations in the sourced library.
# shellcheck disable=SC2034
ENV_FILE=.env
configure_destinations "$fixture/project" >/dev/null <<< yes

target="$fixture/project/.env"
reader_can_read() {
  local group_id=$1
  /usr/bin/sudo -n /usr/bin/setpriv --reuid "$reader_uid" --regid "$group_id" --clear-groups \
    --inh-caps=-all --ambient-caps=-all --bounding-set=-all --no-new-privs -- /usr/bin/python3 -I -c '
import os, pathlib, sys
uid, gid = int(sys.argv[3]), int(sys.argv[4])
if os.getresuid() != (uid, uid, uid) or os.getresgid() != (gid, gid, gid) or os.getgroups():
    sys.exit(15)
status = dict(line.split(":", 1) for line in pathlib.Path("/proc/self/status").read_text().splitlines() if ":" in line)
if any(int(status[name].strip(), 16) for name in ("CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb")) or status["NoNewPrivs"].strip() != "1":
    sys.exit(15)
try:
    data = pathlib.Path(sys.argv[1]).read_bytes()
except PermissionError:
    sys.exit(13)
expected = pathlib.Path(sys.argv[2]).read_bytes()
sys.exit(0 if data == expected else 14)
' "$target" "$fixture/expected" "$reader_uid" "$group_id"
}
reader_is_denied() {
  local status
  if reader_can_read "$1"; then
    printf 'Reader unexpectedly received the synthetic value.\n' >&2
    exit 1
  else
    status=$?
    [[ "$status" == 13 ]] || { printf 'Reader probe failed with unexpected status %s.\n' "$status" >&2; exit 1; }
  fi
}

prepare() {
  printf "KEEP='synthetic-old'\n" > "$target"
  chmod "$1" "$target"
  write_env TOKEN synthetic-new >/dev/null
  cmp -s "$target" "$fixture/expected"
}

prepare 0600
reader_is_denied "$reader_gid"
printf 'private destination: reader denied\n'

prepare 0644
reader_can_read "$reader_gid"
printf 'world-readable destination: distinct reader received the synthetic value\n'

prepare 0640
reader_can_read "$writer_gid"
reader_is_denied "$reader_gid"
printf 'group-readable destination: selected group allowed; other group denied\n'

prepare 0644
chmod 0700 "$fixture/project"
reader_is_denied "$reader_gid"
printf 'private ancestor: reader denied despite destination mode\n'

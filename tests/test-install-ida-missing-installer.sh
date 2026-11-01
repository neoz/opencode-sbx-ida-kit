#!/usr/bin/env bash
# Checks what install-ida.sh does when no IDA installer is present.
#
# IDA is a hard requirement: sbx only surfaces an install command's output when
# that command exits non-zero, so the script must fail loudly. There is no
# opt-out.
#
# Usage: bash tests/test-install-ida-missing-installer.sh

set -uo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../ida-kit/files/home/ida-kit" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

failures=0

fail() {
  echo "  FAIL: $*" >&2
  failures=$((failures + 1))
}

ok() {
  echo "  ok: $*"
}

# A private copy of the kit so nothing next to the real script is found.
setup_case() {
  local case_dir="${TMP}/$1"
  mkdir -p "${case_dir}/ida-kit" "${case_dir}/home" "${case_dir}/ida"
  cp "${KIT_DIR}/install-ida.sh" "${KIT_DIR}/runme.js" "${case_dir}/ida-kit/"
  printf '%s\n' "${case_dir}"
}

run_script() {
  local case_dir="$1"
  shift
  env -i \
    HOME="${case_dir}/home" \
    PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
    IDADIR="${case_dir}/opt/ida-pro" \
    "$@" \
    bash "${case_dir}/ida-kit/install-ida.sh"
}

echo "test: missing installer fails with a visible message"
case_dir="$(setup_case default)"

output="$(run_script "${case_dir}" 2>&1)"
status=$?

if [ "${status}" -eq 0 ]; then
  fail "expected a non-zero exit so sbx shows the captured output, got 0"
else
  ok "exits non-zero (${status})"
fi

case "${output}" in
  *"IDA not installed yet."*) ok "prints the reason" ;;
  *) fail "missing 'IDA not installed yet.' in output" ;;
esac

echo "test: no opt-out — an IDA-less sandbox cannot be created"
case_dir="$(setup_case no-optout)"

output="$(run_script "${case_dir}" IDA_INSTALL_OPTIONAL=1 2>&1)"
status=$?

if [ "${status}" -eq 0 ]; then
  fail "expected a non-zero exit even with IDA_INSTALL_OPTIONAL=1, got 0"
else
  ok "still exits non-zero (${status})"
fi

case "${output}" in
  *"IDA not installed yet."*) ok "still explains why" ;;
  *) fail "missing 'IDA not installed yet.' in output" ;;
esac

echo "test: the script runs under set -euo pipefail"
if grep -qx 'set -euo pipefail' "${KIT_DIR}/install-ida.sh"; then
  ok "strict mode is enabled"
else
  fail "expected an active 'set -euo pipefail' (not commented out)"
fi

# The version probe must survive a registry file that does not mention
# libpython: grep exits 1 there, and pipefail + -e used to kill the script.
echo "test: ida_python_version tolerates a registry without libpython"
version_fn="$(awk '/^ida_python_version\(\) \{/{p=1} p{print} p&&/^\}/{exit}' \
  "${KIT_DIR}/install-ida.sh")"

if [ -z "${version_fn}" ]; then
  fail "could not extract ida_python_version from install-ida.sh"
else
  harness="${TMP}/version-harness.sh"
  {
    echo 'set -euo pipefail'
    printf '%s\n' "${version_fn}"
    echo 'ida_python_version'
  } >"${harness}"

  home="${TMP}/version-home"
  mkdir -p "${home}/.idapro"
  printf 'nothing useful here\n' >"${home}/.idapro/ida.reg"

  output="$(env -i HOME="${home}" PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
    bash "${harness}" 2>&1)"
  status=$?

  if [ "${status}" -ne 0 ]; then
    fail "expected a fallback version, got exit ${status}: ${output}"
  else
    ok "exits 0 (${output})"
  fi

  case "${output}" in
    [0-9]*.[0-9]*) ok "prints a python version fallback" ;;
    *) fail "expected a version like 3.14, got '${output}'" ;;
  esac
fi

if [ "${failures}" -ne 0 ]; then
  echo "${failures} check(s) failed" >&2
  exit 1
fi

echo "all checks passed"

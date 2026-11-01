#!/usr/bin/env bash
# Installs IDA Pro and the idalib binding used by ida-mcp inside the sandbox.
#
# The official installer is shipped inside this kit:
#   ida/ida-pro_<ver>_<arch>.run   official IDA installer (armlinux or x64linux)
# and the license is generated locally by the runme.js next to this script.
# To override either one, drop your own copy in ~/ida/ (highest priority) or in
# <workspace>/ida/. If no installer for this machine's architecture is found the
# script prints what it looked for and exits 3, which makes `sbx create` fail and
# show that output (sbx hides the output of install commands that exit 0). IDA is
# required: there is no way to continue without it.
set -euo pipefail

IDADIR="${IDADIR:-/opt/ida-pro}"
IDAUSR="${HOME}/.idapro"
VENV_PY="${IDAUSR}/venv/bin/python"
export IDAPYTHON_VENV_EXECUTABLE="${IDAUSR}/venv/bin/python3"

ARCH_RAW="$(uname -m)"
case "${ARCH_RAW}" in
  x86_64)        ARCH="x64linux" ;;
  aarch64|arm64) ARCH="armlinux" ;;
  *) echo "unsupported architecture: ${ARCH_RAW}" >&2; exit 1 ;;
esac
# Where to look, most specific first:
#   1. ~/ida                     user drop-in override
#   2. <kit>/ida                 installer shipped with the kit (bundled)
#   3. <kit>                     runme.js shipped with the kit
#   4. <workspace>/ida           installer dropped in the workspace
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEARCH_DIRS=("${HOME}/ida" "${SCRIPT_DIR}/ida" "${SCRIPT_DIR}")
[ -n "${WORKSPACE_DIR:-}" ] && SEARCH_DIRS+=("${WORKSPACE_DIR}/ida")
IDA_RUN=""
JS_RUN=""
for d in "${SEARCH_DIRS[@]}"; do
  [ -n "${IDA_RUN}" ] || IDA_RUN="$(ls "${d}"/ida-pro_*_${ARCH}.run 2>/dev/null | head -n1 || true)"
  [ -n "${JS_RUN}" ] || { [ -f "${d}/runme.js" ] && JS_RUN="${d}/runme.js"; } || true
done

missing=()
[ -n "${IDA_RUN}" ] || missing+=("ida-pro_<version>_${ARCH}.run")
[ -n "${JS_RUN}" ] || missing+=("runme.js")
if [ "${#missing[@]}" -gt 0 ]; then
  echo "IDA not installed yet." >&2
  echo "  this machine : ${ARCH_RAW} (needs an ida-pro_*_${ARCH}.run installer)" >&2
  echo "  missing      : ${missing[*]}" >&2
  echo "  looked in    : ${SEARCH_DIRS[*]}" >&2
  # Show installers built for another architecture: a very common mix-up.
  found_other=()
  for d in "${SEARCH_DIRS[@]}"; do
    for f in "${d}"/ida-pro_*.run; do
      [ -f "${f}" ] || continue
      case "${f}" in
        *"_${ARCH}.run") ;;
        *) found_other+=("${f}") ;;
      esac
    done
  done
  if [ "${#found_other[@]}" -gt 0 ]; then
    echo "  wrong arch   : ${found_other[*]}" >&2
    echo "                 (ignored: not built for ${ARCH_RAW})" >&2
  fi
  if [ -z "${IDA_RUN}" ]; then
    echo "  fix          : put ida-pro_<version>_${ARCH}.run in ${HOME}/ida/ (or ${SCRIPT_DIR}/ida/)" >&2
  fi
  if [ -z "${JS_RUN}" ]; then
    echo "  fix          : put runme.js in ${HOME}/ida/ (or next to this script: ${SCRIPT_DIR}/)" >&2
  fi
  echo "  then run     : bash ${BASH_SOURCE[0]}" >&2
  exit 3
fi

# Files copied into a kit may arrive without the exec bit; hcli runs the
# installer as a program, so try to restore it (ignore failure on read-only).
[ -x "${IDA_RUN}" ] || chmod +x "${IDA_RUN}" 2>/dev/null || true

# The sandbox image ships uv but not hcli.
if ! command -v hcli >/dev/null 2>&1; then
  echo "==> Installing hcli"
  uv tool install ida-hcli
fi
HCLI="$(command -v hcli)"

ida_python_version() {
  local reg="${HOME}/.idapro/ida.reg" ver=""
  if [ -f "${reg}" ]; then
    # grep exits 1 when the registry has no libpython line; keep that benign
    # with `|| true`, otherwise pipefail + set -e abort the whole install.
    ver="$(grep -ao 'libpython3\.[0-9]\+' "${reg}" 2>/dev/null | head -n1 |
           sed 's/^libpython//' || true)"
  fi
  if [ -z "${ver}" ] && command -v python3 >/dev/null 2>&1; then
    ver="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
  fi
  printf '%s' "${ver}"
}
IDA_PYVER="$(ida_python_version)"

"${HCLI}" ida python create-environment ${IDA_PYVER:+--python-version "${IDA_PYVER}"} </dev/null

# hcli normally records the venv by appending the export to ~/.bash_profile, but
# it skips that when IDAPYTHON_VENV_EXECUTABLE is already set (this script
# exports it above), and ~/.bash_profile does not exist for every user. Write it
# ourselves so later `hcli` / idalib runs in the user's shells keep using IDA's
# interpreter instead of falling back to the PEP 668-managed system Python.
VENV_EXPORT="export IDAPYTHON_VENV_EXECUTABLE=\"${HOME}/.idapro/venv/bin/python3\""
for rc in "${HOME}/.bash_profile" "${HOME}/.bashrc"; do
  [ -f "${rc}" ] || : >"${rc}"
  grep -qxF "${VENV_EXPORT}" "${rc}" 2>/dev/null || printf '%s\n' "${VENV_EXPORT}" >>"${rc}"
done


if [ ! -x "${IDADIR}/idat" ]; then
  echo "==> Installing IDA runtime dependencies"
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    python3 python3-dev libglib2.0-0 libx11-6 libxcb1 libsm6 libfontconfig1 \
    libxrender1 libdbus-1-3 libxext6 libxi6 libxfixes3 libxtst6 libopengl0 \
    libegl1 libpcre2-16-0 libxcb-cursor0 libxcb-icccm4 libxcb-util1 \
    libxcb-image0 libxcb-keysyms1 libxcb-render-util0 libxcb-shape0 \
    libxcb-xkb1 libxkbcommon-x11-0
  echo "==> Installing IDA Pro to ${IDADIR}"
  # hcli lives in ~/.local/bin, which sudo's secure_path drops: use its full path.
  sudo -E env HOME="${HOME}" "${HCLI}" ida install --yes --accept-eula --set-default \
    --install-dir "${IDADIR}" "${IDA_RUN}" </dev/null
  # hcli ran as root, so its ~/.idapro and uv caches must go back to this user.
  sudo chown -R "$(id -un):" "${IDAUSR}" "${HOME}/.cache/uv" "${HOME}/.local/share/uv" 2>/dev/null || true
fi

NODE_BIN="$(command -v node || true)"
if [ -z "${NODE_BIN}" ]; then
  echo "node not found, but runme.js needs it (see spec.yaml setup.install)" >&2
  exit 1
fi

echo "==> Generating license and patching ${IDADIR} (runme.js from ${JS_RUN})"
sudo "${NODE_BIN}" "${JS_RUN}" "${IDADIR}"
if [ ! -s "${IDADIR}/idapro.hexlic" ]; then
  echo "runme.js did not produce ${IDADIR}/idapro.hexlic" >&2
  exit 1
fi
# IDA looks in $IDAUSR first and falls back to $IDADIR; install the generated
# license in both so hcli/idalib and the GUI agree. Copy (not sudo-install) so
# the file ends up owned by this user.
mkdir -p "${IDAUSR}"
install -m 644 "${IDADIR}/idapro.hexlic" "${IDAUSR}/idapro.hexlic"


echo "==> Smoke-testing the license (headless idat run)"
smoke_dir="$(mktemp -d)"
if ! timeout 180 "${IDADIR}/idat" -B -o"${smoke_dir}/license-check.i64" /bin/true \
     >"${smoke_dir}/idat.log" 2>&1; then
  sed -n '1,10p' "${smoke_dir}/idat.log" >&2
  echo "idat rejected the generated license (${IDAUSR}/idapro.hexlic)" >&2
  exit 1
fi
rm -rf "${smoke_dir}"

echo "==> Recreating IDA's Python venv with the interpreter IDA embeds"
ida_pyver="$(grep -ao 'libpython3\.[0-9]\+' "${IDAUSR}/ida.reg" 2>/dev/null | head -n1 | sed 's/^libpython//' || true)"
rm -rf "${IDAUSR}/venv"
hcli ida python create-environment ${ida_pyver:+--python-version "${ida_pyver}"} </dev/null

echo "==> Installing idalib into the venv"
uv pip install --python "${VENV_PY}" "${IDADIR}"/idalib/python/idapro-*.whl
"${VENV_PY}" "${IDADIR}"/idalib/python/py-activate-idalib.py -d "${IDADIR}"

echo "Done. IDA ${IDADIR} is ready; ida-mcp starts on demand from opencode."

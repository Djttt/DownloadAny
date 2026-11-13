#!/usr/bin/env bash
# 把已发布到 GitHub Release 的签名更新产物登记到自托管更新服务器（api.lumeany.cc）。
#
#   ./scripts/publish-server-release.sh [版本号] [--rollout N] [--min-version X.Y.Z] [--notes "文案"]
#
# 做四件事：
#   1) 从 GitHub Release v<ver> 下载 updater 四件套：
#      Windows NSIS exe + .sig、macOS Apple Silicon .app.tar.gz + .sig
#   2) 上传并落位到服务器 /srv/downloadany/desktop/<ver>/（Caddy /downloadany/* 静态根）
#   3) 在服务器上读 .env 里的 UPDATE_ADMIN_TOKEN 调 admin 接口登记 windows/macos 两条
#      —— token 与 .sig 原文只在服务器侧流转，不出现在本地日志
#   4) 回查两个更新端点做验收
#
# 前置：GitHub Variable DOWNLOADANY_API_BASE_URL 已设；目标 tag 的 CI 已绿。
# 未覆盖：yt-dlp 组件发布（另走 /admin/components，先 tauri signer sign 原始二进制）。
# 覆盖用环境变量：SERVER=ubuntu@www.lumeany.cc API=https://api.lumeany.cc \
#                  REMOTE_ROOT=/srv/downloadany REPO=Djttt/DownloadAny GH_TOKEN=…（API 限流时）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER="${SERVER:-ubuntu@www.lumeany.cc}"
API="${API:-https://api.lumeany.cc}"
REMOTE_ROOT="${REMOTE_ROOT:-/srv/downloadany}"
REPO="${REPO:-Djttt/DownloadAny}"

VER=""; ROLLOUT=100; MIN_VERSION=""; NOTES=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rollout)     ROLLOUT="$2"; shift 2 ;;
    --min-version) MIN_VERSION="$2"; shift 2 ;;
    --notes)       NOTES="$2"; shift 2 ;;
    *)             VER="$1"; shift ;;
  esac
done
[[ -z "$VER" ]] && VER="$(python3 -c "import json;print(json.load(open('$ROOT/src-tauri/tauri.conf.json'))['version'])")"
[[ "$VER" =~ ^[0-9]+(\.[0-9]+)*$ ]] || { echo "版本号不合法: $VER" >&2; exit 1; }
TAG="v$VER"

auth=()
[[ -n "${GH_TOKEN:-}" ]] && auth=(-H "Authorization: Bearer $GH_TOKEN")

echo "== [1/4] 解析并下载 Release $TAG 的 updater 产物 =="
release_json="$(curl -fsSL "${auth[@]}" "https://api.github.com/repos/$REPO/releases/tags/$TAG")"
# 命令赋值参与 set -e：选集不精确（少/多任一必需产物）直接失败并列出实际资产
names_raw="$(python3 -c "
import json, sys
assets = [a['name'] for a in json.loads(sys.argv[1]).get('assets', [])]
def one(pred, label):
    hits = [n for n in assets if pred(n)]
    if len(hits) != 1:
        sys.exit(f'{label}: 期望 1 个、实际 {len(hits)} 个 {hits}；release 资产: {assets}')
    return hits[0]
win_exe = one(lambda n: n.lower().endswith('-setup.exe'), 'windows exe')
mac_tgz = one(lambda n: n.endswith('.app.tar.gz'), 'macos tar.gz')
for need in (win_exe + '.sig', mac_tgz + '.sig'):
    if need not in assets:
        sys.exit(f'缺少 {need}；release 资产: {assets}')
print('\n'.join([win_exe, win_exe + '.sig', mac_tgz, mac_tgz + '.sig']))
" "$release_json")"
mapfile -t names <<<"$names_raw"
printf '  %s\n' "${names[@]}"

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
for n in "${names[@]}"; do
  echo "  下载 $n"
  curl -fsSL -o "$tmp/$n" "https://github.com/$REPO/releases/download/$TAG/$n"
done

echo "== [2/4] 上传到 $SERVER 并落位 $REMOTE_ROOT/desktop/$VER/ =="
ssh -o BatchMode=yes "$SERVER" "rm -rf /tmp/da-publish && mkdir -p /tmp/da-publish $REMOTE_ROOT/desktop/$VER"
scp -q -o BatchMode=yes "$tmp"/* "$SERVER:/tmp/da-publish/"
ssh -o BatchMode=yes "$SERVER" \
  "mv /tmp/da-publish/* $REMOTE_ROOT/desktop/$VER/ && chmod 644 $REMOTE_ROOT/desktop/$VER/* && ls -l $REMOTE_ROOT/desktop/$VER/"

echo "== [3/4] 服务器侧 admin 登记 windows + macos 两条 =="
# ssh 会把参数拼成一条远端命令字符串，含空格的 NOTES/MIN_VERSION 需 %q 转义后再传输
ssh -o BatchMode=yes "$SERVER" 'bash -s' -- \
  "$VER" "$ROLLOUT" "$(printf '%q' "$MIN_VERSION")" "$(printf '%q' "$NOTES")" "$REMOTE_ROOT" "${names[@]}" <<'REMOTE'
set -euo pipefail
VER="$1"; ROLLOUT="$2"; MINV="$3"; NOTES="$4"; ROOT_D="$5"; shift 5
NAMES=("$@")
python3 - "$VER" "$ROLLOUT" "$MINV" "$NOTES" "$ROOT_D" "${NAMES[@]}" <<'PY'
import json, subprocess, sys, urllib.request

argv = sys.argv[1:]
ver, rollout, minv, notes, root = argv[:5]
names = argv[5:]
win_exe = next(n for n in names if n.lower().endswith("-setup.exe"))
win_sig = win_exe + ".sig"
mac_tgz = next(n for n in names if n.endswith(".app.tar.gz"))
mac_sig = mac_tgz + ".sig"
tok = subprocess.run(
    "sudo grep '^UPDATE_ADMIN_TOKEN=' /opt/downloadany-backend/.env | cut -d= -f2-",
    shell=True, capture_output=True, text=True, check=True).stdout.strip()

def publish(target, arch, fname, sig_file):
    sig = open(f"{root}/desktop/{ver}/{sig_file}").read().strip()
    body = {"version": ver, "channel": "stable", "target": target, "arch": arch,
            "artifact_path": f"desktop/{ver}/{fname}", "signature": sig,
            "notes": notes, "rollout_percent": int(rollout)}
    if minv:
        body["minimum_version"] = minv
    req = urllib.request.Request("http://127.0.0.1:8000/api/updates/admin/desktop",
                                 data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json",
                                          "Authorization": f"Bearer {tok}"})
    with urllib.request.urlopen(req, timeout=15) as r:
        print("  registered:", r.read().decode())

publish("windows", "x86_64", win_exe, win_sig)
publish("macos", "aarch64", mac_tgz, mac_sig)
PY
REMOTE

echo "== [4/4] 回查端点验收（以 0.1.1 客户端视角，期望 200）=="
for ta in "windows/x86_64" "darwin/aarch64"; do
  echo "  $ta -> $(curl -s -m10 -o /dev/null -w '%{http_code}' "$API/api/updates/desktop/$ta/0.1.1")"
done
curl -s -m10 "$API/api/updates/desktop/darwin/aarch64/0.1.1" | python3 -m json.tool

echo
echo "完成。后续：灰度调整 PATCH $API/api/updates/admin/desktop/<id> {\"rollout_percent\":N}；"
echo "急停   DELETE $API/api/updates/admin/desktop/<id>。"

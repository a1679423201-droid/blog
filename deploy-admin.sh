#!/usr/bin/env bash
# 一键更新写作后台：上传 server.py 和 static/ → 重启服务
# 不带 data/（会话密钥、GitHub 令牌留在服务器上）
set -euo pipefail
cd "$(dirname "$0")"

SERVER="ubuntu@170.106.150.172"
REMOTE_DIR="/home/ubuntu/blog-admin"
SSH_OPTS=(-o ConnectTimeout=10 -o ServerAliveInterval=15)

# 这台机器偶尔握手就被断，失败重试几次
retry() {
  local n=0
  until "$@"; do
    n=$((n + 1))
    [ "$n" -ge 5 ] && { echo "!! 连续 $n 次失败，放弃" >&2; return 1; }
    echo "   重试 ($n/5)…" >&2
    sleep 5
  done
}

echo "==> 语法检查"
python3 -m py_compile admin/server.py

echo "==> 上传（需要输入服务器密码）"
retry scp "${SSH_OPTS[@]}" admin/server.py "$SERVER:$REMOTE_DIR/server.py"
retry scp "${SSH_OPTS[@]}" admin/static/* "$SERVER:$REMOTE_DIR/static/"

echo "==> 重启服务"
retry ssh "${SSH_OPTS[@]}" "$SERVER" "chmod 644 $REMOTE_DIR/server.py && sudo systemctl restart blog-admin && sleep 1 && systemctl is-active blog-admin"

echo "==> 完成：http://170.106.150.172:8080/"

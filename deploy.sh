#!/usr/bin/env bash
# 一键发布：构建 → 打包 → 上传 → 服务器解包
set -euo pipefail
cd "$(dirname "$0")"

SERVER="ubuntu@170.106.150.172"
REMOTE_DIR="/var/www/blog"

echo "==> 构建"
npm run build

echo "==> 打包"
tar czf /tmp/blog.tgz -C dist .

echo "==> 上传（需要输入服务器密码）"
scp /tmp/blog.tgz "$SERVER:/tmp/blog.tgz"

echo "==> 服务器解包"
ssh "$SERVER" "sudo rm -rf $REMOTE_DIR/* && sudo tar xzf /tmp/blog.tgz -C $REMOTE_DIR && sudo chown -R ubuntu:ubuntu $REMOTE_DIR"

echo "==> 完成：http://170.106.150.172/"

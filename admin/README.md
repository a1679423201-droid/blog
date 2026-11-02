# 博客后台（blog-admin）

给这个博客用的自建写作后台。一个进程、一个端口、只用 Python 3 标准库，
内容通过 GitHub Contents API 直接提交到仓库，因此**发布链路和以前完全一样**：

```
后台保存 → GitHub main 分支 → GitHub Actions 构建 → deploy 分支 → 服务器 cron 拉取
```

后台本身不生成静态站点，也不碰服务器上的 `/var/www/blog`。

## 功能

- 文章列表：搜索标题、按已发布/草稿筛选、字数与更新时间
- 编辑器：标题 / 摘要 / 封面 / 日期 / 分类 / 标签 / 状态，Markdown 正文带「编辑 ↔ 预览」
- 新建时自动生成 slug 和 `YYYY-MM-DD-slug.md` 文件名，重名自动加序号
- 图片上传到 `public/images/`，文件名转成 ASCII 并带时间戳
- 站点设置：站点标题、副标题、作者、简介、头像、GitHub、邮箱（写 `src/site-settings.json`）
- 登录：密码 → HMAC 签名的 cookie（`HttpOnly; SameSite=Lax`），7 天有效，同一 IP 10 分钟内错 10 次锁定

## 本地跑

```bash
cd admin
ADMIN_PASSWORD=test ADMIN_MOCK=1 python3 server.py
# 打开 http://127.0.0.1:8080
```

`ADMIN_MOCK=1` 时读写的是 `admin/data/mock/`（一份仓库内容的镜像），不会碰 GitHub。
这个目录已经在 `.gitignore` 里。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 空（不可启动） | 登录密码 |
| `ADMIN_PORT` | `8080` | 监听端口 |
| `BLOG_REPO` | `a1679423201-droid/blog` | `owner/repo` |
| `BLOG_BRANCH` | `main` | 提交到哪个分支 |
| `BLOG_SITE_URL` | 空 | 后台里「查看网站」按钮跳转的地址 |
| `GITHUB_TOKEN` | 空 | 可选；不设也可以在后台页面里粘贴，存到 `data/github_token` |
| `ADMIN_MOCK` | 空 | 设 `1` 走本地 mock 目录 |

GitHub 令牌用 fine-grained PAT：只勾 `a1679423201-droid/blog` 一个仓库，权限 `Contents: Read and write`。

## 部署到服务器

服务器上（Ubuntu）的目录结构：

```
/home/ubuntu/blog-admin/
├── server.py
├── static/
├── admin.env          # 600，放 ADMIN_PASSWORD / BLOG_* / ADMIN_PORT
└── data/              # 自动生成：secret（cookie 签名密钥）、github_token
```

`/etc/systemd/system/blog-admin.service`：

```ini
[Unit]
Description=Blog Admin
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/blog-admin
EnvironmentFile=/home/ubuntu/blog-admin/admin.env
ExecStart=/usr/bin/python3 /home/ubuntu/blog-admin/server.py
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

更新代码：

```bash
./deploy-admin.sh          # Nginx 不在时用这个，API 可以直接 scp 上去重启
```

脚本做三件事：把 `admin/server.py` 和 `admin/static/` 拷到服务器、修文件权限、
`systemctl restart blog-admin`。它**不会**带 `admin/data/`（会话密钥和令牌留在服务器上）。

## 安全边界

- 后台只处理「写文章」这一件事，没有任何公开读取接口，未登录访问 `/api/*` 一律 401。
- 写操作的请求必须带 `X-Requested-With: blog-admin`，配合 `SameSite=Lax` 挡 CSRF。
- 目前是 `http://IP:8080`，密码和令牌在链路上是明文。等域名 + 443 就绪后应改走 HTTPS
  （nginx 反代到 8080 即可，后台不用改代码）。
- 云服务器安全组只对需要的端口开放；不用时 `sudo systemctl stop blog-admin` 即可关掉。

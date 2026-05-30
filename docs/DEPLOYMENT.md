# 部署方案

本文档介绍 DoLike 项目的多种部署方式。

---

## 部署方式概览

| 方式 | 适用场景 | 复杂度 |
| --- | --- | --- |
| [Docker 部署](#1-docker-部署) | 推荐，一键启动，环境隔离 | 低 |
| [传统部署](#2-传统部署) | 开发者、有 Node.js 环境 | 中 |
| [Nginx 反向代理](#3-nginx-反向代理) | 需要域名 / SSL | 高 |

---

## 1. Docker 部署

### 1.1 前置条件

- Docker >= 24.x
- Docker Compose >= 2.x

### 1.2 快速启动

```bash
cd /path/to/DoLike

# 构建并启动
docker compose up -d

# 查看日志
docker compose logs -f

# 停止
docker compose down
```

### 1.3 目录结构

```
DoLike/
├── docker-compose.yml
├── data/                  # 自动创建，数据持久化目录
│   ├── db/
│   │   └── app.sqlite     # 数据库
│   ├── accounts/          # 各账号归档内容
│   ├── logs/              # 运行日志
│   └── tmp/               # 临时文件
└── ...
```

### 1.4 默认端口

| 服务 | 端口映射 |
| --- | --- |
| DoLike Server | `7777:3000`（宿主机:容器） |

可通过修改 `docker-compose.yml` 中的 `ports` 配置变更。

### 1.5 环境变量

在 `docker-compose.yml` 中修改 `environment` 部分：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 容器内监听端口 |
| `ARCHIVE_ROOT` | `/data` | 数据存储根目录 |
| `DATABASE_URL` | `file:/data/db/app.sqlite` | 数据库连接串 |
| `LOG_LEVEL` | `info` | 日志级别 |
| `LOG_PRETTY` | `false` | 是否美化日志输出（生产建议 false） |

### 1.6 数据备份

```bash
# 备份整个数据目录
tar -czf dolike-backup-$(date +%Y%m%d).tar.gz ./data

# 恢复
tar -xzf dolike-backup-YYYYMMDD.tar.gz
```

### 1.7 更新

```bash
git pull
docker compose down
docker compose up -d --build
```

---

## 2. 传统部署

### 2.1 前置条件

- Node.js >= 20 LTS
- pnpm >= 9.x
- ffmpeg（用于音频提取，可选）

### 2.2 安装步骤

```bash
# 1. 克隆仓库
git clone https://github.com/lovesakuratears/DoLike.git
cd DoLike

# 2. 启用 pnpm
corepack enable
corepack prepare pnpm@latest --activate

# 3. 安装后端依赖
cd server
pnpm install
pnpm prisma:generate

# 4. 初始化数据库
cp .env.example .env
# 编辑 .env，根据需要调整配置
pnpm prisma:migrate

# 5. 构建后端
pnpm build
```

### 2.3 生产运行

```bash
cd server

# 方式 1：直接运行（需要 tsx）
NODE_ENV=production node --import tsx/esm dist/main.js

# 方式 2：使用 pm2（推荐）
npm install -g pm2
pm2 start dist/main.js \
  --name dolike-server \
  --node-args="--import tsx/esm" \
  --env production
```

### 2.4 前端部署

```bash
cd web
pnpm install
pnpm build:portal

# 产物在 web/packages/dolike-portal/dist/
# 可用任意静态文件服务器托管（Nginx / serve / 后端静态托管）
```

### 2.5 使用 pm2 管理

```bash
# 安装 pm2
npm install -g pm2

# 启动
pm2 start dist/main.js --name dolike-server --node-args="--import tsx/esm"

# 设置开机自启
pm2 startup
pm2 save

# 常用命令
pm2 status
pm2 logs dolike-server
pm2 restart dolike-server
pm2 stop dolike-server
```

---

## 3. Nginx 反向代理

如果需要在局域网内访问或绑定域名，可通过 Nginx 反向代理。

### 3.1 基础配置

```nginx
server {
    listen 80;
    server_name dolike.local;  # 替换为你的域名

    # 前端静态文件（如果使用 build 产物）
    root /path/to/DoLike/web/packages/dolike-portal/dist;
    index index.html;

    # API 代理
    location /api/ {
        proxy_pass http://127.0.0.1:7777;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 媒体代理（支持 Range 请求）
    location /media/ {
        proxy_pass http://127.0.0.1:7777;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Range $http_range;
        proxy_set_header If-Range $http_if_range;
        proxy_cache off;
    }

    # WebSocket 代理
    location /ws {
        proxy_pass http://127.0.0.1:7777;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### 3.2 SSL 配置（使用 Let's Encrypt）

```bash
# 安装 certbot
sudo apt install certbot python3-certbot-nginx

# 生成证书
sudo certbot --nginx -d dolike.example.com

# 自动续期（已自动配置）
sudo certbot renew --dry-run
```

### 3.3 安全加固建议

- 限制 Nginx 仅监听内网 IP（如果不需要公网访问）
- 添加基础认证（如果需要）：

```nginx
location / {
    auth_basic "DoLike";
    auth_basic_user_file /etc/nginx/.htpasswd;
    # ... 其余配置
}
```

- 限制请求频率：

```nginx
limit_req_zone $binary_remote_addr zone=dolike:10m rate=10r/s;

location /api/ {
    limit_req zone=dolike burst=20;
    # ... 其余配置
}
```

---

## 4. 故障排查

### 4.1 端口被占用

```bash
# 检查端口
lsof -i :7777

# 修改端口
PORT=8888 node --import tsx/esm dist/main.js
```

### 4.2 数据库错误

```bash
# 重新生成 Prisma 客户端
cd server && pnpm prisma:generate

# 重新运行迁移
pnpm prisma:migrate
```

### 4.3 权限问题

确保 `~/.dolike-archive/` 目录可读写，或使用 `ARCHIVE_ROOT` 指向有权限的目录：

```bash
export ARCHIVE_ROOT=/path/to/writable/dir
```

### 4.4 Docker 构建失败

```bash
# 清理缓存重新构建
docker compose build --no-cache

# 检查 Dockerfile 中的代理设置
# 如果在国内网络，可能需要调整 HTTP_PROXY 或移除代理配置
```

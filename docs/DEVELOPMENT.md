# 开发指南

本文档面向 DoLike 项目的开发者，涵盖环境搭建、架构说明、开发规范和调试方法。

---

## 1. 开发环境搭建

### 1.1 系统要求

| 组件 | 版本要求 |
| --- | --- |
| Node.js | >= 20 LTS |
| pnpm | >= 9.x |
| Chrome / Edge | 最新稳定版（用于扩展开发） |
| Git | >= 2.x |
| ffmpeg | 可选（音频提取功能需要，Docker 中已内置） |

### 1.2 安装依赖

```bash
# 克隆仓库
git clone https://github.com/lovesakuratears/DoLike.git
cd DoLike

# 启用 pnpm（推荐通过 corepack）
corepack enable
corepack prepare pnpm@latest --activate

# 安装后端依赖
cd server
pnpm install
pnpm prisma:generate

# 安装前端依赖
cd ../web
pnpm install
```

### 1.3 初始化数据库

```bash
cd server
pnpm prisma:migrate
```

这将创建 SQLite 数据库文件 `server/prisma/dev.db` 并执行所有迁移。

### 1.4 配置环境变量

```bash
cd server
cp .env.example .env
# 编辑 .env，调整端口、日志级别等
```

### 1.5 启动开发服务器

```bash
# 终端 1：启动后端（热重载）
cd server
pnpm dev

# 终端 2：启动前端 portal（热重载）
cd web
pnpm portal
```

后端监听 `http://127.0.0.1:7777`，前端通过 Vite 代理转发 API 请求。

---

## 2. 项目架构

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────┐
│                      Local Machine                        │
│                                                          │
│  ┌──────────────┐   HTTP/WS   ┌───────────────────────┐ │
│  │ dolike-portal│◄───────────►│  Fastify Server       │ │
│  │ (Vue 3)      │             │  :7777                │ │
│  └──────────────┘             │                       │ │
│                               │  Auth / Douyin         │ │
│  ┌──────────────┐  POST       │  Archive / Download    │ │
│  │ Extension     │───────────►│  Library / Media       │ │
│  │ (Chrome MV3) │             │  WebSocket             │ │
│  └──────────────┘             │                       │ │
│                               │  SQLite + File System  │ │
│                               └───────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 2.2 后端模块划分

```
server/src/
├── main.ts              # Fastify 启动入口，注册所有插件和路由
├── config.ts            # 配置加载（环境变量 → AppConfig）
├── core/                # 基础设施
│   ├── db.ts            # Prisma 客户端单例
│   ├── crypto.ts        # 加密工具（scrypt + aes-256-gcm）
│   ├── keystore.ts      # 密钥派生
│   ├── logger.ts        # pino 日志
│   ├── errors.ts        # 统一错误码
│   └── log-stream.ts    # WebSocket 日志流
├── auth/                # 本地账号鉴权
│   ├── auth.controller.ts   # 路由：注册/登录/注销/修改密码
│   ├── auth.service.ts      # argon2 密码哈希 + session 管理
│   └── session.plugin.ts    # Fastify 插件：注入 currentUser
├── douyin/              # 抖音账号接入
│   ├── douyin.controller.ts # 账号管理 API
│   ├── session.service.ts   # 统一 DouyinSession（三路）
│   ├── cloak.driver.ts      # 方案 A：无头浏览器扫码
│   ├── cloak.ws.ts           # 扫码 WebSocket 通道
│   ├── manual.driver.ts     # 方案 B：手动 Cookie
│   ├── bridge.controller.ts # 方案 C：扩展桥接
│   ├── bridge.service.ts    # 桥接处理
│   ├── browser.session.ts   # 浏览器会话管理
│   ├── browser.runtime.ts   # 浏览器运行时
│   ├── dy-client.ts         # 抖音 HTTP 客户端
│   ├── cookie-codec.ts      # Cookie 加解密
│   ├── cookie-parse.ts      # Cookie 解析
│   ├── account.store.ts     # 账号存储
│   └── types.ts
├── archive/             # 归档调度
│   ├── archive.controller.ts # 归档触发 API
│   ├── archive.service.ts    # 主调度逻辑
│   ├── normalize.ts          # 数据标准化
│   ├── dedup.ts              # 去重（硬链接）
│   ├── paths.ts              # 文件路径生成
│   ├── types.ts
│   └── fetchers/
│       └── index.ts          # 各分类抓取器
├── download/            # 下载队列
│   ├── queue.service.ts     # 任务调度 + 并发控制
│   ├── worker.entry.ts      # Worker 线程入口
│   ├── douyin-downloader.ts # 抖音下载器
│   ├── source-resolver.ts    # 下载源解析
│   ├── range.ts              # HTTP Range 断点续传
│   ├── mode.service.ts       # 下载模式管理
│   └── parser.controller.ts  # 解析器 API
├── library/             # 本地浏览
│   ├── library.controller.ts # 浏览 API
│   └── library.service.ts    # 搜索/筛选/排序
├── media/               # 媒体分发
│   └── media.controller.ts   # Range 流式播放
├── ws/                  # WebSocket
│   ├── progress.gateway.ts   # 下载进度推送
│   └── logs.gateway.ts       # 日志推送
└── scheduler/           # 定时增量（规划中）
```

### 2.3 数据模型核心关系

```
LocalUser 1──N DouyinAccount
LocalUser 1──1 UserSetting
LocalUser 1──N LocalFolder
DouyinAccount 1──N Content
DouyinAccount 1──N Mix
Content 1──N ContentLink
Content 1──N DownloadTask
Content 1──N FolderItem
LocalFolder 1──N FolderItem
```

完整 schema 见 `server/prisma/schema.prisma`。

### 2.4 前端项目结构

```
web/packages/
├── dolike-portal/       # 归档主前端（当前主要开发目标）
├── dolike-admin/        # 管理后台
├── dolike-creator/      # 创作者端
└── api-docs/            # API 文档
```

---

## 3. 开发规范

### 3.1 TypeScript

- 使用 ES2022 target，ESM 模块
- 严格模式（`strict: true`）
- 路径别名：`@/*` → `src/*`
- 类型定义放在各模块的 `types.ts` 中

### 3.2 API 设计

- 响应格式统一为 `{ code: number, data: T, message: string }`
- 成功 `code: 0`，错误 `code > 0`
- 使用 zod 进行请求体验证
- 路由文件命名：`<module>.controller.ts`

### 3.3 数据库

- **主线程独占 Prisma**：所有数据库操作必须在主线程完成，Worker 线程不持有 Prisma 实例
- 迁移命令：`pnpm prisma:migrate`（开发环境）、`pnpm prisma migrate deploy`（生产环境）
- 新增模型后需要 `pnpm prisma:generate` 重新生成客户端

### 3.4 Git 提交

- 提交前确保 `pnpm typecheck` 通过
- 不要在提交中包含 `node_modules/`、`dist/`、`.env`、`prisma/dev.db`

### 3.5 错误处理

- 后端错误统一使用 `core/errors.ts` 中定义的错误码
- 错误码前缀：`AUTH_*` / `DOUYIN_*` / `DOWNLOAD_*` / `STORAGE_*`
- 抖音接口调用失败使用指数退避重试（1s / 3s / 9s），最多 3 次

---

## 4. 调试指南

### 4.1 后端日志

默认日志级别 `info`，开发时可设为 `debug`：

```bash
LOG_LEVEL=debug pnpm dev
```

日志输出到控制台（pino-pretty 格式化）和 `~/.dolike-archive/logs/` 目录。

### 4.2 数据库查询

```bash
cd server
sqlite3 prisma/dev.db

# 查看所有表
.tables

# 查看表结构
.schema Content

# 查询示例
SELECT id, awemeId, title, status FROM Content LIMIT 10;
```

### 4.3 Prisma Studio

```bash
cd server
npx prisma studio
```

浏览器打开 `http://localhost:5555`，可视化浏览和编辑数据。

### 4.4 前端调试

- Vue DevTools：安装浏览器扩展
- 网络请求：DevTools Network 面板查看 API 调用
- Vite 代理：`web/packages/dolike-portal/vite.config.ts` 中的 proxy 配置

### 4.5 扩展调试

1. 打开 `chrome://extensions/`
2. 找到 DoLike 扩展，点击"Service Worker"链接
3. 在 Service Worker 的 DevTools 中查看 console 日志和网络请求

### 4.6 WebSocket 调试

后端 WebSocket 端点：`ws://127.0.0.1:7777/ws`

事件类型：
- `qr.update` — 扫码二维码
- `login.success` / `cloak.failed` — 登录状态
- `download.progress` — 下载进度
- `archive.summary` — 归档完成
- `sync.found_new` — 增量发现

---

## 5. 贡献指南

### 5.1 提交 Issue

在 [GitHub Issues](https://github.com/lovesakuratears/DoLike/issues/new) 提交，请包含：

- 问题描述
- 复现步骤
- 预期行为与实际行为
- 环境信息（OS、Node 版本、pnpm 版本）

### 5.2 提交 PR

1. Fork 仓库并创建功能分支
2. 确保 `pnpm typecheck` 在 `server/` 目录下通过
3. 遵循现有代码风格
4. 如有新增 API，补充对应的类型定义
5. 提交 PR 时描述改动内容和原因

### 5.3 项目文档

- [PRD.md](./PRD.md) — 了解产品方向
- [Backend-Architecture.md](./Backend-Architecture.md) — 了解架构设计
- [STATUS.md](./STATUS.md) — 查看当前进度
- [HANDOFF.md](./HANDOFF.md) — 新接手者必读

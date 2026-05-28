# DoLike

DoLike 是一个运行在本机的抖音个人归档项目，用来把当前登录账号下与"我"相关的内容保存到本地，并提供离线浏览能力。

当前仓库已经不再是单纯的"抖音仿站"前端集合，而是演进为一个以**本地归档**为主线的 monorepo：

- `server/`：本地后端，负责本地账号、抖音账号接入、归档调度、下载队列、媒体分发、进度推送
- `web/`：前端工作区，当前主要使用 `dolike-portal` 承载本地归档界面
- `extension/`：MV3 浏览器扩展，用于在真实浏览器登录态下把账号和列表推送到本地后端
- `docs/`：PRD、架构、前端调整、交接和进度文档

## 当前定位

- 目标：个人备份、离线浏览、本机使用
- 不做：点赞、评论、关注、私信等写操作
- 不做：共享部署、二次分发、云端同步
- 默认仅监听 `127.0.0.1`

## 当前状态

项目已完成 M0-M2 主要骨架，具备以下能力：

- 本地账号注册、登录、会话保持、修改密码
- 抖音账号接入：扫码登录、手动粘贴 Cookie、浏览器插件桥接
- 视频类内容归档主链路：列表抓取、入库、下载队列、进度推送、本地媒体播放
- 音乐收藏、合集的后端归档链路
- 前端"我的归档"页：账号管理、视频网格批量操作、本地播放器
- MV3 插件桥接链路（绑定账号 + 推送列表）
- **全量/增量归档自动判断**：无内容时自动全量，有内容时自动增量
- **Cookie 校验**：支持测试已绑定 Cookie 是否有效
- **意见反馈**：设置面板和左下角 GitHub 图标均链接到 [GitHub Issues](https://github.com/lovesakuratears/DoLike/issues/new)

已知阻塞：

- CloakBrowser 扫码路径存在 `secUid` 识别错误
- 插件桥接链路待真实环境联调验证
- 收藏夹、稍后再看的前端 Tab 尚未接通（后端已支持）

## 目录结构

```text
DoLike/
├── docs/                          # 文档
├── extension/                     # MV3 浏览器扩展
│   ├── lib/
│   │   ├── config.js              # 扩展配置读写
│   │   ├── push.js                # 调 /api/bridge/push
│   │   ├── collectors.page.js     # 注入到 douyin.com 的采集器
│   │   └── cookie-collectors.js   # 四种 Cookie 采集方式（M1-M4）
│   ├── native-host/               # Native Messaging 主机（Python）
│   └── ...
├── server/                        # 本地后端
├── web/
│   └── packages/
│       └── dolike-portal/         # 归档前端
└── pnpm-workspace.yaml
```

## 开发环境

- Node.js `>= 20`
- pnpm
- SQLite（Prisma）

## 本地启动

### 1. 启动后端

```bash
cd server
pnpm install
pnpm prisma:generate
pnpm dev
```

默认监听 `http://127.0.0.1:7777`。

### 2. 启动前端 portal

```bash
cd web
pnpm install
pnpm portal
```

前端通过 Vite 代理把 `/api`、`/media`、`/ws` 转发到 `127.0.0.1:7777`。

### 3. 加载浏览器扩展

1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 加载已解压的扩展程序 → 选择 `extension/` 目录
4. 在弹窗中配置项目 URL 和 API Key

详细步骤见 [extension/README.md](./extension/README.md)。

## 插件 Cookie 策略

由于 `chrome.cookies API` 无法读取 HttpOnly 的 `sessionid`，插件绑定账号时**不再自动传 Cookie**。

**推荐流程**：

1. 用插件弹窗点「绑定插件」→ 绑定账号信息（secUid + 昵称）
2. 在 Chrome DevTools → Application → Cookies 复制完整 Cookie 字符串
3. 粘贴到 portal 页面的 Cookie 输入框
4. 点「测试 Cookie」确认有效
5. 点「增量归档」开始抓取

四种 Cookie 采集方式（`extension/lib/cookie-collectors.js`）：

| 方法 | 名称 | 能拿 HttpOnly | 状态 |
|------|------|:---:|------|
| M1 | `chrome.cookies` API | ❌ | 当前使用 |
| M2 | `webRequest` 拦截请求头 | ✅ | 备用（折叠区） |
| M3 | CDP 远程调试协议 | ✅ | 备用（折叠区） |
| M4 | Native Messaging 读 SQLite | ✅ | 备用（折叠区） |

## 全量 / 增量归档

- **全量归档**：账号无任何内容时自动触发，重新抓取所有内容
- **增量归档**：已有内容时自动触发，只抓取新增内容
- 页面顶部和每个账号旁都有归档按钮，自动判断模式

## 意见反馈

- 左下角 GitHub 图标 → [github.com/lovesakuratears/DoLike/issues/new](https://github.com/lovesakuratears/DoLike/issues/new)
- 设置面板 → 意见反馈 → 同上链接

## 重置密码

```bash
cd server
# 1. 生成新密码 hash
node --input-type=module -e "
import argon2 from 'argon2';
const h = await argon2.hash('yourpassword', { type: argon2.argon2id });
console.log(h);
"
# 2. 写入数据库
sqlite3 prisma/dev.db "UPDATE LocalUser SET passwordHash='<hash>' WHERE id=1;"
```

## 推荐阅读顺序

1. [docs/PRD.md](./docs/PRD.md)
2. [docs/Backend-Architecture.md](./docs/Backend-Architecture.md)
3. [docs/HANDOFF.md](./docs/HANDOFF.md)
4. [docs/STATUS.md](./docs/STATUS.md)

## 安全与边界

- 仅用于归档当前登录账号自己可见的内容
- 抖音 Cookie 加密存储，不明文落盘或写入日志
- 所有服务默认只对本机开放
- 不在 README、注释或提交说明里使用"去水印""批量分发"等描述

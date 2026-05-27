# DoLike

DoLike 是一个运行在本机的抖音个人归档项目，用来把当前登录账号下与“我”相关的内容保存到本地，并提供离线浏览能力。

当前仓库已经不再是单纯的“抖音仿站”前端集合，而是演进为一个以**本地归档**为主线的 monorepo：

- `server/`：本地后端，负责本地账号、抖音账号接入、归档调度、下载队列、媒体分发、进度推送
- `web/`：前端工作区，当前主要使用 `dolike-portal` 承载本地归档界面
- `extension/`：MV3 浏览器扩展骨架，用于在真实浏览器登录态下把列表推送到本地后端
- `docs/`：PRD、架构、前端调整、交接和进度文档

## 当前定位

- 目标：个人备份、离线浏览、本机使用
- 不做：点赞、评论、关注、私信等写操作
- 不做：共享部署、二次分发、云端同步
- 默认仅监听 `127.0.0.1`

## 当前状态

项目已经完成了 M0-M2 的主要骨架，已经具备以下能力：

- 本地账号注册、登录、会话保持、修改密码
- 抖音账号接入的后端骨架：扫码登录、手动 Cookie、浏览器插件桥接
- 视频类内容的归档主链路：列表抓取、入库、下载队列、进度推送、本地媒体播放
- 音乐收藏、我的合集、收藏合集的后端归档链路已开始接入
- 前端“我的归档”页的账号面板、视频网格批量管理、本地播放器修复
- MV3 插件骨架和桥接接口

当前最重要的已知阻塞：

- CloakBrowser 扫码路径存在 `secUid` 识别错误，可能把内容归档到错误账号
- 插件桥接链路（握手 + 推送）已有完整代码，待真实环境联调验证
- 收藏夹、稍后再看的前端 Tab 尚未接通（后端已支持）

更完整的进度和待办见：

- [项目进度与 TODO](/Users/sakura/Documents/DoLike/docs/STATUS.md)
- [交接文档](/Users/sakura/Documents/DoLike/docs/HANDOFF.md)
- [产品需求文档](/Users/sakura/Documents/DoLike/docs/PRD.md)
- [后端架构文档](/Users/sakura/Documents/DoLike/docs/Backend-Architecture.md)
- [前端调整说明](/Users/sakura/Documents/DoLike/docs/Frontend-Adjustment.md)

## 目录结构

```text
DoLike/
├── docs/
├── extension/
├── server/
├── web/
└── pnpm-workspace.yaml
```

## 开发环境

- Node.js `>= 20`：后端要求
- pnpm：用于管理前端工作区依赖
- SQLite：后端通过 Prisma 使用本地数据库

说明：

- `web/` 下部分旧子项目仍保留较早期的抖音前端实现，它们对当前“个人归档”主流程不是同等优先级。
- 当前真正围绕归档主线持续演进的是 `server/`、`web/packages/dolike-portal/` 和 `extension/`。

## 本地启动

### 1. 启动后端

```bash
cd /Users/sakura/Documents/DoLike/server
pnpm install
pnpm prisma:generate
pnpm dev
```

默认监听：

- API：`http://127.0.0.1:7777`（可通过 PORT 环境变量修改）
- 健康检查：`GET /api/health`

默认归档目录：

- `~/.dolike-archive`

### 2. 启动前端 portal

```bash
cd /Users/sakura/Documents/DoLike/web
pnpm install
pnpm portal
```

然后打开本地 portal 开发地址。当前开发环境里，portal 会通过 Vite 代理把 `/api`、`/media`、`/ws` 转发到 `127.0.0.1:7777`。

### 3. 可选：加载浏览器扩展

如需验证插件桥接链路，可参考：

- [extension/README.md](/Users/sakura/Documents/DoLike/extension/README.md)

## 重置密码

如果忘记本地账号密码，可以通过以下步骤重置：

```bash
cd /Users/sakura/Documents/DoLike/server

# 1. 生成新密码 hash（替换 yourpassword 为你想要的密码）
node --input-type=module -e "
import argon2 from 'argon2';
const h = await argon2.hash('yourpassword', { type: argon2.argon2id });
console.log(h);
"

# 2. 将输出的 hash 写入数据库
sqlite3 prisma/dev.db "UPDATE LocalUser SET passwordHash='<输出的hash>' WHERE id=1;"
```

或者使用 Prisma Studio 可视化操作：

```bash
npx prisma studio
```

然后在 `LocalUser` 表中直接修改 `passwordHash` 字段。

**注意：** 修改密码后所有已登录会话会失效，需要重新登录。

## 推荐阅读顺序

第一次接手项目时，建议按这个顺序看：

1. [docs/PRD.md](/Users/sakura/Documents/DoLike/docs/PRD.md)
2. [docs/Backend-Architecture.md](/Users/sakura/Documents/DoLike/docs/Backend-Architecture.md)
3. [docs/HANDOFF.md](/Users/sakura/Documents/DoLike/docs/HANDOFF.md)
4. [docs/STATUS.md](/Users/sakura/Documents/DoLike/docs/STATUS.md)

## 安全与边界

- 仅用于归档当前登录账号自己可见、与自己相关的内容
- 抖音 Cookie 不应明文落盘或写入日志
- 不在 README、注释或提交说明里使用“去水印”“批量分发”等描述
- 所有服务默认只对本机开放

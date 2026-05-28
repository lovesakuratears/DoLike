# 抖音 / TikTok 个人归档系统 — 后端架构文档

> 版本：v0.1（初稿，配套 `PRD.md` v0.1）
> 范围：本文档仅讨论后端 + 浏览器插件 + 桌面启动壳，前端仅给出"调整指南"
> 仓库目录约定：在 `DoLike/` 下新增 `server/`（Node 后端）、`extension/`（Chrome 插件）；前端继续用 `web/packages/dolike-portal`

---

## 1. 全景架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Local Machine (127.0.0.1)                         │
│                                                                          │
│  ┌─────────────────┐    HTTP/WS    ┌──────────────────────────────────┐  │
│  │  dolike-portal  │ ─────────────▶│  Local Backend  (Node + Fastify) │  │
│  │  (Vue 3)        │ ◀───────────  │  :7777                            │  │
│  └─────────────────┘    SSE         │                                  │  │
│                                     │  ┌──────────────────────────┐    │  │
│                                     │  │ AuthModule (本地账号)     │    │  │
│  ┌─────────────────┐                │  ├──────────────────────────┤    │  │
│  │ Browser Plugin  │  POST /bridge  │  │ DouyinSession (三路统一)  │    │  │
│  │  (Chrome MV3)   │ ──────────────▶│  ├──────────────────────────┤    │  │
│  └─────────────────┘                │  │ DouyinClient (HTTP 抓取)  │    │  │
│         ▲                           │  ├──────────────────────────┤    │  │
│         │ inject 一键归档按钮       │  │ CloakBrowser (headless)   │    │  │
│         │ 读取 douyin.com 登录态    │  ├──────────────────────────┤    │  │
│         ▼                           │  │ ArchiveService (列表入库) │    │  │
│  ┌─────────────────┐                │  ├──────────────────────────┤    │  │
│  │  www.douyin.com │                │  │ DownloadWorker (队列)     │    │  │
│  └─────────────────┘                │  ├──────────────────────────┤    │  │
│                                     │  │ LibraryService (浏览/搜索) │   │  │
│                                     │  ├──────────────────────────┤    │  │
│                                     │  │ MediaServer (Range 流式)   │   │  │
│                                     │  ├──────────────────────────┤    │  │
│                                     │  │ Scheduler (定时增量)       │   │  │
│                                     │  └──────────────────────────┘    │  │
│                                     │            │                     │  │
│                                     │            ▼                     │  │
│                                     │   SQLite + 文件系统               │  │
│                                     └──────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

3 个独立可部署单元：
- **server/** — Node.js 本地后端（核心）
- **extension/** — Chrome MV3 桥接插件（方案 C）
- **web/packages/dolike-portal** — 现有 Vue 前端，做减法调整

---

## 2. 技术选型

| 维度 | 选型 | 理由 |
| --- | --- | --- |
| 语言 / 运行时 | Node.js ≥ 20 LTS + TypeScript | 与现有前端同栈；社区抓取库齐全；前端工程师可直接维护 |
| HTTP 框架 | **Fastify** | 比 NestJS 轻；插件化；原生支持 WebSocket / SSE / Range；启动快 |
| ORM | **Prisma** | 类型安全；SQLite migration 成熟；前端 ts 类型可共享 |
| 数据库 | SQLite（WAL 模式） | 单文件、本地零配置；全文搜索用 `FTS5` 虚拟表 |
| 任务队列 | 进程内队列（**自研轻量**，落库到 `download_task` 表） | 单进程单用户场景，引入 BullMQ + Redis 过重 |
| 无头浏览器 | **CloakBrowser**（用户指定）；环境缺失时回退 Playwright + `playwright-extra` + `stealth` 插件 | 指纹伪装应对抖音前端风控 |
| 抖音签名 | 抽出 `DouyinSigner` 模块，参考 `mafqla/douyin-api`（`a_bogus` / `X-Bogus` 签名） | 仅在 cookie 模式（A/B）下需要；C 走插件直采绕开 |
| 文件下载 | `undici` + Range 分片 + `fs.createWriteStream` | 比 axios 性能好；原生 stream / abort 支持 |
| 加密 | `node:crypto` `scrypt` 派生 + `aes-256-gcm` 加密 cookie | 标准库够用 |
| 密码哈希 | `argon2`（`node-argon2`） | 比 bcrypt 抗 GPU 攻击更好 |
| 进程封装 | 第一阶段 CLI（`pnpm dev:server`）；M5 评估 Electron 壳 | 先跑通核心，再决定是否打成桌面应用 |

---

## 3. 模块拆分（server/）

```
server/
├── prisma/
│   └── schema.prisma             # 数据模型
├── src/
│   ├── main.ts                   # Fastify 启动入口
│   ├── config.ts                 # 配置加载（~/.dolike-archive/config.json）
│   ├── core/
│   │   ├── crypto.ts             # cookie 加解密 + push_token
│   │   └── logger.ts
│   ├── auth/
│   │   ├── auth.controller.ts    # /api/auth/register|login|logout|change-password
│   │   ├── auth.service.ts       # argon2 + session
│   │   └── session.middleware.ts # 注入 currentUser
│   ├── douyin/
│   │   ├── session.service.ts    # 统一 DouyinSession (A/B/C 三路)
│   │   ├── cloak.driver.ts       # 方案 A：headless 启动 + 截图 QR
│   │   ├── manual.driver.ts      # 方案 B：cookie 校验 + 落库
│   │   ├── bridge.controller.ts  # 方案 C：/api/bridge/push 端点
│   │   ├── signer.ts             # a_bogus / X-Bogus 签名
│   │   └── client.ts             # 封装 fetch + 自动签名 + 自动选 session
│   ├── archive/
│   │   ├── archive.service.ts    # 列表拉取 → 去重 → 入库 → 入下载队列
│   │   ├── fetchers/
│   │   │   ├── post.fetcher.ts          # user_post
│   │   │   ├── like.fetcher.ts          # user_like
│   │   │   ├── collect-video.fetcher.ts # user_collect_video + folder
│   │   │   ├── collect-music.fetcher.ts # user_collect_music
│   │   │   ├── collect-mix.fetcher.ts   # user_collect_mix + mix_detail
│   │   │   ├── self-mix.fetcher.ts      # user_mix
│   │   │   └── watch-later.fetcher.ts   # watch_later_list
│   │   └── dedup.ts              # 跨分类硬链接去重
│   ├── download/
│   │   ├── worker.ts             # 工作线程 (worker_threads)
│   │   ├── queue.service.ts      # 任务调度 + 限速 + 重试
│   │   └── range.ts              # 断点续传
│   ├── library/
│   │   ├── library.controller.ts # /api/library/*
│   │   └── library.service.ts    # 搜索 / 筛选 / 排序 (基于 FTS5)
│   ├── media/
│   │   └── media.controller.ts   # /media/* Range 静态分发
│   ├── scheduler/
│   │   └── scheduler.service.ts  # 定时增量
│   └── ws/
│       └── progress.gateway.ts   # 推送进度 / 失效 / 增量通知
└── package.json
```

---

## 4. 数据模型（Prisma Schema 摘要）

> 完整字段见 `prisma/schema.prisma`；下表给出关键表与字段，决定后端 ↔ 前端契约。

```prisma
// 本地账号（v1 单用户，结构支持多用户）
model LocalUser {
  id           Int      @id @default(autoincrement())
  username     String   @unique
  passwordHash String
  createdAt    DateTime @default(now())
  sessions     LocalSession[]
  douyinAccounts DouyinAccount[]
  settings     UserSetting?
}

model LocalSession {
  token     String   @id           // 写入前端 HttpOnly cookie
  userId    Int
  expiresAt DateTime
  user      LocalUser @relation(fields: [userId], references: [id])
}

// 抖音账号（一个本地用户可挂多个抖音号）
model DouyinAccount {
  id            Int      @id @default(autoincrement())
  localUserId   Int
  secUid        String   @unique
  nickname      String
  avatarUrl     String?
  cookieEnc     String?              // 方案 A/B 落库的加密 cookie；C 无 cookie 时为 null
  cookieSource  String                // 'cloak' | 'manual' | 'bridge'
  isValid       Boolean  @default(true)
  lastCheckAt   DateTime?
  pushToken     String?  @unique     // 方案 C 推送鉴权
  createdAt     DateTime @default(now())
  user          LocalUser @relation(fields: [localUserId], references: [id])
}

// 设置
model UserSetting {
  userId             Int     @id
  archiveRoot        String                            // 数据目录
  shortVideoSec      Int     @default(60)              // 长短视频阈值
  downloadConcurrency Int    @default(3)
  syncIntervalMin    Int     @default(0)               // 0=关闭, 30/60/360/720/1440
  user               LocalUser @relation(fields: [userId], references: [id])
}

// ============ 内容主表（多分类共享，通过 ContentLink 软关联） ============

enum ContentKind { VIDEO MUSIC MIX_VIDEO } // MIX 本身是容器，不进 content
enum LinkKind  { POST LIKE FAVORITE WATCH_LATER COLLECT_FOLDER COLLECT_MUSIC COLLECT_MIX SELF_MIX }

model Content {
  id              Int      @id @default(autoincrement())
  douyinAccountId Int
  awemeId         String                 // 抖音原始 ID
  kind            ContentKind
  title           String
  desc            String?
  authorSecUid    String
  authorName      String
  durationSec     Int                    // 视频时长（音乐为音频时长），用于长短筛选
  publishAt       DateTime               // 抖音发布时间（用于排序与目录分桶）
  archivedAt      DateTime @default(now())
  coverPath       String?                // 本地封面相对路径
  mediaPath       String?                // 本地视频/音频相对路径
  mediaSize       BigInt?
  originUrlExpiredAt DateTime?           // 抖音 url 时效
  rawMeta         Json                   // 完整原始 JSON
  status          String   @default("pending") // pending|downloading|done|failed
  errorMsg        String?

  @@unique([douyinAccountId, awemeId, kind])
  @@index([douyinAccountId, publishAt])
  @@index([durationSec])
}

// 同一 awemeId 可能既是个人作品又被自己喜欢 → 通过 link 多对一
model ContentLink {
  id         Int      @id @default(autoincrement())
  contentId  Int
  linkKind   LinkKind
  folderId   String?              // 收藏夹 ID（仅 COLLECT_FOLDER）
  mixId      String?              // 合集 ID（仅 SELF_MIX / COLLECT_MIX）
  linkedAt   DateTime @default(now())
  content    Content @relation(fields: [contentId], references: [id])

  @@unique([contentId, linkKind, folderId, mixId])
}

// 合集容器（音乐没有容器概念，所以只有 Mix）
model Mix {
  id              Int      @id @default(autoincrement())
  douyinAccountId Int
  mixId           String
  kind            String   // 'self' | 'collected'
  name            String
  authorSecUid    String
  authorName      String
  coverPath       String?
  itemCount       Int      @default(0)
  rawMeta         Json
  publishAt       DateTime?

  @@unique([douyinAccountId, mixId])
}

// 下载任务（持久化队列）
model DownloadTask {
  id          Int      @id @default(autoincrement())
  contentId   Int
  url         String
  targetPath  String
  bytesDone   BigInt   @default(0)
  bytesTotal  BigInt?
  attempts    Int      @default(0)
  status      String   @default("queued") // queued|running|done|failed
  lastError   String?
  enqueuedAt  DateTime @default(now())
  finishedAt  DateTime?
  @@index([status])
}

// FTS5 全文索引（虚拟表，迁移脚本里手写）
// CREATE VIRTUAL TABLE content_fts USING fts5(title, desc, authorName, content='Content', content_rowid='id');
```

**索引策略**：
- `Content(douyinAccountId, publishAt)` → 列表页"按发布时间倒序"主索引
- `Content(durationSec)` → 长短视频筛选
- `content_fts` → 搜索框
- `ContentLink(contentId, linkKind)` → 视频 Tab 子筛选（作品/喜欢/收藏/稍后再看）

---

## 5. 三路登录与统一身份层

### 5.1 模块协作

```
                  ┌────────────────────────┐
   UI 切换 A/B/C  │  /api/douyin/login/*   │
  ─────────────▶ │  SessionController     │
                  └──────────┬─────────────┘
                             │
              ┌──────────────┼───────────────┐
              ▼              ▼               ▼
        cloak.driver   manual.driver    bridge.controller
              │              │               │
              │  cookie     │ cookie         │ 无 cookie
              ▼              ▼               ▼
        ┌─────────────────────────────────────────┐
        │  session.service.upsert(DouyinAccount)  │
        │   → 校验 → 加密落库 → 通知 WS            │
        └─────────────────────────────────────────┘
```

`DouyinClient.request()` 调用时按以下优先级取 cookie：

```ts
function pickSession(accountId: number): SessionPickResult {
  const acc = db.douyinAccount.find(accountId);
  if (acc.cookieSource === 'cloak' && acc.isValid) return { cookie: decrypt(acc.cookieEnc) };
  if (acc.cookieSource === 'manual' && acc.isValid) return { cookie: decrypt(acc.cookieEnc) };
  return { cookie: null, reason: 'fallback-to-bridge' };
  // 如果 cookie 为 null，所有"需要主动调抖音 API"的操作都暂停，
  // 等待 bridge.push 投喂列表；下载用最后一次已知 cookie 尝试，失败入待重试。
}
```

### 5.2 方案 A：CloakBrowser 无头扫码

时序：

```
前端                  Backend                  CloakBrowser
 │ POST /api/douyin/login/cloak/start
 ├─────────────────────▶│
 │                      │ launch headless (stealth)
 │                      ├─────────────────────▶│
 │                      │                       │ goto douyin.com
 │                      │                       │ click 登录
 │                      │                       │ wait QR <canvas|img>
 │                      │ screenshot QR area    │
 │                      │◀──────────────────────┤
 │ WS  qr.png (base64)  │
 │◀─────────────────────┤
 │                      │ loop: cookies()        │
 │                      │   until sessionid OK   │
 │                      │                        │
 │ WS  login.success    │ profile/self/ 校验    │
 │◀─────────────────────┤ upsert DouyinAccount   │
                        │ close browser          │
```

实现注意：
- 二维码定位：先取登录弹窗 DOM 节点（CSS selector + 兜底 `canvas` 元素遍历），裁剪截图。
- 风控对抗：CloakBrowser 缺失时回退 Playwright + stealth 插件 + 随机化 UA / 时区 / WebGL / Canvas hash。
- 超时：3 次刷新 QR 失败，自动给前端推 `cloak.failed`，前端折叠到方案 B。

### 5.3 方案 B：手动 Cookie 粘贴

- 前端贴入 → POST `/api/douyin/login/manual` 带 `cookie` 字符串。
- 后端立即调 `user_info` 校验 → 通过即 `upsert(DouyinAccount, source='manual')`。
- 失败返回明确错误码：`COOKIE_INVALID` / `COOKIE_INCOMPLETE`（缺 `sessionid` 等关键字段）。

### 5.4 方案 C：浏览器插件桥接

#### 插件结构

```
extension/
├── manifest.json          # MV3
├── background.ts          # 长连接、配置存储
├── content-script.ts      # 注入 douyin.com，挂"一键归档"按钮
├── popup.html / popup.ts  # 设置后端地址 + push_token
└── lib/
    ├── collectors.ts      # 各分类列表抓取（复用页面已加载的 axios / fetch）
    └── push.ts            # POST /api/bridge/push
```

#### 协议：`POST /api/bridge/push`

```json
{
  "push_token": "本地账号在设置页生成",
  "sec_uid": "MS4wLjABAAAA...",
  "nickname": "用户昵称",
  "source_kind": "like" | "favorite_video" | "favorite_music" |
                 "favorite_mix" | "self_mix" | "self_post" | "watch_later",
  "items": [ /* 抖音原始 JSON 列表，最多 200 条/批 */ ],
  "fetched_at": "2026-05-24T12:34:56Z",
  "is_incremental": true
}
```

后端处理：
1. 校验 `push_token` → 找到 `LocalUser` 与目标 `DouyinAccount`。
2. 把 `items` 走与 fetcher 相同的入库管线（即"内容入库 + 下载入队"完全复用）。
3. 返回 `{ accepted: N, deduped: M, queued: K }` 给插件展示 toast。

**关键设计**：插件只投喂"列表"，不投喂"视频本体"。下载始终是后端的事，因为：
- 视频文件大，跨域上传费 UI 资源；
- 插件无 stealth 能力，反而 cookie 健壮；后端拿到 url 立刻就近下载更稳。

如果 A/B 都失效、C 的列表已到位但下载失败 → 入"待重试"队列；下次任一渠道 cookie 重新有效时自动消费。

### 5.5 三路并存原则

| 场景 | A | B | C |
| --- | --- | --- | --- |
| A 已登录，C 又推一批新增 | A 继续抓 | 无 | C 增量入库（同一 DouyinAccount） |
| A cookie 失效 | 抓取暂停 | 引导用户切 B | C 仍能推送列表，下载靠待重试 |
| 用户从未登录 A/B，只装了 C | 无 | 无 | C 投喂列表 + 下载在 cookie 缺失时挂起 |
| A 与 B 都成功（用户在两台机器粘贴） | 共享同一 DouyinAccount，cookie 覆盖最新一次 | 同 | 同 |

---

## 6. 抓取 → 入库 → 下载 流水线

```
ArchiveService.startFull(accountId)
   │
   ├─▶ 并发拉取 7 个 fetcher（每个 fetcher 内部串行翻页）
   │      ├─ post.fetcher       → list<aweme>
   │      ├─ like.fetcher       → list<aweme>
   │      ├─ collect-video.fetcher (展开收藏夹)
   │      ├─ collect-music.fetcher
   │      ├─ collect-mix.fetcher (展开 mix → 视频列表)
   │      ├─ self-mix.fetcher
   │      └─ watch-later.fetcher
   │
   ├─▶ Dedup：以 (douyinAccountId, awemeId, kind) 为主键 upsert Content
   │            同一视频在多分类出现时只生成 ContentLink，不重建 Content
   │
   ├─▶ enqueue DownloadTask(content.mediaUrl)
   │
   └─▶ enqueue DownloadTask(content.coverUrl)
```

**增量模式**：fetcher 拉首页 → 检测命中已存在 awemeId → 立即停翻页。

**抖音 URL 时效**：列表返回的 `play_addr.url_list` 通常 6-12h 失效。流水线策略：
- 入库时记录 `originUrlExpiredAt = now + 5h`（保守）；
- DownloadWorker 取任务时若 `expiredAt < now`，先重新调 `video_detail` 刷 URL 再下载；
- 仍失败 → 标记 task `failed`，待下次增量同步重新发现。

**下载并发**：`UserSetting.downloadConcurrency`（默认 3），由 `queue.service` 控制 token bucket。

---

## 7. 定时增量发现（Scheduler）

```ts
// scheduler.service.ts
class Scheduler {
  start(userId: number) {
    const interval = settings.syncIntervalMin;
    if (interval === 0) return; // 关闭
    cron.schedule(`*/${interval} * * * *`, async () => {
      for (const acc of await accountsOf(userId)) {
        try {
          await archive.startIncremental(acc.id);  // 用 A→B 顺序
        } catch (e) {
          if (e.code === 'NO_VALID_COOKIE') {
            ws.broadcast('sync.waiting_bridge', { secUid: acc.secUid });
            // 等 C 下次推送
          }
        }
      }
    });
  }
}
```

UI 设置项：`关闭 / 30min / 1h / 6h / 12h / 24h`，立即生效（变更后重新挂 cron）。

---

## 8. API 接口（前端契约）

> 所有非 `/api/auth/*` 接口都要求登录 session；所有响应统一 `{ code, data, message }`。

### 8.1 鉴权
| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/api/auth/setup` | 首次启动注册（仅在 DB 无 user 时可调） |
| POST | `/api/auth/login` | 用户名 + 密码登录，返回 session cookie |
| POST | `/api/auth/logout` | 销毁 session |
| POST | `/api/auth/change-password` | 修改密码（cookie 重加密） |

### 8.2 抖音账号
| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/douyin/accounts` | 当前本地用户挂的所有抖音账号 |
| POST | `/api/douyin/login/cloak/start` | 启动无头扫码（异步，结果走 WS） |
| POST | `/api/douyin/login/cloak/cancel` | 取消 |
| POST | `/api/douyin/login/manual` | 手动 cookie 粘贴 |
| POST | `/api/douyin/accounts/:id/push-token` | 生成/旋转方案 C 的 push_token |
| POST | `/api/bridge/push` | 方案 C 插件入口（鉴权用 push_token，不用 session） |
| DELETE | `/api/douyin/accounts/:id` | 解绑 |

### 8.3 归档触发
| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/api/archive/full` | `{ accountId }` 全量归档 |
| POST | `/api/archive/incremental` | 增量 |
| POST | `/api/archive/item` | `{ contentId }` 单项重新下载 |
| GET | `/api/archive/progress` | 当前任务概览（首屏用，长流走 WS） |

### 8.4 本地浏览（核心：前端三大 Tab 全部走这里）
| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/library/videos` | 视频列表，query: `linkKind=POST|LIKE|FAVORITE|WATCH_LATER`、`length=long|short|all`、`q`、`sort=publish|archived|duration`、`page`、`size` |
| GET | `/api/library/music` | 音乐列表 |
| GET | `/api/library/mixes` | 合集列表，`kind=self|collected` |
| GET | `/api/library/mixes/:id/items` | 合集下视频 |
| GET | `/api/library/content/:id` | 详情（用于播放页） |
| DELETE | `/api/library/content/:id` | 删除本地副本（DB 标记 + 文件移到 trash/） |

### 8.5 媒体分发
| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/media/...path` | 文件服务，支持 `Range`，xgplayer 直接消费 |

### 8.6 WebSocket
路径：`/ws`，事件类型：
- `qr.update` — 方案 A 推送二维码 base64
- `login.success` / `cloak.failed`
- `download.progress` — `{ taskId, bytesDone, bytesTotal }`
- `archive.summary` — 全量归档完成
- `sync.found_new` — 定时发现增量
- `sync.waiting_bridge` — 等待方案 C 投喂

---

## 9. 文件组织（落地版）

与 PRD §3.6 一致，补充实现细节：

- **硬链接去重**：`fs.link(srcPath, dstPath)`。同一 `awemeId` 出现在多分类时，`Content` 表只一条，`ContentLink` 多条；文件系统侧通过硬链接在不同目录暴露（同一 inode）。
- **跨卷回退**：硬链接失败（如数据目录跨设备）→ 退化为 SQLite 中的"逻辑链接"，前端按 `ContentLink` 取同一 `mediaPath`。
- **临时文件**：下载中文件落 `tmp/<task_id>.part`，完成 `fsync` 后 rename 到目标位置。
- **配置文件**：`~/.dolike-archive/config.json` 存数据根路径、端口、日志级别。

---

## 10. 启动与运行

```bash
# 一次性
cd server && pnpm install
pnpm prisma migrate dev

# 日常
pnpm dev:server        # tsx watch src/main.ts，监听 127.0.0.1:7777
pnpm dev:portal        # 现有 Vue dev server，3000 端口
                       # vite.config.ts 加新 proxy：/api → 7777, /media → 7777, /ws → 7777

# 浏览器插件
cd extension && pnpm build
# 浏览器 -> 加载已解压扩展程序 -> dist/
```

`server/src/main.ts` 启动时：
1. 加载 / 创建 `~/.dolike-archive/config.json`
2. 启动 SQLite + 跑 migration
3. 启动 Fastify (7777)
4. 启动 Scheduler（按 settings 挂 cron）
5. 启动 DownloadWorker 池

---

## 11. 错误处理与可观测

- 统一错误码：`AUTH_*` / `DOUYIN_*` / `DOWNLOAD_*` / `STORAGE_*`。
- 日志：`pino`，按天滚动到 `~/.dolike-archive/logs/`。
- 抖音接口失败 → 自动指数退避（1s, 3s, 9s）3 次；仍失败标记 cookie 可疑，触发 WS `cloak.failed`。
- DB migration 失败 / 文件权限错 → 启动期 fatal，前端展示"启动失败"详情页。

---

## 12. 安全 / 法务

- Fastify 强制 `host: '127.0.0.1'`，拒绝外网访问。
- 所有写接口要 session cookie；`/api/bridge/push` 走独立 `push_token` 鉴权且对 IP 同样限定 127.0.0.1。
- 抖音 cookie 用 `argon2(password, salt) → scrypt 派生 key → aes-256-gcm` 加密；用户改密码时需在前端流式重加密（M5 任务）。
- README 加免责声明：仅本人可见内容、不可二次分发、不挑战平台 ToS。

---

## 13. 与现有前端 (`dolike-portal`) 的衔接（详见任务 #3 调整文档）

后端的 API 设计已经按"前端做减法"思路定型。前端需要做的最小调整：

| 改动点 | 说明 |
| --- | --- |
| 新增登录 / 注册页 | `/auth/setup` `/auth/login`，路由守卫所有页 |
| `my/index.vue` Tab 重排 | 顶层改为 `视频 / 音乐 / 合集`，原 `posts/like/favorite_collection/watch_later` 收为"视频"下子筛选；删除 `record` |
| `user-search-bar` 升级 | 顶部固定，加 `[长视频][短视频][全部]` 三态切换 |
| `request.ts` baseURL | 由当前直连 douyin.com 改为本地 `http://127.0.0.1:7777`（dev 走 vite proxy） |
| 视频播放 | xgplayer 的 url 改为 `/media/<contentId>/video.mp4`（后端按 Range 响应） |
| WebSocket Hook | 新增 `useArchiveProgress` 监听 `/ws`，更新顶部进度 + toast |
| 抖音登录浮层 | 新组件 `DouyinLoginPanel`，标签页 A/B/C，默认 A |

---

## 14. 已确认的后端决策

| 项 | 决策 | 备注 |
| --- | --- | --- |
| 无头浏览器 | **CloakBrowser** ([CloakHQ/CloakBrowser](https://github.com/CloakHQ/CloakBrowser))，Node 入口：`npm install cloakbrowser playwright-core` | 首启会下载 ~200MB Chromium；macOS 145、Linux/Windows 146；返回标准 Playwright Browser/Page 对象，`page.screenshot()` 与 `context.cookies()` 直接可用 |
| 回退方案 | 若 CloakBrowser 安装失败（Gatekeeper / 网络），回退 `playwright + playwright-extra + stealth` | `cloak.driver.ts` 内部检测可用性后选择 |
| 数据库 | SQLite（WAL + FTS5） | 单用户 + 个人量级足够 |
| 监听端口 | `127.0.0.1:7777`（固定） | 与浏览器插件协议一致；冲突时改 `config.json` |
| 桌面壳 | **v1 CLI 启动**，前后端各跑一个进程；前端稳定后用 **Docker** 打包分发（M5） | Electron 暂不做 |
| 浏览器插件 | **MV3，未签名，本地"加载已解压扩展程序"**；不上 Chrome Web Store | 单机本地工具，无分发需求；后续需公开分发时再申请开发者账号上架 |

### 14.1 插件未签名 / 本地加载的风险与缓解

- **风险**：未签名插件每次 Chrome 升级到主版本时可能触发"未受支持扩展"警告；MV3 强制 service worker 模型，闲置后会休眠。
- **缓解**：插件功能定位为"用户主动点击触发的一键采集"，不依赖常驻；service worker 休眠不影响功能。
- **后续升级路径**：v2 申请 Chrome Web Store unlisted 发布（仅自己可见链接安装），保留未签名 zip 作 Edge / Brave 备选。

### 14.2 Docker 打包分发计划（M5）

```
dolike-archive (Compose)
├── server         (Node 20 + CloakBrowser binary, expose 7777)
└── 数据卷 ./data → /root/.dolike-archive
```

- 前端 build 产物由 server 静态托管（合一镜像），用户只需 `docker compose up`。
- 浏览器插件独立 zip，README 给安装指引。
- 因 CloakBrowser 镜像有 ~200MB Chromium，单镜像约 800MB-1GB，分发用 GHCR 或私有镜像源。

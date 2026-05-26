# DoLike 交接文档

> 写给下一位接手 DoLike 项目的 AI agent / 工程师。
>
> 上工前请先读：`SKILL.md`（`.claude/skills/douyin-archive/SKILL.md`）→ `docs/PRD.md` → `docs/Backend-Architecture.md` → 本文件。
>
> 最近一次更新：2026-05-25

---

## 1. 当前状态快照

### 1.1 进程

- `tsx watch src/main.ts` 进程残留（PID 9246），但 **7777 端口未在监听**（应是 watch 期间编译/重载失败崩掉了）。
- 下一位接手前请先 `kill 9246` 然后 `cd server && pnpm dev` 重启，否则前端连不上。

### 1.2 数据库（`server/prisma/dev.db`）

```
LocalUser       = 1   id=1, username=admin
DouyinAccount   = 1   id=3, nickname=SakuraLove
                      secUid=MS4wLjABAAAAoq2QwAek4hvTx_yH7J3EJFaa3XOJYF9zxiwNAReY_o4  ← 错的，见 §3.1
                      cookieSource=cloak, isValid=1
Content         = 63  全部 hidden=1（去重墓碑），全部 authorName='若无盆景'（不是 SakuraLove）
ContentLink     = 63  全部 linkKind=POST
DownloadTask    = 0
```

`Content` 这 63 行是上一次错账号归档后被批量隐藏的「墓碑」—— `hidden=true` 仍占着 awemeId，可让增量归档不重抓。如果下一位准备清空重新开始（推荐），直接 `DELETE FROM Content; DELETE FROM ContentLink; DELETE FROM DownloadTask;` 即可（DouyinAccount 也建议清掉，因为里面的 secUid 是错的 —— 见 §3.1）。

### 1.3 磁盘

- `~/.dolike-archive/`：5.5MB（绝大部分是 `debug/` 下旧的 cloakbrowser 截图、`logs/`、`tmp/` 残留）。`accounts/` 下视频/封面已清空。
- 保留 `.machine.key` + `.keystore.json`（cookie 加密主密钥，不要删，否则现有 `cookieEnc` 全废）。

### 1.4 前端

- portal dev server（如果开着）跑在 3001，vite 代理 `/api`、`/media`、`/ws` 到 `127.0.0.1:7777`。
- 重要改造组件已落地（见 §2.4），下一位继续扩展时不要重写。

---

## 2. 已完成

### 2.1 M0 / M0.5（文档与决策冻结）✅

`docs/PRD.md`、`docs/Backend-Architecture.md`、`docs/Frontend-Adjustment.md` 完整；冻结决策见 `SKILL.md §3`。

### 2.2 M1（账号体系 + 登录骨架）✅

- `server/src/auth/`：argon2 密码 + HttpOnly session cookie（7 天），`/api/auth/{setup,login,logout,status,change-password}`
- `server/src/douyin/`：
  - `cloak.driver.ts` —— CloakBrowser 扫码（**但 secUid 提取有 bug，见 §3.1**）
  - `cloak.ws.ts` —— `/ws/douyin/cloak?session=<id>` 推送扫码进度
  - `bridge.service.ts` —— 浏览器插件推 token + payload（`/api/bridge/push`）
  - `manual` —— 手动粘 cookie：`/api/douyin/accounts/manual`
- `server/src/core/keystore.ts` —— AES-GCM 加密 cookie，scrypt(machine_key, salt) 派生
- 路由：`/api/douyin/accounts` CRUD + `/api/douyin/accounts/cloak/{start,:id/cancel}`

### 2.3 M2（归档 / 下载 / 浏览 / 插件骨架）✅ 大部分

| 模块 | 文件 | 状态 |
| --- | --- | --- |
| 浏览器即签名器 | `server/src/douyin/{browser.runtime,browser.session,dy-client}.ts` | ✅ 见 [[m2-architecture-decisions]] |
| 三路 fetcher | `server/src/archive/fetchers/{post,like,collect-video}.fetcher.ts` | ✅ async generator |
| 归档调度 | `server/src/archive/archive.service.ts` | ✅ + 暂停/恢复/停止（本会话补） |
| 下载队列 | `server/src/download/{queue.service,worker.entry,range}.ts` | ✅ worker_threads + 主线程 Prisma；本会话加了全局暂停/恢复/中止 |
| 库查询 | `server/src/library/library.service.ts` | ✅ + `hideContents`（软删墓碑） |
| 媒体分发 | `server/src/media/media.controller.ts` | ✅ Range/206 |
| 进度 WS | `server/src/ws/progress.gateway.ts` | ✅ `/ws/progress` |
| MV3 插件 | `extension/` | ✅ 骨架（manifest + popup + background + content-script + collectors）；具体每个 linkKind 的采集逻辑还要完善 |

### 2.4 本会话新落地的功能

**后端**：
- `archive.service.ts` 加 `pauseArchive / resumeArchive / stopArchive / getArchiveStatus`，promise-gate 拦在 `runFetcher` 的 `for await` 之前；stop 用 `gen.return(undefined)` 切断上游 HTTP。
- `queue.service.ts` 加全局 `paused` 标志 + `pauseQueue / resumeQueue / stopQueue`；pump 在 paused 时停发；worker abort 时如果是暂停态写 `status='paused'`。
- 路由：`POST /api/archive/{pause,resume,stop}`、`POST /api/download/{pause,resume,stop}`。
- `/api/archive/progress` 现在带 `archiveStatuses: Record<accountId, status>` 和 `paused` 计数。
- Prisma 模型加 `Content.hidden / hiddenAt` + `@@index([hidden])`，migration `20260525032512_content_hidden_flag` 已执行。
- `library.service.ts.hideContents()`：物理删本地文件（含 `.part`，路径前缀必须落在 `archiveRoot/accounts`）+ 删 `DownloadTask` + `updateMany` 置 `hidden=true / status='hidden' / mediaPath=null / coverPath=null`；**`ContentLink` 行保留作为去重墓碑**，增量归档的 `loadKnownIds` 会带上 hidden 的 awemeId 跳过重抓。

**前端**：
- `views/my/components/AccountsPanel.vue` 重写：每账号 2s 轮询状态 → 运行中显示「暂停 / 终止」，暂停显示「继续 / 终止」，idle/finished 显示「全量 / 增量」；底部全局队列条带显示 running/queued/paused/done/failed 计数 + 三个全局按钮。
- `views/my/components/VideoGrid.vue` 加批量管理：「选择」进入选择模式 → 卡片显示 checkbox，工具条出现「全选本页 / 反选 / 清空选择 / 从视频中移除(N) / 退出选择」；删除走 ElMessageBox 二次确认，文案明确「保留去重记录，下次增量归档不会重新下载」。
- `views/my/components/LocalPlayer.vue` 修了「点视频不播」的 bug：`watch(() => props.item?.id, init, { flush: 'post', immediate: true })`，原因是默认 `flush:'pre'` 时 `<div ref="playerEl">` 还没挂载，xgplayer 初始化拿不到 DOM。
- `api/local.ts` 加 `archivePause/Resume/Stop`、`downloadPause/Resume/Stop`、`batchDeleteContents`。

---

## 3. 已知阻塞 Bug

### 3.1 ⛔ secUid 提取错误（导致归档到错误账号）

**现象**：
- 用户实际登录的是 SakuraLove（抖音号 `23730158307`，主页 `https://www.douyin.com/user/MS4wLjABAAAA42z9O_1sQLxs0BlMLlhAvRebP9RR3vQPOIo3hgzg9CmNNMGryTcxG7s53O6x1zJx`）。
- 扫码完成后后端 DB 里写入的 `DouyinAccount.secUid` 是 `MS4wLjABAAAAoq2QwAek4hvTx_yH7J3EJFaa3XOJYF9zxiwNAReY_o4`（错的），后续 `user_post` 拉到的全是「若无盆景」的视频（共 63 条）。
- 第一次尝试修复：上一会话把 `cloak.driver.ts` 改成 API 优先 —— `page.evaluate(() => fetch('/aweme/v1/web/user/profile/self/'))`，按理说携带登录 cookie 时该接口该返回当前用户。**但仍然返回错的 secUid。**

**怀疑根因**（未验证）：
1. 扫码过程中弹出验证码中间页（用户也在最近一条消息里确认看到了），CloakBrowser 在验证码完成前可能就采到 cookie / 触发了 `profile/self/`，此时 cookie 还没绑定到正确的 sessionid。
2. CloakBrowser 复用 context 时残留了其他账号的 storage state（虽然代码里看着每个 session 都 launch 新 context，需要再核对 `browser.runtime.ts`）。
3. `profile/self/` 在未完成滑块验证时可能返回访客身份或缓存身份。

**用户决策**：放弃 CloakBrowser 扫码这一路，转向 MV3 浏览器插件桥接方式（用真实浏览器登录后由插件把 cookie/secUid 推给后端，绕开 headless captcha）。**但插件接入「暂时不制作」**，所以下一位 agent 不要立刻开工实现插件登录，先等用户排期。

**短期手段**：
- 改用 `manualPanel.vue`（手动粘 cookie），实测可绕开 captcha。但需要用户自己从浏览器 devtools 复制 cookie 串，UX 比较差。
- 或者等用户开 M3+ 时再统一做插件 push 登录的端到端串联（`extension/` 骨架已经在）。

### 3.2 ⚠️ 扫码验证码中间页

CloakBrowser 当前没有处理「滑块验证码 / 短信验证码 / 风险确认」这类中间页。用户网络指纹被风控后会卡在这里，前端 `CloakPanel.vue` 一直显示 `waiting_qr`/`scanning` 不动。

如果未来还要走 CloakBrowser，需要：
- `cloak.driver.ts` 监听 `/passport_fe/*` / `/verifycenter/*` URL，遇到就 emit 一个 `verification_required` stage；
- 前端弹一个「请在打开的浏览器中完成验证」提示并把 cloakbrowser 切到 `headless: false` 让用户手动完成。

---

## 4. 待做（按里程碑）

### 4.1 紧贴当前的两个清理项

1. **服务进程清理 + 数据库回归干净**：
   ```bash
   kill 9246
   cd /Users/sakura/Documents/DoLike/server
   sqlite3 prisma/dev.db "DELETE FROM ContentLink; DELETE FROM DownloadTask; DELETE FROM Content; DELETE FROM DouyinAccount;"
   # 保留 LocalUser、保留 keystore
   pnpm dev
   ```
2. **secUid bug 后续走向**：等用户决定何时实现插件登录路径；在那之前可以用 manual cookie 验证后端归档/下载链路。

### 4.2 M3（用户已批准为下一里程碑）

- **音乐 / 合集 / 收藏夹 / 稍后再看** 的 fetcher：参考 `post.fetcher.ts`，对应抖音接口表见 `SKILL.md §5`。
- **FTS5 全文搜索**：迁移 `Content.title/desc/authorName` 到一张 FTS 虚表，替换 `library.service.ts` 里的 `contains` LIKE。
- 前端「音乐 / 合集」两个 Tab 接通（目前 `views/my/index.vue` 只有「视频」是真接的）。

### 4.3 M4（连播 + 视频详情页）

- 合集连播（mix 内多视频顺播）
- 单视频详情页（侧栏切换上下条）

### 4.4 M5（增量调度 + 分发）

- `UserSetting.syncIntervalMin` 实现定时增量
- Cookie 失效 UI（前端账号卡显示 `isValid=false` 时的提示与重登入口）
- Docker Compose（PRD §14；arm64/x86 双架构 QA）

### 4.5 长期细节

- 「取消隐藏 / 恢复」按钮（目前 `hidden=true` 后没有 UI 路径恢复，只能 SQL `UPDATE Content SET hidden=0 ...`）。
- CloakBrowser 路径如果重启用，要修 §3.1 §3.2。
- `cloak.driver.ts` 里几处 `LOGIN_BUTTON_SELECTORS` 是历史多重试兜底，可以等真要修扫码登录时再加固。

---

## 5. 架构契约（不要随便改）

详见 [[m2-architecture-decisions]]，三条：

1. **浏览器即签名器**：所有签名走 `page.evaluate(fetch(...))`，**不要手写 `a_bogus`**。
2. **worker_threads 只跑 HTTP，主线程独占 Prisma**：worker 里禁止 `import @prisma/client`。
3. **`extension/` 是 no-build 纯 ES module MV3**：不要引入 vite/crxjs/tsconfig（除非以后明确加 build 步骤）。

另外几条来自 `SKILL.md §7` 的硬红线：

- ⛔ 服务**只能** bind `127.0.0.1`，永远不要 `0.0.0.0`。
- ⛔ 抖音 cookie 不能明文落盘 / 落日志；只走 `keystore.ts` 加密。
- ⛔ 不实现「点赞/评论/关注/私信」等写抖音接口。
- ⛔ 文档 / commit / README 不要出现「绕过版权」「去水印」「批量分发」这类说法（本项目仅个人备份用）。
- ⚠️ 抖音视频 URL 6-12h 过期 —— 下载链路出错先看是不是 URL 过期，必要时回调 `video_detail` 刷新。
- ⚠️ 签名 403 先看 `browser.session.ts` 是不是没启动好，**不要去改业务代码**。

代码风格：用户可见文案一律简体中文；TypeScript strict + 禁 `any`；commit / PR 不写 emoji 也不写 "Generated by ..."。

---

## 6. 入口文件速查表

| 想干什么 | 先看 |
| --- | --- |
| 后端启动 / 路由注册 | `server/src/main.ts` |
| 抖音签名 | `server/src/douyin/browser.session.ts` + `dy-client.ts` |
| 扫码登录（⚠️ 有 bug） | `server/src/douyin/cloak.driver.ts` + `cloak.ws.ts` |
| 手动 cookie 登录 | `server/src/douyin/manual.service.ts` |
| 插件桥接（未联调） | `server/src/douyin/bridge.service.ts` + `extension/` |
| 归档主调度 | `server/src/archive/archive.service.ts` |
| 下载队列 | `server/src/download/queue.service.ts` + `worker.entry.ts` |
| 库查询 / 隐藏 | `server/src/library/library.service.ts` |
| 媒体 Range 分发 | `server/src/media/media.controller.ts` |
| Schema | `server/prisma/schema.prisma` |
| 前端「我的」聚合页 | `web/packages/douyin-portal/src/views/my/index.vue` |
| 前端账号面板 | `views/my/components/AccountsPanel.vue` |
| 前端视频网格 / 批量管理 | `views/my/components/VideoGrid.vue` |
| 前端本地播放 | `views/my/components/LocalPlayer.vue` |
| 前端 API 客户端 | `src/api/local.ts` |
| 抖音 URL 对照表 | `web/packages/douyin-portal/src/api/urls.ts` |

---

## 7. 记忆文件（`~/.claude/projects/-Users-sakura-Documents-DoLike/memory/`）

- `MEMORY.md` —— 索引
- `m2-milestone-status.md` —— M2 已落 vs 还没落（**本次更新**）
- `m2-architecture-decisions.md` —— 三条架构约束（不变）
- `jiji262-borrowed-features.md` —— 借鉴 jiji262/douyin-downloader 的特性清单
- `secuid-bug-and-login-pivot.md` —— secUid 提取 bug + 用户决定放弃扫码转插件（**新增**）
- `sakuralove-identity.md` —— 用户的正确 secUid / 抖音号，供验证（**新增**）

下一位 agent 第一步应当读 `MEMORY.md` 拿到上述指针。

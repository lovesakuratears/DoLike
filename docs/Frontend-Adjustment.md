# 前端调整清单（v0.1，待你逐项确认）

> 目标：把现有 `douyin-web/packages/douyin-portal` 从"抖音克隆站"改造成"抖音归档浏览器"。
> 原则：**最大化复用现有组件**，能改就不删，能藏就不动，**新建只在必要时**。
> 阅读方式：每一节末尾的 ❓ 是要你拍板的开放问题。

---

## A. 路由与登录守卫

### A.1 [改] `router/routes.ts` — 砍掉抖音原生入口

**现状**（左侧菜单）：
```
/hot, /live, /vs, /drama, /user/self
```
**改后**：
```
/auth/setup, /auth/login          —— 不在菜单
/my                                —— 主入口（重命名自 /user/self）
/my/settings                       —— 设置（数据目录、长短阈值、定时间隔、抖音账号管理）
/my/accounts                       —— 抖音账号管理（A/B/C 登录入口）
/my/queue                          —— 归档任务队列（进度、失败重试）
```

**保留**（otherRoutes）：
- `/video/:id` → 改播放本地视频（接本地 mediaPath）
- `/note/:id` → 暂时保留，归档可能含图文笔记，M3 再处理
- `/search/:keyword` → **改造**为本地搜索结果页（v1 可不做独立路由，搜索结果直接渲染在 /my 列表）

**删**：
- `/hot`、`/live`、`/vs`、`/drama` 全部路由 + 对应 `views/hot.vue`、`views/live.vue`、`views/theater.vue`
- `views/discover/`（发现页，不在归档范围）
- `views/user/:id`（其他用户主页，不归档别人的内容）
- `views/modal-player.vue`、`views/sidebar-modal-player.vue` → 评估后保留（播放器壳）

❓ A.1.1：抖音原生页面（hot/live/discover 等）**直接删源码**，还是只移路由保留源码？建议直接删，避免 dead code 漂浮。
❓ A.1.2：`/note/:id` 图文笔记 v1 要支持吗？（PRD 没明确）

### A.2 [加] 路由守卫 — 强制本地登录

`router/index.ts` 的 `router.beforeEach` 是空的，要写：

```ts
router.beforeEach(async (to) => {
  if (to.path.startsWith('/auth/')) return true
  const auth = useLocalAuthStore()
  if (!auth.hasLocalUser) return { path: '/auth/setup' }   // DB 无账号 → 强制注册
  if (!auth.isLoggedIn) return { path: '/auth/login' }     // 未登录 → 登录页
  return true
})
```

后端启动后第一次开页：`GET /api/auth/status` → `{ hasUser: false }` → 跳 setup；之后 `/api/auth/status` → `{ hasUser: true, loggedIn: false }` → 跳 login。

❓ A.2：通过。

---

## B. 本地账号登录页（新增）

### B.1 [加] `views/auth/setup.vue`

首次启动注册页，单字段：
- 用户名（3-20 字符，字母数字下划线）
- 密码 + 确认密码（≥ 8 字符）
- 提交 → `POST /api/auth/setup` → 自动登录 → 跳 `/my`

UI 风格：复用现有 `ui/button/button.vue` 等基础组件，全屏单卡片。

### B.2 [加] `views/auth/login.vue`

- 用户名 + 密码
- "记住我"复选（默认勾选，影响 session 时长）
- 提交 → `POST /api/auth/login` → 跳 `/my`

### B.3 ❓现有 `components/auth/login/{login,pass-login,code-login,qr-login}.vue` 怎么处理？

它们原本是**抖音登录**用的。两种选择：

| 方案 | 描述 | 推荐 |
| --- | --- | --- |
| **保留并改名** | 改为 `components/douyin-login/` 复用其 UI 给方案 A/B/C 浮层 | ✅ 推荐：节省工作量，UI 一致性好 |
| **删除重写** | 全新写 `components/local-auth/` + `components/douyin-login/` | 更干净但多写一倍 UI |

❓ B.3：选哪个？

---

## C. 抖音账号登录浮层（新增）

需要一个三标签浮层，对应后端三路登录。位置：`/my/accounts` 页面 + `+ 添加抖音账号` 按钮触发。

### C.1 [加] `components/douyin-login/index.vue`（容器）

```
┌─────────────────────────────────────┐
│  [无头扫码]  [手动粘贴]  [插件桥接]   │  ← 三标签
├─────────────────────────────────────┤
│   <slot: 当前面板>                   │
└─────────────────────────────────────┘
```

默认展示「无头扫码」；CloakBrowser 启动失败时自动切到「手动粘贴」。

### C.2 [加] `components/douyin-login/cloak-panel.vue`

- 进入即调 `POST /api/douyin/login/cloak/start`，监听 WS `qr.update`
- 中央展示二维码图像（base64）
- 下方文字：「请用抖音 App 扫码」+ 倒计时 60s
- 收到 WS `login.success` → 关闭浮层 + toast「已添加账号 xxx」

### C.3 [加] `components/douyin-login/manual-panel.vue`

- 多行文本框（textarea，monospace 字体）
- 提示文字：「从浏览器开发者工具 → Application → Cookies → 复制 douyin.com 下全部 cookie 字符串到此」
- 「校验并保存」按钮 → `POST /api/douyin/login/manual`
- 错误码映射：`COOKIE_INCOMPLETE` → "缺少 sessionid 字段"；`COOKIE_INVALID` → "校验失败，请确认登录态"

### C.4 [加] `components/douyin-login/bridge-panel.vue`

- 显示已生成的 push_token（带 `复制` 和 `旋转`）
- 显示插件安装指引：
  ```
  1. 下载插件 zip → 设置页底部
  2. Chrome 进入 chrome://extensions
  3. 打开右上角 "开发者模式"
  4. 点击 "加载已解压扩展程序"，选择解压后的目录
  5. 点击插件图标，粘贴 push_token，保存
  6. 在 www.douyin.com 任意"我的"页右上角点击「归档」按钮
  ```
- 下方实时展示「最近 5 条推送」列表（来自 WS `bridge.received` 事件）

❓ C.4：插件 zip 是从后端 `/api/extension/download` 提供，还是只在文档里给 GitHub Release 链接？建议前者，单机自包含。

---

## D. 「我的」主页改造（核心）

### D.1 [改] `views/my/index.vue` — Tab 重排

**现状**（5 顶层 Tab）：
```
[作品] [喜欢] [收藏] [观看记录] [稍后再看]
```

**改后**（3 顶层 Tab + 子筛选）：
```
┌────────────────────────────────────────────────────────────┐
│ [🔍 搜索框 .........]    [长视频] [短视频] [全部]  [⚙ 设置] │
├────────────────────────────────────────────────────────────┤
│ [视频]  [音乐]  [合集]                                       │
├────────────────────────────────────────────────────────────┤
│ 视频 → [作品] [喜欢] [收藏] [稍后再看]                       │
│ 音乐 → [收藏的音乐]                                          │
│ 合集 → [我的合集] [收藏的合集]                               │
├────────────────────────────────────────────────────────────┤
│ ... 内容列表 ...                                             │
└────────────────────────────────────────────────────────────┘
```

实现层面：
- 顶层三大 Tab 复用 `user-tab` 组件（传新 `tabs` 数组）
- 视频 Tab 内的子筛选用 `user-tabbar-2` 或 `tabs-item`
- 现有路由 query 从 `?showTab=like` 改为 `?tab=video&sub=like`

**移除**：
- 观看记录 Tab（PRD 已剔除）
- `user-record` 组件 + `views/my` 中所有 `record` 分支

❓ D.1：通过。

### D.2 [改] `user-search-bar/index.vue` — 升级为顶部固定 + 长短筛选

- 现状是"点击展开"的小搜索框；改为**始终展开 + 固定顶部**
- 右侧并入「长视频 / 短视频 / 全部」三态切换
- 搜索 emit 改为 `search({ q, length })`
- 阈值 60s 从 `stores/settings.ts` 读

### D.3 [改] 子内容组件 — 全部改打本地后端

| 组件 | 当前接口 | 改后接口 |
| --- | --- | --- |
| `user-post` | `apis.user_post` | `GET /api/library/videos?linkKind=POST` |
| `user-like` | `apis.user_like` | `GET /api/library/videos?linkKind=LIKE` |
| `user-collection/collection-video` | `apis.user_collect_video` | `GET /api/library/videos?linkKind=FAVORITE` |
| `user-collection/collection-folder` | `apis.user_collect_folder` | `GET /api/library/folders` + `?folderId=` |
| `user-collection/collection-music` | `apis.user_collect_music` | `GET /api/library/music` |
| `user-collection/collection-mix` | `apis.user_collect_mix` | `GET /api/library/mixes?kind=collected` |
| `user-watch-later` | `apis.watch_later_list` | `GET /api/library/videos?linkKind=WATCH_LATER` |

无需改 props / template，只改取数函数和翻页字段（后端统一 `{ items, total, hasMore }`）。

### D.4 [删] `user-record` 组件

`views/my/index.vue` 里删除 `record` 分支 + 删 `components/user/user-record/` 目录。

### D.5 [改] `user-post` 子 Tab 简化

现有：`video / private_post / mix / playlet`
- `playlet`（短剧）→ ❓ 删？v1 PRD 没把短剧纳入归档范围
- `private_post` → ❓ 私密作品要归档吗？后端能拉（`/aweme/v1/web/private/aweme/`），但 cookie 必须有效

❓ D.5.1：短剧 (`post-playlet.vue`) 删还是留？建议删，v1 范围内没有。
❓ D.5.2：私密作品 (`post-private.vue`) 删还是留？建议留（PRD §3.3 "个人作品"包含）。

### D.6 [删] `user-collection/collection-playlet`

短剧合集，同 D.5.1。

---

## E. 顶部全局栏（新增）

### E.1 [加] 归档进度条（layout 顶部）

- 后端 WS `download.progress` → 顶部薄条状（类似 GitHub Action 进行中那种）
- 鼠标悬停展开：当前下载文件名 + 队列长度 + 失败数
- 点击跳 `/my/queue`

### E.2 [加] 抖音账号切换器

- 顶栏右侧下拉，列出当前本地用户挂的所有 `DouyinAccount`
- 选中后所有列表用该账号过滤
- "+ 添加账号" → 弹 `components/douyin-login/index.vue` 浮层

### E.3 [加] 本地账号菜单

- 头像点击 → 下拉「修改密码 / 退出登录」
- "退出登录" → `POST /api/auth/logout` → 跳 `/auth/login`

---

## F. 视频播放页

### F.1 [改] `views/video/index.vue` — 播放本地文件

- 播放器 url 改为 `/media/<contentId>/video.mp4`，xgplayer 支持 Range，无需改逻辑
- 元数据从 `GET /api/library/content/:id` 取，原始 `rawMeta` 用于展示作者 / 标题 / 描述
- "下一个" 按钮 → 取当前列表上下文里的下一条本地视频
- ❓ 在线 / 本地切换：如果本地下载失败 / 文件被删，要不要回退到抖音原 url 直播？建议有按钮但默认本地。

### F.2 [改] 视频卡片 `video-components/video-list/video-item.vue`

- 封面改本地路径 `/media/<contentId>/cover.jpg`
- 角标加「✅ 已归档 / ⏬ 下载中 / ❌ 失败」状态
- 右键 / 长按菜单：「重新下载 / 删除本地副本 / 在文件管理器中显示」

---

## G. Store 重构

### G.1 [改] `stores/user.ts` — 拆分

现状：单一 store 存抖音用户信息 + token。
拆为：

| 新 Store | 作用 |
| --- | --- |
| `stores/local-auth.ts` | 本地账号：`{ username, isLoggedIn, hasLocalUser, sessionExpiresAt }` |
| `stores/douyin-accounts.ts` | 抖音账号列表 + `currentAccountId` 切换 |
| `stores/archive.ts` | 任务队列状态，订阅 WS |
| `stores/settings.ts` | `shortVideoSec / downloadConcurrency / syncIntervalMin / archiveRoot` |

旧 `stores/user.ts` 删除（用法替换为上面 4 个）。

❓ G.1：通过。

---

## H. API 层

### H.1 [改] `api/request.ts` — baseURL

```diff
- baseURL: import.meta.env.VITE_BASE_URL,
+ baseURL: '/api',     // 通过 vite proxy 转 127.0.0.1:7777
```

### H.2 [重写] `api/urls.ts` + `api/apis.ts`

按后端架构 §8 的端点列表重写。删除所有抖音直连 URL。
保留 `api/tyeps/` 类型定义（仍用于 rawMeta 字段类型）。

### H.3 [改] `vite.config.ts`

- 删 `/douyin` proxy（不再直连抖音）
- 改 `/api` proxy target 为 `http://127.0.0.1:7777`
- 加 `/media` 和 `/ws` proxy

---

## I. 其他需要删/藏的

| 文件 / 目录 | 处置 | 理由 |
| --- | --- | --- |
| `views/hot.vue` | 删 | 抖音热点，归档无关 |
| `views/live.vue` | 删 | 直播，归档无关 |
| `views/theater.vue` | 删 | 放映厅 + 短剧 |
| `views/discover/` | 删 | 发现页 |
| `views/user/:id` | 删 | 其他用户主页 |
| `views/search/` | 评估 | 全局搜索可改造为本地搜索，或砍掉只用 `/my` 顶栏搜索 |
| `components/header/login-button/` | 改 | 现在是"抖音登录"按钮 → 改为本地账号头像下拉 |
| `components/my/login-code/` | 删 | 旧抖音验证码登录组件 |
| `composables/` 中拉抖音接口的 hooks | 逐个评估 | 大概率删 |

❓ I：以上这批我打算**直接删源码**，要保留备份吗（git 已保留历史）？

---

## J. 不动的部分（明确保留）

- `components/video-components/` 播放器相关（xgplayer 包装），改取数 URL 即可
- `components/ui/` 通用按钮、loading、error-page、svg-icon、switch-button
- `layout/index.vue`（仅改菜单）
- `utils/`、`hooks/`、`directives/`
- `assets/`（图标、SCSS 变量）
- `views/404.vue`

---

## K. 工作量估计（粗，仅供排期参考）

| 模块 | 工作量 |
| --- | --- |
| A 路由 + 守卫 | 0.5d |
| B 本地账号登录页 | 1d |
| C 抖音三路登录浮层 | 2d（CloakBrowser 端不在前端） |
| D 「我的」Tab 重排 + API 改造 | 1.5d |
| E 顶部进度条 + 账号切换 | 1d |
| F 视频播放页本地化 | 0.5d |
| G Store 重构 | 0.5d |
| H API/Vite 配置 | 0.5d |
| I 删冗余源码 | 0.5d |
| **合计** | **~8 人日**（不含联调与 bug 修复） |

---

## L. 等你拍板的问题清单（汇总）

| # | 问题 | 我的推荐 |
| --- | --- | --- |
| A.1.1 | 抖音原生页面直接删源码 vs 仅移路由 | **直接删**（git 保留历史） |
| A.1.2 | `/note/:id` 图文笔记 v1 支持？ | **不支持**，M3+ 再评估 |
| B.3 | 现有 `auth/login/*` 复用改名 vs 重写 | **复用改名为 `douyin-login/`** |
| C.4 | 插件 zip 由后端提供下载 vs 文档给链接 | **后端 `/api/extension/download` 提供** |
| D.5.1 | 短剧 (`post-playlet`) 删？ | **删** |
| D.5.2 | 私密作品 (`post-private`) 保留？ | **保留** |
| F.1 | 本地播放失败回退到抖音原 url？ | **保留按钮但默认本地** |
| I | 删冗余源码要不要先备份分支？ | **不用，git 历史够了** |

如果以上推荐你都同意，回复"按推荐走"即可；个别想调整就指出对应编号。

确认后我把这份 + Backend-Architecture 一起 freeze，进入 M1 实现（搭 server/ 脚手架 + 本地账号注册登录）。

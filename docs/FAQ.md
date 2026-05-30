# DoLike 常见问题解答 (FAQ)

## 基础使用

### Q1: DoLike 是什么？和抖音官方客户端有什么区别？

DoLike 是一个运行在本机的抖音个人归档工具，用于将你抖音账号下的视频、音频、合集等内容保存到本地硬盘，并提供离线浏览。它不是抖音的替代客户端——它只做"读取和备份"，不做发布、点赞、评论等写操作。

### Q2: 我需要安装什么才能使用？

需要 Node.js 20+ 和 pnpm 包管理器。项目自带 SQLite 数据库，无需额外安装数据库软件。浏览器扩展需要 Chrome 或 Edge 浏览器。

### Q3: 数据存在哪里？

默认存储在 `~/.dolike-archive/` 目录下。你可以在设置中修改数据目录路径。目录结构如下：

```
~/.dolike-archive/
├── db/app.sqlite        # 元数据索引
├── accounts/            # 各抖音账号的内容文件
├── tmp/                 # 下载临时文件
└── logs/                # 运行日志
```

---

## 抖音接入

### Q4: 为什么有三种登录方式？我该选哪个？

三种方式互不替代、可以并存：

- **方案 A（扫码）**：最方便，后端自动启动无头浏览器打开抖音登录页，你扫码即可。需要安装 CloakBrowser 依赖（首次会自动下载约 200MB 的 Chromium）。
- **方案 B（粘贴 Cookie）**：最稳的兜底方案。从 Chrome DevTools 复制完整 Cookie 字符串粘贴即可。适合扫码失败或不想装额外依赖的场景。
- **方案 C（扩展）**：安装浏览器扩展后，在真实抖音页面上一键推送列表。即使 A/B 的 Cookie 失效，C 仍可正常工作。

默认推荐 A → B → C 的顺序尝试。

### Q5: 如何从 Chrome 获取抖音 Cookie？

1. 在 Chrome 中登录 `douyin.com`
2. 按 F12 打开 DevTools → Application → Cookies → `douyin.com`
3. 复制所有 Cookie，整理成 `name1=value1; name2=value2; ...` 格式
4. 粘贴到 DoLike 的 Cookie 输入框

或者直接使用扩展的 M2/M3/M4 Cookie 采集方式自动获取。

### Q6: Cookie 多久会失效？失效了怎么办？

抖音 Cookie 有效期不固定，通常数天到数周。DoLike 会在抓取失败时检测到 Cookie 失效并在前端提示。重新导入有效 Cookie 后，失败的下载任务会自动加入重试队列。

### Q7: 支持多个抖音账号吗？

支持。一个本地账号下可以绑定多个抖音账号，每个账号的数据独立存储在不同的子目录中。

---

## 归档与下载

### Q8: 全量归档和增量归档有什么区别？

- **全量归档**：重新抓取所有内容。适用于首次使用或账号内容不多时。
- **增量归档**：仅抓取上次归档之后新增的内容，遇到已存在的记录即停止。适用于日常使用。

系统会自动判断：账号无内容时走全量，有内容时走增量。你也可以手动选择模式。

### Q9: 下载速度慢怎么办？

下载并发数默认 3，你可以在设置中调高（最多建议不超过 5，过高可能触发抖音风控）。下载支持断点续传，中断后会自动恢复。

### Q10: 为什么有些视频下载失败了？

常见原因：

1. **抖音视频链接过期**（通常 6-12 小时失效）：入队后未及时下载，下次增量同步时会重新发现。
2. **Cookie 失效**：重新导入有效 Cookie 后，失败任务会自动重试。
3. **网络问题**：下载队列支持 3 次自动重试，仍失败可手动重试。

### Q11: 下载的视频文件存在哪里？

按照内容分类和发布时间组织：

```
accounts/<douyin_sec_uid>/
├── posts/2024/2024-08/<aweme_id>/video.mp4
├── likes/...
├── favorites/<folder_id>/...
├── watch_later/...
├── music/<music_id>/audio.mp3
└── mixes/created/<mix_id>/...
```

同一视频出现在多个分类（如既在作品又在喜欢）时使用硬链接，不重复占用磁盘。

---

## 浏览器扩展

### Q12: 浏览器扩展需要上架 Chrome Web Store 吗？

不需要。扩展仅供本地使用，直接在 `chrome://extensions/` 中以"开发者模式"加载即可。扩展不上架公开商店。

### Q13: 扩展的四种 Cookie 采集方式有什么区别？

| 方法 | 能拿 HttpOnly Cookie | 适用场景 |
| --- | :---: | --- |
| M1 chrome.cookies API | 否 | 最简单，只需点击即可 |
| M2 webRequest 拦截 | 是 | 需先访问抖音页面 |
| M3 CDP 远程调试 | 是 | 需 Chrome 以 `--remote-debugging-port=9222` 启动 |
| M4 Native Messaging | 是 | 最强，需安装本地 Python 脚本 |

大多数场景下 M1 已足够，因为抖音的关键鉴权字段可能不全是 HttpOnly。如需完整 Cookie，推荐 M2 或 M3。

---

## 播放与浏览

### Q14: 本地播放器支持什么格式？

播放器基于 xgplayer，支持 MP4 视频格式。后端通过 HTTP Range 实现流式播放，支持拖拽进度条。本地文件不可用时自动回退到抖音线上链接。

### Q15: 搜索功能支持什么？

全文搜索（基于 SQLite FTS5），支持匹配视频标题、描述、作者昵称、音乐标题。同时支持按长短视频（阈值 60s，可调）和发布时间筛选。

---

## 故障排查

### Q16: 启动后端报端口被占用

默认端口 7777。可通过环境变量 `PORT=其他端口` 修改。注意修改后前端 Vite 代理配置和扩展配置也需要同步更新。

### Q17: 数据库如何重置？

```bash
cd server
# 清空归档数据（保留本地账号和抖音账号绑定）
sqlite3 prisma/dev.db "DELETE FROM Content; DELETE FROM ContentLink; DELETE FROM DownloadTask;"

# 完全重置（删除数据库文件，重新迁移）
rm prisma/dev.db
pnpm prisma:migrate
```

### Q18: 如何修改本地账号密码？

在前端设置页面直接修改，或通过命令行重置（如果忘记了密码）：

```bash
cd server
node --input-type=module -e "
import argon2 from 'argon2';
const h = await argon2.hash('新密码', { type: argon2.argon2id });
console.log(h);
"
# 将输出的 hash 写入数据库
sqlite3 prisma/dev.db "UPDATE LocalUser SET passwordHash='<hash>' WHERE id=1;"
```

---

## 安全与隐私

### Q19: 我的抖音 Cookie 安全吗？

安全。Cookie 通过以下方式保护：

1. 使用本地账号密码经 `scrypt` 派生加密密钥
2. 使用 `aes-256-gcm` 加密后存入 SQLite
3. 不写入日志、不通过网络传输
4. 后端仅监听 `127.0.0.1`，外网无法访问

### Q20: 使用 DoLike 会被抖音封号吗？

DoLike 的设计原则是"尽可能像正常用户"。抓取使用真实浏览器 Cookie 和 UA，下载并发可控。但任何第三方工具都存在一定风险，建议：

- 不要将下载并发数调得过高（建议 ≤ 5）
- 不要频繁全量归档（日常使用增量即可）
- 不要将归档内容公开分发

本工具仅供个人备份使用，使用风险自负。

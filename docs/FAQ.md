# DoLike 常见问题 (FAQ)

## 目录

- [安装与启动](#安装与启动)
- [账号绑定](#账号绑定)
- [归档与下载](#归档与下载)
- [浏览器扩展](#浏览器扩展)
- [Cookie 相关](#cookie-相关)
- [常见问题排查](#常见问题排查)

---

## 安装与启动

### Q: 如何启动项目？

需要同时启动后端和前端。

**终端 1 — 后端：**
```bash
cd server
pnpm install
pnpm prisma:generate
pnpm dev
```
看到 `Server listening at http://127.0.0.1:7777` 表示后端就绪。

**终端 2 — 前端：**
```bash
cd web/packages/dolike-portal
npx vite --mode staging --port 3002
```
看到 `Local: http://127.0.0.1:3002/` 表示前端就绪。

浏览器打开 `http://127.0.0.1:3002`。

### Q: 首次使用需要做什么？

1. 打开 `http://127.0.0.1:3002`
2. 注册本地账号（用户名 + 密码）
3. 登录后进入「我的」页面
4. 绑定抖音账号（见下方）
5. 粘贴 Cookie
6. 点击「增量归档」开始抓取

### Q: 忘记本地账号密码怎么办？

```bash
cd server
# 1. 生成新密码 hash
node --input-type=module -e "
import argon2 from 'argon2';
const h = await argon2.hash('你的新密码', { type: argon2.argon2id });
console.log(h);
"
# 2. 写入数据库（替换 <hash> 为上面的输出）
sqlite3 prisma/dev.db "UPDATE LocalUser SET passwordHash='<hash>' WHERE id=1;"
```

修改密码后所有已登录会话会失效，需要重新登录。

---

## 账号绑定

### Q: 如何绑定抖音账号？

有两种方式：

**方式一：浏览器插件（推荐）**
1. 在 Chrome 打开 `https://www.douyin.com/` 并登录
2. 点击 DoLike 扩展图标 → 配置项目 URL 和 API Key
3. 点击「绑定插件」→ 自动获取账号信息并绑定

**方式二：手动粘贴 Cookie**
1. 在 Chrome DevTools → Application → Cookies → `https://www.douyin.com`
2. 复制完整 Cookie 字符串
3. 粘贴到 portal 页面的 Cookie 输入框
4. 点击「测试 Cookie」确认有效

### Q: 绑定账号时提示 "cookie 校验失败"？

`chrome.cookies API` 无法读取 HttpOnly 的 `sessionid`，因此插件采集的 cookie 不完整。

**解决方法**：在 Chrome DevTools → Application → Cookies 中手动复制完整 Cookie 字符串，粘贴到 portal 页面。

### Q: 支持绑定多个抖音账号吗？

支持。重复绑定流程即可，每个抖音账号会独立管理。

---

## 归档与下载

### Q: 什么是全量归档和增量归档？

- **全量归档**：账号首次归档或本地无任何内容时自动触发，重新抓取所有内容
- **增量归档**：本地已有内容时自动触发，只抓取新增内容

系统会根据本地数据库中的内容数量自动判断模式，无需手动选择。

### Q: 归档按钮在哪里？

- 页面顶部右侧：「全量归档」或「增量归档」（自动判断）
- 每个账号旁：暂停 / 继续 / 终止按钮（归档进行中时显示）

### Q: 归档过程中可以暂停吗？

可以。点击「暂停」按钮，当前归档任务会暂停。点击「恢复下载」继续。

### Q: 终止归档后已下载的内容会丢失吗？

不会。终止后已下载的文件保留，支持断点续传。下次增量归档时会跳过已下载的内容。

### Q: 下载的文件保存在哪里？

默认保存在 `~/.dolike-archive/` 目录下。

### Q: 下载队列显示 "running: 0 / concurrency: 3" 是什么意思？

表示下载队列已就绪，当前没有正在下载的任务，并发数为 3。当有新的内容需要下载时，会自动开始下载。

### Q: 如何批量操作视频？

在视频列表页面：
- **全选**：选中当前页所有视频
- **反选**：反转当前选中状态
- **添加到收藏夹**：将选中视频添加到指定收藏夹
- **删除**：软删除选中视频（可从隐藏列表恢复）

---

## 浏览器扩展

### Q: 如何加载扩展？

1. 打开 `chrome://extensions/`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `extension/` 目录

### Q: 扩展需要配置什么？

- **项目 URL**：`http://127.0.0.1:7777`
- **API Key**：在 portal 页面生成的 `pt_` 开头的字符串

### Q: 扩展的 Cookie 采集方式有什么区别？

| 方式 | 说明 | 能拿 HttpOnly |
|------|------|:---:|
| M1 chrome.cookies API | 默认使用，最简单 | ❌ |
| M2 webRequest 拦截 | 从请求头读取 | ✅ |
| M3 CDP 远程调试 | 需 `--remote-debugging-port=9222` | ✅ |
| M4 Native Messaging | 需安装本地 Python 客户端 | ✅ |

M1 为当前默认方式。M2/M3/M4 在扩展弹窗底部「高级 Cookie 采集方式」折叠区，仅在需要时使用。

---

## Cookie 相关

### Q: 为什么必须要有 Cookie？

Cookie 是抖音登录态的凭证。后端需要用 Cookie 调用抖音 API 抓取内容列表和下载视频。没有 Cookie 或 Cookie 失效，归档会失败。

### Q: Cookie 会过期吗？

会。抖音 Cookie 通常有效期为数天到数周。过期后需要重新粘贴。

### Q: 如何测试 Cookie 是否有效？

在 portal 页面点击账号旁的「测试 Cookie」按钮。有效时提示「Cookie 有效 ✓」，失效时提示「Cookie 已失效」。

### Q: Cookie 安全吗？

Cookie 使用 AES-256-GCM 加密后存储在本地 SQLite 数据库中，不会明文落盘。服务仅监听 `127.0.0.1`，不对外部网络开放。

---

## 常见问题排查

### Q: 页面打不开（502 / ERR_CONNECTION_REFUSED）？

1. 确认后端是否在运行：`curl http://127.0.0.1:7777/api/health`
2. 确认前端是否在运行：`curl http://127.0.0.1:3002/`
3. 检查端口是否被占用：`lsof -i :7777 -i :3002`

### Q: 归档报错 "无可用 cookie"？

账号未绑定 Cookie 或 Cookie 已失效。解决方法：
1. 在 Chrome DevTools 复制完整 Cookie
2. 粘贴到 portal 页面
3. 点击「测试 Cookie」确认有效
4. 重新触发归档

### Q: 归档报错 "reply.status is not a function"？

这是已知 bug，GET 接口缺少 `reply` 参数导致。已修复，重启后端即可。

### Q: 视频列表为空？

1. 确认已绑定抖音账号
2. 确认 Cookie 有效
3. 确认已触发过归档
4. 检查后端日志是否有报错

### Q: 下载速度慢？

下载队列并发数默认为 3。可以在「设置 → 下载模式」中调整。

### Q: 如何反馈问题？

- GitHub Issues：[github.com/lovesakuratears/DoLike/issues/new](https://github.com/lovesakuratears/DoLike/issues/new)
- 设置面板 → 意见反馈

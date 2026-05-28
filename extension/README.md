# DoLike 扩展（MV3 / 桥接方案 C）

> 用于把抖音网页端"我的"页面下的内容（作品 / 喜欢 / 收藏）推送到本机 DoLike 后端。  
> 适用场景：方案 A（CloakBrowser 扫码）/ 方案 B（手动粘贴 Cookie）都不可用时的兜底。  
> 仅个人备份用 —— 不做内容上传、互动或对外分发。

---

## 加载步骤

1. 启动本机 DoLike 后端：
   ```bash
   cd /path/to/DoLike/server
   pnpm dev
   ```
   默认监听 `http://127.0.0.1:7777`。

2. 启动 portal 前端并完成本地账号登录：
   ```bash
   cd /path/to/DoLike/web/packages/dolike-portal
   pnpm dev
   ```
   浏览器打开 `http://127.0.0.1:3002`，注册 / 登录本地账号。

3. 在 portal 的「我的归档 → 绑定浏览器插件」流程里申请一个 `pt_*` API Key。

4. 加载本扩展：
   - 打开 `chrome://extensions/`
   - 右上角开启「开发者模式」
   - 点击「加载已解压的扩展程序」
   - 选中本目录（`/path/to/DoLike/extension`）

5. 点扩展图标 → 在弹窗里填：
   - 项目 URL：`http://127.0.0.1:7777`
   - API Key：`pt_xxxxxxxxxxxx`
   - 点「保存配置」→「测试握手」应显示绿色连通状态

6. 在 Chrome 里打开 `https://www.douyin.com/`，登录你的抖音账号。

7. 进入你自己的主页 `https://www.douyin.com/user/<SELF_SEC_UID>`，再点扩展弹窗里的操作按钮。

---

## 工作原理

```
Popup (popup.js)
   │
   ▼ chrome.runtime.sendMessage
Background (service worker)
   │
   ▼ chrome.scripting.executeScript({ world: 'MAIN', files: ['lib/collectors.page.js'] })
douyin.com 标签页 (MAIN world)
   │
   ▼ window.fetch('/aweme/v1/web/aweme/post/...', { credentials: 'include' })
   │  ← 抖音页面 JS 自动加上 a_bogus / X-Bogus / msToken
   ▼
返回 aweme_list 给 background
   │
   ▼ POST http://127.0.0.1:7777/api/bridge/push (x-push-token: pt_...)
DoLike 后端 bridge.service → archive.service → 入库 + 排下载队列
```

关键点：**所有签名都由 douyin.com 页面 JS 自己算**。扩展只是借用页面的浏览器上下文。

---

## 🔑 Cookie 采集（四种方法）

扩展弹窗新增了「Cookie 采集」区域，提供四种从浏览器获取 Cookie 的方式：

| 方法 | 名称 | 能拿 HttpOnly | 需要额外配置 | 强度 |
|------|------|:---:|:---:|:---:|
| M1 | `chrome.cookies` API | ❌ | 无 | ⭐ |
| M2 | `webRequest` 拦截请求头 | ✅ | 先访问抖音页面 | ⭐⭐ |
| M3 | CDP 远程调试协议 | ✅ | `--remote-debugging-port=9222` | ⭐⭐⭐ |
| M4 | Native Messaging 读 SQLite | ✅ | 安装本地客户端 | ⭐⭐⭐⭐ |

### 方法1：chrome.cookies API（官方推荐）

- 调用 `chrome.cookies.getAll({ domain: 'douyin.com' })`
- **优点**：官方 API，简单可靠，无需额外配置
- **缺点**：只能拿同源非 HttpOnly cookie；需要 `"cookies"` 权限
- **使用**：点击弹窗中的「M1 chrome.cookies」按钮

### 方法2：webRequest 拦截请求头

- 利用 `chrome.webRequest.onBeforeSendHeaders` 监听 douyin.com 请求
- 直接从请求头里读出 Cookie 字段
- **优点**：能拿到 HttpOnly Cookie（因为是从网络层读的）
- **缺点**：需要 `"webRequest"` 权限；需要先访问抖音页面产生请求
- **使用**：先打开抖音页面浏览一下，再点击「M2 webRequest」

### 方法3：CDP 远程调试协议（本地最强）

- 通过 WebSocket 连接 Chrome 远程调试端口
- 执行 `Network.getAllCookies` 命令
- **优点**：直接拿到浏览器完整 Cookie 库，包括所有 HttpOnly、第三方、分区 Cookie
- **缺点**：需要 Chrome 以 `--remote-debugging-port=9222` 启动
- **启动方式**（macOS）：
  ```bash
  /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
    --remote-debugging-port=9222
  ```
- **使用**：启动 Chrome 后点击「M3 CDP 远程」，可自定义端口号

### 方法4：Native Messaging 调用本地程序（终极）

- 插件通过 Native Message 调用本地 Python 脚本
- 脚本直接读取 Chrome 的 Cookies SQLite 数据库
- **优点**：理论上 100% 拿到所有 Cookie，绕过所有 JS 限制
- **缺点**：需要安装本地客户端；杀毒软件可能报毒
- **安装步骤**：
  1. 安装 Python 依赖：`pip3 install cryptography`
  2. 运行安装脚本：`cd native-host && ./install.sh`
  3. 重新加载扩展
- **使用**：点击「M4 Native」

### 自动填充

所有方法采集到的 douyin.com Cookie 会自动填入弹窗的 Cookie 文本框，并保存到配置中。

---

## 文件清单

```
extension/
├── manifest.json                    # MV3 manifest
├── background.js                    # service worker，调度采集 + 推送 + Cookie 采集
├── content-script.js                # douyin.com 页面浮层按钮
├── popup.html / popup.js            # 扩展弹窗（配置 + 触发器 + Cookie 采集 UI）
├── lib/
│   ├── config.js                    # chrome.storage.local 读写
│   ├── push.js                      # 调 /api/bridge/push
│   ├── collectors.page.js           # 注入到 douyin.com MAIN world 的采集器
│   └── cookie-collectors.js         # 四种 Cookie 采集方式
├── native-host/
│   ├── dolike_cookie_reader.py      # Native Messaging 主机（Python）
│   ├── com.dolike.cookie_reader.json # Native Messaging 清单模板
│   └── install.sh                   # 一键安装脚本
├── icons/                           # 图标
└── README.md
```

---

## 已知限制

- 插件已支持 6 种 linkKind 推送（POST/LIKE/FAVORITE/WATCH_LATER/COLLECT_FOLDER/COLLECT_MUSIC）
- 方法2 需要先访问抖音页面产生请求，否则拿到空结果
- 方法3 需要 Chrome 以远程调试模式启动，会占用 9222 端口
- 方法4 的解密功能依赖 `cryptography` Python 库
- 抖音页面 DOM 变化时浮层按钮可能定位失败 —— 通过弹窗触发是更稳妥的路径

---

## 安全边界

- 扩展**默认不读取** HttpOnly Cookie（方法1）
- 方法2/3/4 能读取 HttpOnly Cookie，但仅在用户主动点击按钮时执行
- 推送 token 是后端按账号下发的 `pt_*` 字符串，**只对应一个抖音账号**
- 后端只接受来自 `127.0.0.1` 的请求
- 不会发起任何对抖音的写操作（点赞 / 评论 / 关注 / 私信均未实现）
- 方法4 的 Native Messaging 仅在本地运行，不会联网

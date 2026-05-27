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
   （没有 UI 时也可以 `curl -X POST http://127.0.0.1:7777/api/douyin/accounts/bridge/issue ...` 拿 token —— 取决于你的版本。）

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

7. 进入你自己的主页 `https://www.douyin.com/user/<SELF_SEC_UID>`，再点扩展弹窗里的：
   - **绑定账号 (init)**：把当前抖音账号信息上送到后端，建立映射
   - **推送 个人作品 / 喜欢 / 收藏 / 稍后再看 / 收藏夹视频 / 收藏音乐**：拉取页面 API 的列表后透传到后端入库

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

关键点：**所有签名都由 douyin.com 页面 JS 自己算**。扩展只是借用页面的浏览器上下文。这样不需要在前后端手写 `a_bogus`。

---

## 文件清单

```
extension/
├── manifest.json         # MV3 manifest
├── background.js         # service worker，调度采集 + 推送
├── content-script.js     # douyin.com 页面浮层按钮
├── popup.html / popup.js # 扩展弹窗（配置 + 触发器）
├── lib/
│   ├── config.js         # chrome.storage.local 读写
│   ├── push.js           # 调 /api/bridge/push
│   └── collectors.page.js # 注入到 douyin.com MAIN world 的采集器
├── icons/                # 临时占位图标
└── README.md
```

无构建工具 —— 纯 JS + ES Module。直接「加载已解压的扩展程序」即可。

---

## 已知限制（M2 范围内）

- 插件已支持 6 种 linkKind 推送（POST/LIKE/FAVORITE/WATCH_LATER/COLLECT_FOLDER/COLLECT_MUSIC）；待真实环境联调
- 抖音页面 DOM 变化时浮层按钮可能定位失败 —— 通过弹窗触发是更稳妥的路径
- 没有图标设计，临时用纯色占位 PNG
- 没有商店上架计划

---

## 安全边界

- 扩展**不读取** `HttpOnly` 的抖音 cookie（manifest 没有 `cookies` 权限）
- 推送 token 是后端按账号下发的 `pt_*` 字符串，**只对应一个抖音账号**，撤销由后端控制
- 后端只接受来自 `127.0.0.1` 的请求；扩展 `host_permissions` 已配置 `http://127.0.0.1/*` 和 `http://localhost/*`
- 不会发起任何对抖音的写操作（点赞 / 评论 / 关注 / 私信均未实现）

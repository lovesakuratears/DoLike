# 视频音频提取功能 — 设计文档

> 版本：v1.2  
> 日期：2026-05-29  
> 状态：开发中

---

## 背景

原项目中存在通过未开放 API (`/aweme/v1/web/music/detail/`) 获取音乐详情的隐藏代码，该 API 官方未开放，存在合规风险。同时，用户需要从视频中提取原声/BGM 并保存为 MP3 的功能。

**决策**：移除未开放 API 的调用，改为使用 ffmpeg 从视频文件中直接提取音频。ffmpeg 通过 `ffmpeg-static` npm 包打包，不依赖系统安装。

---

## UI 设计规范

### 1. 整体风格
- 延续现有**圆角、轻量拟态、浅灰色背景、红色主色调、无衬线字体**
- 所有新控件与现有按钮的圆角、阴影、字体大小、颜色完全统一

### 2. 视频详情页 — 「提取音乐」按钮
- 位置：收藏按钮旁（右侧）
- 样式：与同排其他按钮完全一致（50px 图标 + 文字）
- 功能：点击后提取当前视频的原声/BGM，保存为 MP3

### 3. 个人中心页 — 标签栏
- **视频标签**：
  - 下方「作品/喜欢/收藏/稍后再看/收藏夹」子标签栏保持不变
  - 操作栏有「全选/反选/添加到收藏夹/提取音频/删除」按钮
  - 「提取音频」按钮仅在视频标签下可见
- **音乐标签**：
  - **不显示操作栏**（无全选/反选/提取音频/删除工具栏）
  - 每个音乐卡片有「播放」「下载」「删除」按钮
  - 点击「下载」通过浏览器保存 MP3 到本地
  - 点击「删除」确认后删除音频文件
- **合集标签**：保持原有逻辑不变

### 4. 搜索框（重要：已移除二级搜索框）
- **已移除**「视频」和「音乐」标签下原有的二级搜索框（`#app > div > div.right-container.min > div.my-page > div > div > input[type=text]`）
- **统一使用**页面顶部 `HeaderNav` 中的全局搜索框（`#app > div > div.right-container.min > div.douyin-header > div > div > div.header-main > div > div.header-left > div > div.header-search-form > input`）
- `search-input` 组件新增 `localSearch` prop：
  - `localSearch=false`（默认）：搜索跳转 `/search/...`（原有行为）
  - `localSearch=true`：搜索触发 `local-search` emit 事件，由 `my/index.vue` 监听并执行本地库搜索
- `HeaderNav` 通过 `route.path.startsWith('/my')` 判断是否在「我的」页面，自动切换模式
- `my/index.vue` 通过 `window.addEventListener('my-local-search', ...)` 监听全局搜索事件

### 5. 操作栏 — 「提取音频」按钮（仅视频标签）
- 位置：「添加到收藏夹」按钮右侧
- 样式规范：
  - 尺寸：与「添加到收藏夹」按钮完全一致
  - 未选中时：浅灰色背景 `#F5F5F5`，hover `#E8E8E8`
  - 文字：深灰/黑色 `#333333`，与同排按钮字重一致
  - 禁用状态：背景 `#F0F0F0`，文字 `#999999`
- 交互逻辑：与「删除」按钮一致，选中作品后才激活，支持批量操作

### 6. 音乐标签 — 卡片操作（无工具栏）
- **无工具栏**：音乐标签下不显示全选/反选/提取音频/删除操作栏
- 每个音乐卡片有 3 个按钮：
  - 「播放」：点击播放音频
  - 「下载」：点击后浏览器保存 MP3 到本地，下载中显示「下载中...」
  - 「删除」：点击后确认删除，清理本地文件
- 下载状态显示「下载中...」

---

## 架构变更

### 后端（server/）

#### 新增/修改 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/library/extract-audio` | 从视频提取音频 |
| GET | `/api/library/extracted-audio` | 获取提取的音频列表 |
| POST | `/api/library/extracted-audio/delete` | 删除提取的音频 |
| POST | `/api/library/content/batch-delete` | 批量删除内容（含文件清理） |

#### `POST /api/library/extract-audio`

**请求体**：
```json
{
  "awemeId": "视频 awemeId",
  "videoUrl": "视频下载地址",
  "title": "视频标题",
  "authorName": "作者名称",
  "durationSec": 60,
  "accountId": 1
}
```

**流程**：
1. 确定 `douyinAccountId`
2. 检查是否已提取过（`awemeId = 'extracted_' + 原始awemeId`）
3. 优先使用本地已下载视频文件，否则用在线 URL
4. ffmpeg 提取音频：`-vn -acodec libmp3lame -ab 192k -ar 44100`
5. 保存到 `archiveRoot/accounts/{accountId}/`
6. 创建 `kind='MUSIC'` Content 行 + `COLLECT_MUSIC` ContentLink

#### ffmpeg 方案
- 使用 `fluent-ffmpeg` + `ffmpeg-static` npm 包
- ffmpeg 静态二进制打包在 `ffmpeg-static` 中，不依赖系统安装
- `ffmpeg.setFfmpegPath(ffmpegStatic)` 设置路径

### 前端（web/）

#### 新增 API 方法（apis.ts）
- `extractAudio(params)` — 提取音频
- `getExtractedAudio(page, size)` — 获取提取的音频列表
- `deleteExtractedAudio(musicContentId)` — 删除提取的音频

#### 组件变更

| 组件 | 变更 |
|------|------|
| `video-action.vue` | 新增「提取音乐」按钮（收藏按钮旁） |
| `VideoGrid.vue` | 操作栏加「提取音频」按钮，选中后激活 |
| `MusicShelf.vue` | **无工具栏**，卡片有「播放」「下载」「删除」按钮 |
| `my/index.vue` | 移除二级搜索框，顶部搜索框占位符动态变化 |
| `search-input/index.vue` | 新增 `localSearch` prop |
| `HeaderNav.vue` | 在 `/my` 路由自动开启 `localSearch` |

#### 数据模型
- 复用 `Content` 表，`kind='MUSIC'` 标识提取的音频
- `awemeId = 'extracted_' + 原始awemeId`
- `ContentLink.linkKind = 'COLLECT_MUSIC'`

---

## 移除的代码

- `more-action-box.vue` 中的 `fetchMusicDetail`（未开放 API）
- 音乐播放/下载功能（依赖未开放 API）
- `MusicShelf.vue` 中的操作栏（toolbar）、选中状态逻辑（selectedIds/toggleOne/selectAllOnPage/invertOnPage）
- `my/index.vue` 中的二级搜索框（`global-search` div）
- `my/index.vue` 中的 `onMusicExtractAudio` 函数
- 相关 CSS 样式

---

## 依赖

```json
{
  "fluent-ffmpeg": "^2.1.3",
  "ffmpeg-static": "^5.2.0"
}
```

---

## 注意事项

1. 「提取音频」按钮**仅在视频标签下可见**，音乐标签下不可见
2. **音乐标签下不显示操作栏**（无全选/反选/提取音频/删除工具栏）
3. 音乐标签下每个卡片有独立的「播放」「下载」「删除」按钮
4. 搜索框统一使用顶部全局搜索框，**无二级搜索框**
5. 视频标签下操作栏的「提取音频」按钮选中逻辑与「删除」按钮一致
6. 下载通过浏览器 Blob URL 实现，保存到用户本地
7. 删除使用 `batchDeleteContents` API，同时清理本地文件

---

## 故障排查

### 提取音频失败，控制台无日志

**可能原因**：
1. **Vite dev server 挂了** — 返回 502，浏览器跑的是旧代码。重启：`cd web/packages/dolike-portal && npx vite --mode staging --port 3002`
2. **用户未登录** — 后端返回 401，前端提示"请先登录"
3. **视频未下载完成** — `mediaPath` 为 null，跳过并提示

**排查步骤**：
1. 打开浏览器控制台 → Network 面板，查看 `/api/library/extract-audio` 请求状态
2. 查看 Console 面板是否有 `[extractAudio]` 前缀的日志
3. 检查 Response 内容，确认后端返回的 code 和 message

### 返回页面状态丢失

**已修复**：从视频详情页返回时，通过 query 参数 `link` 和 `tab` 保持之前的子标签状态。

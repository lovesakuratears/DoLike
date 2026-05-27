# DoLike Web Workspace

这里是 DoLike 的前端工作区，使用 pnpm 管理多个子应用。当前仓库虽然保留了早期“抖音前端还原/演示”项目，但就项目主线而言，前端已经服务于 **DoLike 本地个人归档系统**。

## 当前重点

当前最重要的前端子项目是：

- `packages/dolike-portal`：DoLike 本地归档主界面，已承载登录后归档、浏览、播放、批量管理等功能

其余子项目仍保留在仓库中，但当前优先级较低：

- `packages/dolike-creator`：DoLike 创作者平台原型
- `packages/dolike-admin`：DoLike 管理后台原型
- `packages/api-docs`：接口文档站

## 目录结构

```text
web/
├── packages/
│   ├── api-docs/
│   ├── dolike-admin/
│   ├── dolike-creator/
│   └── dolike-portal/
├── package.json
└── pnpm-workspace.yaml
```

## 技术栈

### `dolike-portal`

- Vue 3
- TypeScript
- Vite
- Pinia
- Element Plus
- Vue Router
- xgplayer

### `dolike-creator`

- React
- TypeScript
- Vite
- Semi UI
- zustand

### `dolike-admin`

- React
- TypeScript
- Vite
- Arco Design
- Redux

## 当前完成度概览

### `dolike-portal`

- 已有较完整的页面基础和抖音风格前端组件
- 当前已接入 DoLike 本地归档相关页面和交互
- 已落地的重点包括：
  - 本地账号登录后“我的归档”主界面
  - 账号面板与归档状态轮询
  - 视频网格与批量移除
  - 本地播放器接入
  - 调用本地后端 `/api`、`/media`、`/ws`

### `dolike-creator`

- 仍以 UI 原型和部分页面为主
- 暂未作为 DoLike 当前主流程的一部分

### `dolike-admin`

- 仍以后台模板和演示页面为主
- 暂未作为 DoLike 当前主流程的一部分

## 安装依赖

```bash
cd /Users/sakura/Documents/DoLike/web
pnpm install
```

## 启动开发

### 启动 portal

```bash
cd /Users/sakura/Documents/DoLike/web
pnpm portal
```

或：

```bash
cd /Users/sakura/Documents/DoLike/web/packages/dolike-portal
pnpm dev
```

### 启动 creator

```bash
cd /Users/sakura/Documents/DoLike/web
pnpm creator
```

### 启动 admin

```bash
cd /Users/sakura/Documents/DoLike/web
pnpm admin
```

### 启动 api-docs

```bash
cd /Users/sakura/Documents/DoLike/web
pnpm api-docs
```

## 与本地后端联动

DoLike 的主前端通常需要配合同仓库的 `server/` 一起运行：

```bash
cd /Users/sakura/Documents/DoLike/server
pnpm dev
```

后端默认监听 `http://127.0.0.1:7777`。

在当前开发约定里，portal 会把以下路径代理到本地后端：

- `/api`
- `/media`
- `/ws`

## 文档入口

- 根项目说明见 [README.md](/Users/sakura/Documents/DoLike/README.md)
- 项目进度见 [docs/STATUS.md](/Users/sakura/Documents/DoLike/docs/STATUS.md)
- 交接说明见 [docs/HANDOFF.md](/Users/sakura/Documents/DoLike/docs/HANDOFF.md)

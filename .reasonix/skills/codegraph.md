---
name: codegraph
description: CodeGraph CLI — 代码索引、查询、上下文构建、受影响测试分析。用 --help 查看各子命令的详细作用。
---
# CodeGraph CLI Skill

[CodeGraph](https://codegraph.sh) 是一个代码知识图谱工具，可索引代码库并提供查询、上下文构建、测试影响分析等功能。

## 工作流

本 skill 用于运行 `codegraph <command>` CLI。先用 `--help` 了解命令详情，再按需执行。

## 命令大全

### 初始化 & 索引

| 命令 | 说明 | 重要选项 |
|------|------|----------|
| `codegraph init [path]` | 在项目中初始化 CodeGraph（创建 `.codegraph/`） | `-i, --index` 初始化后立即索引 |
| `codegraph uninit [path]` | 从项目中移除 CodeGraph（删 `.codegraph/`） | `-f, --force` 跳过确认 |
| `codegraph index [path]` | 索引项目中的所有文件 | `-f, --force` 强制全量重索引；`-q, --quiet` 静默 |
| `codegraph sync [path]` | 同步上次索引之后的变更 | `-q, --quiet` 适合 git hooks 中使用 |

### 查询 & 上下文

| 命令 | 说明 | 重要选项 |
|------|------|----------|
| `codegraph query <search>` | 搜索代码中的符号（函数、类、变量等） | `-k, --kind <kind>` 按类型过滤；`-l, --limit <n>` 限制条数（默认10）；`-j, --json` |
| `codegraph context <task>` | 为某个任务构建上下文（输出 markdown） | `-n, --max-nodes <n>` 最大节点数（默认50）；`-c, --max-code <n>` 最大代码块（默认10）；`--no-code` 排除代码块；`-f markdown\|json` |

### 文件 & 状态

| 命令 | 说明 | 重要选项 |
|------|------|----------|
| `codegraph files` | 从索引中展示项目文件结构 | `--filter <dir>` 限定目录；`--pattern <glob>` glob 过滤；`--format tree\|flat\|grouped`（默认 tree）；`--max-depth <n>`；`--no-metadata`；`-j, --json` |
| `codegraph status [path]` | 显示索引状态和统计信息 | `-j, --json` |

### 测试影响分析

| 命令 | 说明 | 重要选项 |
|------|------|----------|
| `codegraph affected [files...]` | 查找受变更源文件影响的测试文件 | `--stdin` 从 stdin 读文件列表；`-d, --depth <n>` 依赖遍历深度（默认5）；`-f, --filter <glob>` 自定义测试文件模式；`-j, --json`；`-q, --quiet` 仅输出路径 |

### MCP 服务

| 命令 | 说明 | 重要选项 |
|------|------|----------|
| `codegraph serve` | 以 MCP server 形式运行 | `--mcp` 启用 MCP 模式（stdio 传输）；`--no-watch` 禁用文件监听（慢文件系统如 WSL2 `/mnt` 有用） |
| `codegraph install` | 将 codegraph MCP server 安装到 AI 代理 | `-t, --target <ids>` 目标代理（auto/all/none）；`-l, --location global\|local`；`-y, --yes` 非交互式；`--print-config <id>` 仅打印配置不写文件 |

### 其他

| 命令 | 说明 |
|------|------|
| `codegraph unlock [path]` | 移除阻挡索引的过期锁文件 |

## 典型场景

1. **首次设置 & 索引**: `codegraph init --index .`
2. **代码搜索**: `codegraph query "UserService" -k class` / `codegraph query "getUser" -l 5`
3. **任务上下文**: `codegraph context "Add a new API endpoint for user registration"`
4. **受影响测试**: `codegraph affected src/user/service.ts src/user/controller.ts`
5. **集成到 AI**: `codegraph install -y`
6. **查看索引状态**: `codegraph status -j`
7. **查看项目结构**: `codegraph files --format tree --max-depth 3`

## 使用原则

- **优先用 `--help`**: 不确定某条命令的细节时，先跑 `codegraph <command> --help` 查看。
- **索引完成后才查询**: 确保 `codegraph status` 显示索引已完成。
- **大项目适当限制**: `query -l 20` / `context -n 30 -c 5` 避免输出过多。
- **`unlock` 是安全操作**: 仅删 `.codegraph/codegraph.db` 的锁文件，不损数据。

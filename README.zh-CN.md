# CoAgent

**多智能体终端画布，自带语义记忆。**

在可视化画布上并行编排多个 Claude 智能体。每个智能体运行在独立终端中，通过共享消息总线通信，并通过 Honcho 构建长期记忆——一个项目的知识可以自动延续到下一个项目。

## 产品亮点

- **可视化多智能体编排** — 在无限画布或结构化网格上拖拽、缩放、管理多个 Claude 终端
- **协调者 + 工人架构** — 协调者分配任务给工人智能体，审查产出，综合结果
- **基于 Honcho 的语义记忆** — 每次智能体交互都被提取为可搜索的观察结论；智能体可跨会话、跨项目回忆知识
- **跨项目知识迁移** — 项目 A 的经验自动可用于项目 B
- **实时智能体状态** — 绿色（工作中）、灰色（空闲）、红色脉冲（需要你输入）一目了然
- **内置文件浏览器** — 在一个面板中搜索和预览所有智能体产出的文件
- **一条命令启动** — `coagent` 启动 6 个服务并打开界面

## 快速开始

前置要求：[Node.js](https://nodejs.org/)（v20–v24）、[Docker Desktop](https://www.docker.com/products/docker-desktop/)（已启动）、[Claude Code](https://claude.ai/code)（已登录）

```bash
git clone https://github.com/jinyy20021018-design/AI-CompanyOps.git
cd AI-CompanyOps
./bin/coagent-cli
```

就这样。交互式向导会引导你完成：
1. 自动克隆 Honcho 记忆服务器
2. 检测你的 Claude Code 认证
3. 获取免费的 Gemini API 密钥（用于向量嵌入）
4. 安装所有依赖（Node.js + Python）
5. 启动全部 6 个服务并打开界面

重新运行向导：`./bin/coagent-cli setup`

### 设置快捷命令（可选）

首次运行后，设置别名以便在任何地方使用 `coagent`：

```bash
echo 'alias coagent="'$(pwd)'/bin/coagent-cli"' >> ~/.zshrc
source ~/.zshrc
```

## 命令

所有命令可以用 `./bin/coagent-cli <命令>` 运行，或设置别名后用 `coagent <命令>`。

```
./bin/coagent-cli              启动所有服务（默认）
./bin/coagent-cli stop         停止所有服务
./bin/coagent-cli status       查看服务健康状态
./bin/coagent-cli restart      重启所有服务
./bin/coagent-cli logs         查看实时日志
./bin/coagent-cli open         打开浏览器界面
./bin/coagent-cli setup        重新运行设置向导
```

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                   浏览器（React + Vite）                      │
│  ┌──────────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ 概览网格          │  │ 聚焦视图     │  │ 文件浏览器   │  │
│  │（协调者 + 智能体  │  │（全屏终端）  │  │（产出文件）  │  │
│  │  卡片网格）       │  │              │  │              │  │
│  └──────────────────┘  └──────────────┘  └──────────────┘  │
└──────────────────────┬──────────────────────────────────────┘
                       │ WebSocket
┌──────────────────────▼──────────────────────────────────────┐
│               后端（Node.js + TypeScript）                    │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────────────┐  │
│  │ PTY        │  │ 消息路由      │  │ Honcho 集成         │  │
│  │ 管理器      │  │              │  │（记忆记录）          │  │
│  └────────────┘  └──────────────┘  └──────────┬──────────┘  │
│  ┌────────────┐  ┌──────────────┐             │              │
│  │ 终端注册表  │  │ 会话生命周期  │             │              │
│  └────────────┘  └──────────────┘             │              │
└───────────────────────────────────────────────┼──────────────┘
                                                │ HTTP
┌───────────────────────────────────────────────▼──────────────┐
│                  Honcho 记忆服务器（Python）                   │
│  ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌───────────────┐  │
│  │ API     │  │ 推导器    │  │ 梦境器   │  │ 辩证器         │  │
│  │（REST） │  │（观察）   │  │（合并）  │  │（查询）        │  │
│  └────┬────┘  └────┬─────┘  └────┬────┘  └───────────────┘  │
│       │            │             │                            │
│  ┌────▼────────────▼─────────────▼────┐  ┌────────────────┐  │
│  │  PostgreSQL + pgvector             │  │  Redis（缓存）  │  │
│  │  （消息、观察结论、向量）            │  │                 │  │
│  └────────────────────────────────────┘  └────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## 项目结构

```
├── bin/
│   └── coagent-cli              # CLI — 启动/停止所有服务
├── backend/
│   └── src/
│       ├── index.ts             # HTTP + WebSocket 服务器，处理器分发
│       ├── workspace.ts         # 工作空间脚手架（coagent CLI、模板）
│       ├── sessionLifecycle.ts  # 会话创建/提升/降级/终结
│       ├── messageRouting.ts    # 消息总线 → 收件箱路由（唯一入口）
│       ├── honchoIntegration.ts # Honcho 记忆记录（启动、退出、上下文）
│       ├── honchoClient.ts      # Honcho SDK 客户端封装
│       ├── ptyManager.ts        # PTY 管理，写入自动 \r 规范化
│       ├── terminalRegistry.ts  # 终端持久化状态（JSON）
│       ├── scratchpadWatcher.ts # 消息总线文件监听
│       ├── artifactWatcher.ts   # 产出文件监听
│       ├── serverContext.ts     # 模块间共享类型
│       ├── protocol.ts          # WebSocket 消息类型定义
│       ├── usageLogger.ts       # 按会话计费
│       └── __tests__/           # 5 个测试文件（31+ 个后端测试）
├── frontend/
│   └── src/
│       ├── App.tsx              # 主应用 — 概览 / 聚焦 / 文件 三种视图模式
│       ├── components/
│       │   ├── OverviewGrid.tsx     # 协调者 + 智能体卡片网格布局
│       │   ├── FocusView.tsx        # 单智能体全屏终端视图
│       │   ├── TerminalCanvas.tsx   # 无限缩放画布
│       │   ├── TerminalWindow.tsx   # 可拖拽终端窗口
│       │   ├── TerminalPane.tsx     # xterm.js 终端模拟器
│       │   ├── AgentCard.tsx        # 结构化模式智能体卡片
│       │   ├── AgentChip.tsx        # 紧凑型智能体状态标签
│       │   ├── ArtifactViewer.tsx   # 产出文件预览面板
│       │   ├── FileBrowser.tsx      # 全局文件浏览器 + 预览
│       │   ├── CoordinatorBar.tsx   # 协调者状态栏
│       │   ├── ChatPanel.tsx        # 智能体间消息界面
│       │   ├── MessageBar.tsx       # 消息输入栏
│       │   ├── MessageTimeline.tsx  # 消息总线消息流
│       │   ├── SpawnMenu.tsx        # 智能体启动菜单
│       │   ├── SettingsPanel.tsx    # 主题与设置面板
│       │   ├── WorkspaceHeader.tsx  # 工作空间标题与控制栏
│       │   ├── ProjectSidebar.tsx   # 项目文件夹选择侧边栏
│       │   └── TopNav.tsx           # 导航 + 视图模式切换器
│       ├── hooks/useSocket.ts   # 自动重连的 WebSocket
│       ├── utils/agentStatus.ts # 智能体状态检测逻辑
│       └── __tests__/           # 20 个前端测试
├── .env.example                 # 新用户环境变量模板
├── CHANGELOG.md                 # 发布历史
├── VERSION                      # 当前版本（0.3.0）
└── TODOS.md                     # 待办事项
```

## 工作原理

### 智能体通信

智能体通过共享的 `scratchpad.jsonl` 文件通信。当智能体运行 `coagent send --msg "完成"` 时，消息会：

1. 写入 `scratchpad.jsonl`（消息总线）
2. 由后端路由到目标智能体的 `inbox.jsonl`
3. 通过 WebSocket 广播到界面
4. 记录到 Honcho 用于语义记忆
5. 如果目标空闲，注入到其 PTY 终端

### 记忆层级

每个智能体拥有四层记忆，从最即时到最语义化：

| 层级 | 来源 | 机制 | 范围 |
|------|------|------|------|
| **会话历史** | Claude `--resume` | 内置对话回放 | 当前会话 |
| **Honcho 观察结论** | `honchoIntegration.ts` | 跨项目语义观察，启动时写入 `CLAUDE.md` | 所有项目 |
| **近期上下文** | `notes.md` / `memory.md` | 最近 15 行以 `## Recent Context` 追加到 `CLAUDE.md` | 当前会话 |
| **按需召回** | `coagent recall` | 通过 Honcho Dialectic API 语义搜索 | 所有项目 |

当 PTY 仍然存活时重连，无需注入上下文——Claude 已通过 `--resume` 拥有完整对话。当后端重启导致全新启动时，近期上下文会写入 `CLAUDE.md`，Claude 启动时自动读取。

### 记忆流水线

```
智能体发送消息
    ↓
Honcho API 记录消息
    ↓
推导器提取观察结论：
  "worker-1 了解到 JWT 令牌应每 24 小时轮换"
  "worker-1 认为 Redis 认证对生产环境至关重要"
    ↓
以向量形式存储在 PostgreSQL（pgvector）
    ↓
任何智能体都可查询：
  coagent recall "我们对认证了解多少？"
```

### 终端状态

| 状态 | 视觉效果 | 含义 |
|------|----------|------|
| 运行中 | 绿色光晕 | 智能体正在产生输出 |
| 空闲 | 灰色边框 | 超过 1.5 秒无输出 |
| 等待输入 | 红色脉冲 | 智能体需要你的输入（权限确认、y/n） |
| 需要关注 | 红色实线 | 收到其他智能体的紧急消息 |
| 已退出 | 半透明 | 终端进程已结束 |

## 服务列表

| 服务 | 端口 | 用途 |
|------|------|------|
| 前端 | 5173 | React 界面（Vite） |
| 后端 | 3001 | WebSocket 服务器，PTY 管理 |
| Honcho API | 8000 | 记忆 REST API |
| 推导器 | — | 后台工人，提取观察结论 |
| PostgreSQL | 5432 | 消息 + 向量存储（Docker） |
| Redis | 6379 | 缓存（Docker） |

## 开发

```bash
# 运行测试
cd backend && npm test
cd frontend && npx vitest run

# 类型检查
cd backend && npx tsc --noEmit
cd frontend && npx tsc --noEmit

# 查看日志
coagent logs
```

## 许可证

MIT

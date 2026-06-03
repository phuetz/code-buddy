<p align="center">
  <img src="public/logo.png" alt="Code Buddy Cowork Logo" width="280" />
</p>

<h1 align="center">Code Buddy Cowork：Code Buddy 桌面工作台</h1>

<p align="center">
  ChatGPT OAuth • 内嵌 Code Buddy 引擎 • 真实测试证据
</p>

<p align="center">
  <a href="./README.md">English Docs</a> •
  <a href="#核心特性">核心特性</a> •
  <a href="#真实使用证据">真实证据</a> •
  <a href="#下载与安装">下载安装</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#核心引擎">核心引擎</a> •
  <a href="#技能库">技能库</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/平台-Windows%20%7C%20macOS-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/协议-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/Node.js-22+-brightgreen" alt="Node.js" />
</p>

---

## 简介

**Code Buddy Cowork** 是 Code Buddy CLI、服务器、Fleet hub 和 Buddy companion 的 Electron 桌面工作台。它默认运行内嵌的 Code Buddy 核心引擎，因此桌面聊天、工具调用、Trace、工作流、设置、权限、模型、MCP 连接器、Skills、Artifacts 和 companion 控件都使用与终端相同的 agentic loop。

它提供沙盒化工作区，让 AI 可以管理文件、生成专业输出、从 **Tests & executions** 面板运行真实验证套件，并通过 MCP 与 Fleet 连接本地或远程工具。

> [!WARNING]
> **免责声明**：Code Buddy Cowork 是 AI 协作工具。授权文件修改、删除、命令执行或桌面自动化前，请审查风险。工作区路径守卫和 VM 沙盒可以降低风险，但不能替代人工判断。

---

<a id="核心特性"></a>
## 核心特性

- **ChatGPT 订阅登录**：先运行 `buddy login`，Cowork 即可通过 ChatGPT OAuth 使用 `gpt-5.5`，无需在公开文档或截图中暴露 API key。
- **灵活模型支持**：支持 Code Buddy 核心提供的 OpenAI-compatible APIs、Claude、Grok、Gemini、Ollama、LM Studio、OpenRouter、vLLM、Copilot、Mistral 等 provider。
- **内嵌核心引擎**：默认使用已构建的 Code Buddy bundle；需要时仍可显式回退到 legacy runner。
- **远程控制与 Fleet**：协调 peer、计划任务、command center board 与跨界面工作流。
- **GUI 操作**：可驱动桌面应用，并通过 opt-in 的真实 Computer Use 套件验证。
- **智能文件管理**：在所选工作区内读取、写入、整理文件并添加上下文附件。
- **Skills 系统**：内置 PPTX、DOCX、PDF、XLSX 生成与处理工作流，也支持自定义 skill。
- **MCP 外部服务支持**：通过 MCP Connectors 集成浏览器、本地 transport、Notion、自定义 app 和其他工具。
- **多模态输入**：可直接拖拽文件和图片到输入框。
- **实时 Trace**：在 Trace Panel 中观察 AI 推理、工具调用和执行状态。
- **安全工作区**：文件操作限制在用户选择的 workspace folder 中。
- **VM 级隔离**：Windows 可使用 WSL2，macOS 可使用 Lima，将命令放到隔离 Linux VM 中执行。
- **Tests & executions**：从桌面端启动安全本地 bundle，以及 opt-in 的 ChatGPT、Docker、Computer Use、Fleet、MCP、companion 真实检查，并保留执行历史。

<a id="真实使用证据"></a>
## 真实使用证据

公开 QA 档案见 [`../docs/qa/code-buddy-studio/feature-qa.md`](../docs/qa/code-buddy-studio/feature-qa.md)。其中记录了非 mock 的 Cowork、Electron、Playwright、CLI、HTTP server、ChatGPT OAuth `gpt-5.5`、MCP、Fleet、Docker、权限和 Computer Use 流程。公开截图发布前会清理账号、token 和本地路径信息。

![Cowork ChatGPT gpt-5.5 真实运行](../docs/qa/code-buddy-studio/screenshots/29-real-gpt55-cowork-gui.png)

![Tests and executions 窗口](../docs/qa/code-buddy-studio/screenshots/30-test-runner-window.png)

![权限真实流程](../docs/qa/code-buddy-studio/screenshots/55-test-runner-permission-real-flow.png)

![Computer Use 真实桌面套件](../docs/qa/code-buddy-studio/screenshots/108-test-runner-computer-use-real-suite.png)

公开文档隐私检查由 [`../tests/docs/public-screenshot-privacy.test.ts`](../tests/docs/public-screenshot-privacy.test.ts) 覆盖，GitHub 可见链接大小写检查由 [`../tests/docs/public-doc-links.test.ts`](../tests/docs/public-doc-links.test.ts) 覆盖。

---

<a id="下载与安装"></a>
## 下载与安装

### 方式一：源码运行

当前仓库源码是最可靠的 GitHub 使用路径：

```bash
git clone https://github.com/phuetz/code-buddy.git
cd code-buddy
npm install
npm run build
npm run dev:gui
```

Cowork 的独立 package 位于 `cowork/`。在该目录中可以使用 `npm run dev` 启动 Vite + Electron 开发循环，使用 `npm test` 运行 Vitest，使用 `npm run test:e2e` 运行 Playwright。

### 方式二：安装包

Windows 和 macOS 安装包会由本仓库 release pipeline 发布。若当前 release 尚未附带安装包，请优先使用上面的源码路径，以确保桌面端与当前 Code Buddy 核心一致。

### 沙盒支持

| 级别 | 平台 | 技术 | 说明 |
|------|------|------|------|
| **基础** | 全平台 | Path Guard | 文件操作限制在 workspace folder 内 |
| **增强** | Windows | WSL2 | 命令在隔离 Linux VM 中执行 |
| **增强** | macOS | Lima | 命令在隔离 Linux VM 中执行 |

- **Windows (WSL2)**：检测到 WSL2 后，Bash 命令可路由到 Linux VM，workspace 双向同步。
- **macOS (Lima)**：安装 [Lima](https://lima-vm.io/) 后，命令可在挂载用户目录的 Ubuntu VM 中运行。
- **回退模式**：无可用 VM 时，命令在本机执行，并受路径守卫限制。

---

<a id="快速开始"></a>
## 快速开始

### 1. 认证模型

推荐 ChatGPT Plus / Pro 订阅用户使用：

```bash
buddy login
buddy whoami
```

Cowork 也可以在 Settings 中配置 API-key provider，适用于 OpenRouter、Anthropic、本地 OpenAI-compatible gateway、Ollama、LM Studio 和其他 Code Buddy provider。

| Provider | 获取方式 | Base URL | 推荐模型 |
|----------|----------|----------|----------|
| **ChatGPT OAuth** | `buddy login` | `https://chatgpt.com/backend-api/codex` | `gpt-5.5` |
| **OpenRouter** | [OpenRouter](https://openrouter.ai/) | `https://openrouter.ai/api` | `claude-4-5-sonnet` |
| **Anthropic** | [Anthropic Console](https://console.anthropic.com/) | 默认 | `claude-4-5-sonnet` |
| **智谱 AI** | [GLM Coding Plan](https://bigmodel.cn/glm-coding) | `https://open.bigmodel.cn/api/anthropic` | `glm-4.7`, `glm-4.6` |
| **MiniMax** | [MiniMax Coding Plan](https://platform.minimaxi.com/subscribe/coding-plan) | `https://api.minimaxi.com/anthropic` | `minimax-m2` |
| **Kimi** | [Kimi Coding Plan](https://www.kimi.com/membership/pricing) | `https://api.kimi.com/coding/` | `kimi-k2` |

### 2. 启动桌面端

```bash
npm run dev:gui
```

需要 server-backed workflow 时：

```bash
buddy server --port 3000
```

然后在 Cowork 的 Settings 中选择 provider/profile，并确认 backend health 正常。

### 3. 开始协作

1. **选择工作区**：选择 Code Buddy 可以操作的文件夹。
2. **输入指令**：
   > "读取当前文件夹下的 financial_report.csv，并帮我生成一份包含 5 页幻灯片的 PPT 总结报告。"
3. 发布结果前，可打开 **Tests & executions**，用真实本地基础设施验证关键流程。

<a id="核心引擎"></a>
## 核心引擎

Cowork 默认运行内嵌 **Code Buddy core engine**。它继承 CLI 的 middleware、transcript repair、output sanitizer、MCP routing、skills reload 和 model hot-swap 行为。

- **默认路径**：Auto 模式在 bundle 可用时使用内嵌引擎。
- **回退路径**：bundle 缺失或设置 `CODEBUDDY_EMBEDDED=0` 时，可使用 legacy `pi-coding-agent` runner。
- **可见性**：标题栏 runner badge 会显示当前使用 engine 还是 fallback。Settings -> Core engine 可选择 Auto、Always on 或 Always off。
- **活动回合**：`SessionManager` 会按 session 串行化 prompt；Stop 按钮可取消活动 run。

更多 parity 与弃用说明见 [`RUNNER_AUDIT.md`](./RUNNER_AUDIT.md)。

### 重要提示

1. **macOS 安装**：若使用打包 DMG 且系统提示无法验证开发者，请前往 **系统设置 > 隐私与安全性** 点击 **仍要打开**。
2. **网络连接**：`WebSearch` 等联网工具可能需要代理软件开启虚拟网卡 / TUN 模式。
3. **Notion 连接器**：除了设置 integration token，还需要在 Notion 根页面添加连接。参考 https://www.notion.com/help/add-and-manage-connections-with-the-api。

<a id="技能库"></a>
## 技能库

Code Buddy Cowork 通过 Code Buddy 核心提供 bundled skills，并支持用户添加自定义 skills，包括：

- `pptx`：PowerPoint 生成
- `docx`：Word 文档处理
- `pdf`：PDF 处理与表单
- `xlsx`：Excel 电子表格支持
- `skill-creator`：技能开发工具包

---

## 架构概览

```
code-buddy/cowork/
├── src/
│   ├── main/                    # Electron 主进程
│   │   ├── index.ts             # 主入口
│   │   ├── runner/              # 内嵌 Code Buddy runner 集成
│   │   ├── config/              # 配置管理
│   │   ├── db/                  # SQLite / 数据持久化
│   │   ├── ipc/                 # IPC handlers
│   │   ├── memory/              # 记忆管理
│   │   ├── sandbox/             # 安全与路径解析
│   │   ├── session/             # 会话管理
│   │   ├── skills/              # Skill 加载与管理
│   │   └── tools/               # 工具执行
│   ├── preload/                 # Electron preload
│   └── renderer/                # React + Tailwind UI
├── public/                      # Vite/README 静态资源
├── electron-builder.yml
├── vite.config.ts
└── package.json
```

---

## 路线图

- [x] **核心**：Windows 与 macOS 桌面 app 基础稳定
- [x] **安全**：workspace path guard 与 VM sandbox 支持
- [x] **Skills**：PPTX、DOCX、PDF、XLSX 与自定义 skill 管理
- [x] **MCP Connectors**：支持自定义连接器与真实 transport 检查
- [x] **丰富输入**：文件上传与图片输入
- [x] **多模型**：ChatGPT OAuth 与 OpenAI-compatible APIs
- [x] **UI/UX**：中英文界面、Trace、Settings、权限、执行历史
- [x] **Real QA Runner**：桌面端安全套件与 opt-in 真实套件入口
- [ ] **Release Packaging**：保持安装包与当前内嵌 Code Buddy 引擎同步

---

## 贡献指南

欢迎贡献新 skill、UI 修复、文档、测试或安全改进：

1. Fork 本仓库。
2. 创建分支：`git checkout -b feature/new-skill`。
3. 提交 PR。

---

## 社区

请使用主仓库的 GitHub issues 和 pull requests 进行交流、反馈和协作。

---

## 许可证

MIT © Code Buddy

---

<p align="center">
  Made by the Code Buddy community.
</p>

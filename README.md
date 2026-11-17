# At-Pet Agent Plugins

[At-Pet](https://github.com/Ni-ShuWu/At-Pet) 桌宠的 Agent 插件集合。每个插件把一个 Agent 应用的事件接入桌宠，显示对应动画，并在 Agent 能力允许时处理权限请求与提问。

## 目录结构

```
仓库根目录
 |
 |- Agent-plugin
    |
    |- claude-code      # atpet-claude-code-plugin
    |- opencode         # atpet-opencode-plugin
     |- opencode-v1      # atpet-opencode-v1-plugin
     |- github-copilot   # atpet-github-copilot-plugin
     |- openai-codex     # atpet-openai-codex-plugin
     |- workbuddy        # atpet-workbuddy-plugin
     |- command-code     # atpet-command-code-plugin
     |- zcode            # atpet-zcode-plugin
     |- deepseek-harness # atpet-deepseek-harness-plugin
     |- penguin-harness  # atpet-penguin-harness-plugin
```

每个插件目录内包含插件源码，以及可选的下载包或配置说明。插件命名格式为 `atpet-{agent_name}-plugin`。

## 插件列表

| Agent | 插件名 | 接入方式 | 提问 | 权限请求 |
| --- | --- | --- | --- | --- |
| Claude Code | `atpet-claude-code-plugin` | HTTP hooks + `bridge.mjs` | ✅ `AskUserQuestion` 转发到桌宠，回答回传 | ✅ 原生 `PermissionRequest` |
| OpenCode | `atpet-opencode-plugin` | OpenCode V2 插件 | — | ✅ `ask` 权限交给桌宠 |
| OpenCode V1 | `atpet-opencode-v1-plugin` | OpenCode V1 插件 | — | ✅ `ask` 权限交给桌宠 |
| GitHub Copilot | `atpet-github-copilot-plugin` | Copilot hooks（命令行 + `bridge.mjs`） | — | —（hook 无决策能力） |
| OpenAI Codex | `atpet-openai-codex-plugin` | Codex hooks | — | ✅ `PermissionRequest`，含危险提示所需上下文 |
| WorkBuddy | `atpet-workbuddy-plugin` | CodeBuddy 兼容 hooks | 需显式开启 * | —（仅 `permission` 动画） |
| Command Code | `atpet-command-code-plugin` | `settings.json` hooks | 需显式开启 * | — |
| ZCode | `atpet-zcode-plugin` | 插件 hooks | 需显式开启 * | — |
| DeepSeek Harness | `atpet-deepseek-harness-plugin` | `dsh-hooks-codex` 桥接 | — | —（桥接包只有 5 个事件） |
| PenguinHarness | `atpet-penguin-harness-plugin` | 插件 hooks（`user_prompt`、`stop`） | — | — |

\* 「需显式开启」：该 Agent 必须实现 Claude 风格的 `PreToolUse` 决策输出（`permissionDecision: "allow"` + `updatedInput`），然后把它的 `agentApp` 追加到 `AT_PET_QUESTION_AGENTS`（逗号分隔、小写），并把对应 `PreToolUse` hook 的超时提高到 600 秒。实现不完整时，请保持关闭，Agent 会继续使用自己的提问界面。

除 Claude Code 与 OpenCode 外，其他插件共用同一份桥接脚本 `bridge.mjs`（零依赖 Node），各自目录内保留一份，便于单独安装。每个目录同时带有 `client-auth.mjs`，由 `bridge.mjs` 导入，负责读取本机 At-Pet 凭据并在请求头里带上 token；两个文件必须一起拷贝。

`bridge.mjs` 固定放在插件目录根部，与 `hooks/`、`package.json` 或插件清单同级。配置里的路径变量（`ABSOLUTE_PATH`、`PLUGIN_ROOT`、`${CLAUDE_PLUGIN_ROOT}`、`${CODEBUDDY_PLUGIN_ROOT}`）指向的都是插件目录本身，而不是 `hooks/` 子目录；单独拷贝配置文件时，请把 `bridge.mjs` 留在原目录，或同步改成它的实际路径。

## At-Pet 提问与危险权限

At-Pet 1.2 起提供两个能力，插件按 Agent 的 hook 能力接入：

- **提问**：Agent 的提问工具即将执行时，`bridge.mjs` 先向 `POST /question` 提交问题并轮询；用户在桌宠里选择或输入回答后，插件用 `permissionDecision: "allow"` + `updatedInput.answers` 把答案交还 Agent，工具不再弹自己的提问界面。多个问题会按顺序逐个询问。旧版 At-Pet 没有 `/question` 时自动退回 Agent 原生界面。
- **危险权限提示**：`POST /permission` 会带上 `toolName`、`command`、`description` 等完整上下文，At-Pet 用内置启发式规则判断是否可能危险，并在权限弹窗中显示警告；插件不自行判定。

## 使用前提

- Windows 10/11。
- 已启动 At-Pet，本地 API 默认监听 `127.0.0.1:8765`。
- 涉及 `bridge.mjs` 的插件需要 Node.js（无第三方依赖）。
- At-Pet 1.3.4 起本地 API 需要鉴权：插件目录中的 `client-auth.mjs` 必须与入口脚本（`bridge.mjs` / `at-pet.ts`）放在一起，升级 At-Pet 后要同步更新已安装的插件文件。

详细安装步骤见各插件目录下的 README。

## 本地 API 鉴权（At-Pet 1.3.4+）

At-Pet 1.3.4 起，本地 HTTP API 除 `GET /health` 外都要求 `Authorization: Bearer <token>`。At-Pet 首次启动时按 Agent 各生成一个 256 位随机 token，保存在 `%LOCALAPPDATA%\Ni-ShuWu\At-Pet\api-security\clients.json`。

插件不需要手工填 token：`bridge.mjs` / `at-pet.ts` 会通过同目录的 `client-auth.mjs` 读取这个文件，取当前 `agentApp` 对应的凭据。因此升级与排错时注意：

- `client-auth.mjs` 必须和入口脚本放在同一目录；只拷走 `bridge.mjs` 或 `at-pet.ts` 时入口脚本会因找不到该模块而无法启动，事件完全中断（不会退回无鉴权请求）。
- 升级 At-Pet 后，把已安装的插件目录整体更新（至少包含入口脚本和 `client-auth.mjs`），再重启 Agent。
- Claude Code 的大部分事件走原生 HTTP hook，不经过 Node 脚本，需要在启动 Claude Code 的进程里设置 `AT_PET_API_TOKEN_CLAUDECODE`，做法见 [claude-code/README.md](Agent-plugin/claude-code/README.md)。
- 需要覆盖默认行为时，可用 `AT_PET_CREDENTIALS`（凭据库路径）、`AT_PET_API_TOKEN_<AGENTKEY>`（单个 Agent 的 token，例如 `AT_PET_API_TOKEN_ZCODE`）或 `AT_PET_API_TOKEN`（当前进程的 token）。
- 凭据缺失时 hook 不发请求，Agent 保持自己的原生审批与提问界面，不会自动放行。

完整的凭据格式、客户端绑定与轮换方式见 At-Pet 仓库的[本地 API 鉴权与事件顺序](https://github.com/At-PetAdmin/At-Pet/blob/main/docs/local-api-security.md)。At-Pet 只监听本机回环地址，请勿把端口转发到网络。

## 许可证

MIT

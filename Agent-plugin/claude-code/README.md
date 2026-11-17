# atpet-claude-code-plugin

将 Claude Code 的会话、工具事件、权限请求与 `AskUserQuestion` 提问接入 [At-Pet](https://github.com/Ni-ShuWu/At-Pet) 桌宠。

## 前提

- Windows 10/11，且 At-Pet 已启动（默认监听 `127.0.0.1:8765`）。
- Claude Code 版本需支持 HTTP hooks。
- 已安装 Node.js（仅 `AskUserQuestion` 提问回传需要 `bridge.mjs`；没有 Node 时提问会留在 Claude Code 自己的界面，其他功能不受影响）。
- At-Pet 1.3.4 起本地 API 需要鉴权：HTTP hook 通过环境变量 `AT_PET_API_TOKEN_CLAUDECODE` 取 token，提问回传脚本通过同目录的 `client-auth.mjs` 读取凭据。

## 安装方式

### 方式一：作为插件加载（推荐）

将本目录（`Agent-plugin/claude-code`）作为 Claude Code 插件加载，插件会自动注册 `hooks/hooks.json` 中的 hooks。命令 hook 通过 `${CLAUDE_PLUGIN_ROOT}` 找到本目录的 `bridge.mjs`，无需改路径。

### 方式二：写入 Claude Code 设置

把 `hooks/hooks.json` 中的 `hooks` 内容合并到 Claude Code 的 `settings.json`（用户级 `%USERPROFILE%\.claude\settings.json`，或项目级 `.claude\settings.json`），把 `${CLAUDE_PLUGIN_ROOT}` 替换为本目录的绝对路径，然后重启 Claude Code。

### 设置鉴权环境变量（At-Pet 1.3.4+）

在**启动 Claude Code 的同一个终端**里执行下面几行，再启动或重启 Claude Code：

```powershell
$storePath = Join-Path $env:LOCALAPPDATA 'Ni-ShuWu/At-Pet/api-security/clients.json'
$store = Get-Content -LiteralPath $storePath -Raw | ConvertFrom-Json
$env:AT_PET_API_TOKEN_CLAUDECODE = ($store.clients | Where-Object id -eq 'claudecode').token
```

token 不会回显。`hooks/hooks.json` 里的 HTTP hook 已引用 `$AT_PET_API_TOKEN_CLAUDECODE` 并在 `allowedEnvVars` 中声明该变量；没有设置时请求会被 At-Pet 以 401 拒绝，Claude Code 会保留自己的行为。不要把这个值写进仓库或共享配置。

## 文件布局

```
claude-code/
├── .claude-plugin/plugin.json
├── hooks/hooks.json
├── bridge.mjs      # AskUserQuestion 提问回传入口，必须在插件根目录
├── client-auth.mjs # bridge.mjs 读取本机凭据用，必须与 bridge.mjs 同目录
└── README.md
```

- 作为插件加载时，`hooks.json` 通过 `${CLAUDE_PLUGIN_ROOT}/bridge.mjs` 引用本目录的脚本，`${CLAUDE_PLUGIN_ROOT}` 就是 `claude-code` 目录本身。
- 合并到 `settings.json` 时，把 `${CLAUDE_PLUGIN_ROOT}` 换成本目录的绝对路径；`bridge.mjs` 必须留在本目录，不要移动或改名。
- 只有 `PreToolUse` 的 `AskUserQuestion` 使用命令 hook；其他事件仍由 At-Pet 的 HTTP 端点处理。

## 事件映射

| Claude Code hook | 处理 |
| --- | --- |
| `SessionStart` | HTTP → At-Pet `connected`（播报连接成功） |
| `UserPromptSubmit` | HTTP → At-Pet `thinking` |
| `PreToolUse` | HTTP → At-Pet `tool_start`（消息为工具名） |
| `PreToolUse`（`matcher: AskUserQuestion`） | 命令 hook → 桌宠提问框，回答通过 `updatedInput.answers` 回传 |
| `PostToolUse` | HTTP → At-Pet `tool_end` |
| `PostToolUseFailure` | HTTP → At-Pet `error` |
| `PermissionRequest` | HTTP → 桌宠「允许一次 / 拒绝」，决定原路返回 |
| `Stop` / `SessionEnd` | HTTP → At-Pet `done` / `session_end` |
| `SubagentStart` / `SubagentStop` | HTTP → 子会话 `thinking` / `done` |

## 提问

Claude Code 调用 `AskUserQuestion` 时，`bridge.mjs` 会把问题发到 At-Pet 的 `POST /question`，轮询 `/question/{requestId}` 直到你回答或取消：

- 有选项时显示下拉框，也可以输入自定义回答；多选问题请用英文逗号分隔多个选项。
- 多个问题会按顺序逐个弹出。
- 回答完成后以 `hookSpecificOutput.permissionDecision = "allow"` + `updatedInput` 返回，`updatedInput` 会保留原始 `questions` 并追加 `answers`。
- 若 At-Pet 未运行、版本过旧（没有 `/question`）、或你取消提问，hook 不输出决定，Claude Code 会继续显示它自己的提问界面。

## 权限

`PermissionRequest` 会等待你在桌宠弹窗中选择「允许一次」或「拒绝」，超时时间为 600 秒。At-Pet 会根据工具名和参数显示潜在危险操作警告。

## 说明

- 所有事件 hook 都 POST 到 `http://127.0.0.1:8765/agent-event/claudecode`，原样传递 Claude Code 的 hook 载荷，由 At-Pet 解析。
- 鉴权：`hooks/hooks.json` 中每个 HTTP hook 都带 `Authorization: Bearer $AT_PET_API_TOKEN_CLAUDECODE` 与 `allowedEnvVars`，所以必须在启动 Claude Code 的进程里设置该变量；提问回传依赖同目录的 `client-auth.mjs`。升级 At-Pet 后请整体更新本目录。细节见[本地 API 鉴权与事件顺序](https://github.com/At-PetAdmin/At-Pet/blob/main/docs/local-api-security.md)。
- 若 At-Pet 使用了其他端口，请通过 `AT_PET_PORT` 设置，并同步修改 `hooks/hooks.json` 中的 URL；提问用的桥接脚本读取 `AT_PET_URL`。
- At-Pet 只监听本机回环地址，请勿将端口暴露到网络。

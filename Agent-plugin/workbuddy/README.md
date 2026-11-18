# atpet-workbuddy-plugin

将 WorkBuddy（腾讯 CodeBuddy 内核）的会话、提示、工具调用和权限提示接入 [At-Pet](https://github.com/Ni-ShuWu/At-Pet) 桌宠。

## 前提

- Windows 10/11，且 At-Pet 已启动（默认 `127.0.0.1:8765`）。
- At-Pet 1.3.4 起本地 API 需要鉴权：本目录的 `client-auth.mjs` 必须与 `bridge.mjs` 放在一起，安装时一起拷贝。
- 已安装 Node.js，并且 Git Bash 中可以直接运行 `node`。WorkBuddy 在 Windows 上通过 Git Bash 执行 hook 命令。
- 已安装 WorkBuddy 或 CodeBuddy Code 的支持 hooks 的版本。

## 安装

### 方式一：作为插件加载（推荐）

把本目录作为插件加载。插件的 `hooks/hooks.json` 会通过 `${CODEBUDDY_PLUGIN_ROOT}` 找到 `bridge.mjs`。

### 方式二：写入 settings.json

把 `hooks/hooks.json` 中的 `hooks` 内容合并到 `~/.codebuddy/settings.json`，并将 `${CODEBUDDY_PLUGIN_ROOT}` 替换为本目录的绝对路径（使用正斜杠，例如 `D:/code/At-Pet_Agent-plugin/Agent-plugin/workbuddy`）。

修改后在 CodeBuddy 中运行 `/hooks` 检查配置。

## 文件布局

```
workbuddy/
├── .codebuddy-plugin/plugin.json
├── hooks/hooks.json
├── bridge.mjs      # hook 实际执行入口，必须与 hooks/ 同级
├── client-auth.mjs # 读取本机 At-Pet 凭据，必须与 bridge.mjs 同目录
└── README.md
```

- `${CODEBUDDY_PLUGIN_ROOT}` 指向本目录（`workbuddy`），不是 `hooks` 子目录；`bridge.mjs` 必须留在本目录。
- 手动合并到 `settings.json` 时，把 `${CODEBUDDY_PLUGIN_ROOT}` 换成本目录的绝对路径（正斜杠）。

## 事件映射

| Hook | At-Pet 事件 |
| --- | --- |
| `SessionStart` | 无 |
| `UserPromptSubmit` | `thinking` |
| `PreToolUse` | `tool_start`（消息为工具名） |
| `PostToolUse` | `tool_end` |
| `Notification`（`permission_prompt`） | `permission` |
| `Stop` | `done` |
| `SubagentStop` | `done`（作为子代理） |
| `SessionEnd` | `session_end` |

## 说明

- 鉴权：`bridge.mjs` 通过同目录的 `client-auth.mjs` 读取本机 At-Pet 凭据，请求自动带上 `Authorization: Bearer`。两个文件要一起拷贝，升级 At-Pet 后同步更新本目录；需要覆盖时可用 `AT_PET_API_TOKEN_<AGENTKEY>`、`AT_PET_API_TOKEN` 或 `AT_PET_CREDENTIALS`。详见[本地 API 鉴权与事件顺序](https://github.com/At-PetAdmin/At-Pet/blob/main/docs/local-api-security.md)。
- 本插件只观察，不替你做权限决定。WorkBuddy 的权限提示会触发桌宠的 `permission` 动画，但允许或拒绝仍在 WorkBuddy 中完成。
- 提问转发默认关闭。若你的 CodeBuddy 版本实现了 Claude 风格的 `PreToolUse` 决策输出（`permissionDecision: "allow"` + `updatedInput`），可设置 `AT_PET_QUESTION_AGENTS=workbuddy`，并把 `hooks/hooks.json` 中 `PreToolUse` 的 `timeout` 调到 600，然后用 `AskUserQuestion` 试用。CodeBuddy 官方文档使用 `modifiedInput` 字段，和 Claude Code 的 `updatedInput` 不同，开启前请先确认兼容性。
- 旧版 At-Pet 没有 `/question` 时，提问会自动留在 WorkBuddy 自己的界面。
- 插件清单位置 `.codebuddy-plugin/plugin.json` 和 `${CODEBUDDY_PLUGIN_ROOT}` 变量名参照 CodeBuddy 的插件规范，尚未在 WorkBuddy 中确认，安装前请以 WorkBuddy 的插件文档为准。

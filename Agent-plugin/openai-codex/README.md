# atpet-openai-codex-plugin

将 OpenAI Codex 的会话、提示、工具调用与权限请求接入 [At-Pet](https://github.com/Ni-ShuWu/At-Pet) 桌宠。

## 前提

- Windows 10/11，且 At-Pet 已启动（默认 `127.0.0.1:8765`）。
- At-Pet 1.3.4 起本地 API 需要鉴权：本目录的 `client-auth.mjs` 必须与 `bridge.mjs` 放在一起，安装时一起拷贝。
- 已安装 Node.js（运行 `bridge.mjs`，无第三方依赖）。
- 支持 Codex hooks 的版本。

## 安装

两种方式任选其一。

### 方式一：作为插件加载

把本目录作为 Codex 插件加载。插件会自动读取 `hooks/hooks.json`，其中用 `PLUGIN_ROOT` 指向本目录，无需修改路径。

### 方式二：写入 Codex 的 hooks.json

把 `hooks/hooks.json` 中的各个 `command` 改为绝对路径形式，写入 `~/.codex/hooks.json`（用户级）或 `<仓库>/.codex/hooks.json`（项目级）：

```
node "D:\code\At-Pet_Agent-plugin\Agent-plugin\openai-codex\bridge.mjs" openai-codex
```

完成后在 Codex 中输入 `/hooks`，审核并信任这些 hook。未信任的 hook 不会执行。

## 文件布局

```
openai-codex/
├── .codex-plugin/plugin.json
├── hooks/hooks.json
├── bridge.mjs      # hook 实际执行入口，必须与 hooks/ 同级
├── client-auth.mjs # 读取本机 At-Pet 凭据，必须与 bridge.mjs 同目录
└── README.md
```

- `hooks/hooks.json` 用 `PLUGIN_ROOT` 指向本目录（`openai-codex`），不是 `hooks` 子目录；`bridge.mjs` 必须留在本目录。
- 手动写入 `~/.codex/hooks.json` 时，命令里的路径要写到本目录下的 `bridge.mjs`；不要移动或改名，否则要同步修改命令。

## 事件映射

| Codex hook | At-Pet 行为 |
| --- | --- |
| `SessionStart` | 无（首次提交时才显示会话） |
| `UserPromptSubmit` | `thinking` |
| `PreToolUse` | `tool_start`（消息为工具名） |
| `PostToolUse` | `tool_end` |
| `PermissionRequest` | 在桌宠上弹出「允许一次 / 拒绝」，结果回传给 Codex |
| `Stop` | `done` |
| `SessionEnd` | `session_end` |

## 权限

`PermissionRequest` 会向 At-Pet 的 `/permission` 提交请求并轮询结果。你在弹窗中选择后，决定会返回给 Codex。若 At-Pet 未运行，插件不做决定，Codex 继续显示它自己的审批提示。

请求会带上 `toolName`、`command`、`description` 以及路径、URL、查询等工具参数，At-Pet 用这些信息判断并高亮可能危险的操作。插件本身不判定危险等级。

Codex 没有提问类工具，因此本插件不涉及提问回传。

## 注意

- 鉴权：`bridge.mjs` 通过同目录的 `client-auth.mjs` 读取本机 At-Pet 凭据，请求自动带上 `Authorization: Bearer`。两个文件要一起拷贝，升级 At-Pet 后同步更新本目录；需要覆盖时可用 `AT_PET_API_TOKEN_<AGENTKEY>`、`AT_PET_API_TOKEN` 或 `AT_PET_CREDENTIALS`。详见[本地 API 鉴权与事件顺序](https://github.com/At-PetAdmin/At-Pet/blob/main/docs/local-api-security.md)。
- 插件中 `commandWindows` 使用 PowerShell 语法，`$env:PLUGIN_ROOT` 为其环境变量写法。若你的 Codex 在 Windows 上使用其他 shell，请按 shell 语法修改。该写法尚未在真机上验证。
- 本插件默认把 ChatGPT 桌面端的 Codex 会话标记为 `openai-codex`。

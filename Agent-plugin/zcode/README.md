# atpet-zcode-plugin

将 ZCode 桌面客户端的会话、提示、工具调用和回合结束事件接入 [At-Pet](https://github.com/Ni-ShuWu/At-Pet) 桌宠。

## 前提

- Windows 10/11，且 At-Pet 已启动（默认 `127.0.0.1:8765`）。
- At-Pet 1.3.4 起本地 API 需要鉴权：本目录的 `client-auth.mjs` 必须与 `bridge.mjs` 放在一起，安装时一起拷贝。
- 已安装 Node.js（运行 `bridge.mjs`，无第三方依赖）。
- ZCode 桌面客户端，并支持插件与 hooks。

## 安装

ZCode 的插件支持个人来源（Git、URL、本地目录）。

1. 打开 ZCode，进入 **设置 → 插件 → 创建 → 添加个人来源**，选择本地目录，指向本目录（`Agent-plugin/zcode`）。
2. 在个人插件中安装 **atpet-zcode-plugin** 并启用。
3. 完全退出 ZCode 后重新启动，让 hooks 生效。

## 文件布局

```
zcode/
├── .zcode-plugin/plugin.json
├── hooks/hooks.json
├── bridge.mjs      # hook 实际执行入口，必须与 hooks/ 同级
├── client-auth.mjs # 读取本机 At-Pet 凭据，必须与 bridge.mjs 同目录
└── README.md
```

- 选择个人来源时选本目录（`zcode`），不要只选 `hooks` 子目录；`hooks.json` 里的 `${CLAUDE_PLUGIN_ROOT}/bridge.mjs` 依赖这个目录结构。
- 不要移动或改名 `bridge.mjs`，否则要同步修改 `hooks.json` 中的命令。

## 事件映射

| Hook | At-Pet 事件 |
| --- | --- |
| `SessionStart` | 无 |
| `UserPromptSubmit` | `thinking` |
| `PreToolUse` | `tool_start`（消息为工具名） |
| `PostToolUse` | `tool_end` |
| `Stop` | `done` |
| `SessionEnd` | `session_end` |

## 说明

- 鉴权：`bridge.mjs` 通过同目录的 `client-auth.mjs` 读取本机 At-Pet 凭据，请求自动带上 `Authorization: Bearer`。两个文件要一起拷贝，升级 At-Pet 后同步更新本目录；需要覆盖时可用 `AT_PET_API_TOKEN_<AGENTKEY>`、`AT_PET_API_TOKEN` 或 `AT_PET_CREDENTIALS`。详见[本地 API 鉴权与事件顺序](https://github.com/At-PetAdmin/At-Pet/blob/main/docs/local-api-security.md)。
- 本插件只观察，不做权限决定。
- 提问转发默认关闭。若 ZCode 的 `PreToolUse` 支持 Claude 风格的 `permissionDecision: "allow"` + `updatedInput`，可设置 `AT_PET_QUESTION_AGENTS=zcode`，并把 `hooks/hooks.json` 中 `PreToolUse` 的 `timeoutMs` 调到 600000 后试用。
- `hooks/hooks.json` 中的事件名按 Claude Code 风格命名，目前只有 `SessionStart` 在官方样例中得到确认，其余事件请在 ZCode 中用真实会话验证。
- `${CLAUDE_PLUGIN_ROOT}` 指向插件目录，由 ZCode 注入。

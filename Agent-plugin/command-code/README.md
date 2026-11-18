# atpet-command-code-plugin

将 Command Code 的会话、工具调用和回合结束事件接入 [At-Pet](https://github.com/Ni-ShuWu/At-Pet) 桌宠。

Command Code 没有独立的插件清单，接入方式是在 `settings.json` 中配置 hooks。

## 前提

- Windows 10/11，且 At-Pet 已启动（默认 `127.0.0.1:8765`）。
- At-Pet 1.3.4 起本地 API 需要鉴权：本目录的 `client-auth.mjs` 必须与 `bridge.mjs` 放在一起，安装时一起拷贝。
- 已安装 Node.js（运行 `bridge.mjs`，无第三方依赖）。

## 安装

1. 打开 `hooks/settings.example.json`，把其中所有 `ABSOLUTE_PATH` 替换为**本目录**（`command-code`，即 `bridge.mjs` 所在目录）的绝对路径。
2. 将其中的 `hooks` 合并到以下任一位置：
   - 用户级（所有项目生效）：`%USERPROFILE%\.commandcode\settings.json`
   - 项目级：`<项目>\.commandcode\settings.json`
3. 重启 Command Code。

## 文件布局

```
command-code/
├── hooks/settings.example.json
├── bridge.mjs      # hook 实际执行入口，必须与 hooks/ 同级
├── client-auth.mjs # 读取本机 At-Pet 凭据，必须与 bridge.mjs 同目录
└── README.md
```

- `ABSOLUTE_PATH` 指向本目录（`command-code`），不是 `hooks` 子目录。
- 把配置合并到 `settings.json` 后，`bridge.mjs` 仍留在本目录；不要移动或改名，否则要同步修改命令。

## 事件映射

| Hook | At-Pet 事件 |
| --- | --- |
| `SessionStart` | 无 |
| `PreToolUse` | `tool_start`（消息为工具名） |
| `PostToolUse` | `tool_end` |
| `Stop` | `done` |

## 说明

- 鉴权：`bridge.mjs` 通过同目录的 `client-auth.mjs` 读取本机 At-Pet 凭据，请求自动带上 `Authorization: Bearer`。两个文件要一起拷贝，升级 At-Pet 后同步更新本目录；需要覆盖时可用 `AT_PET_API_TOKEN_<AGENTKEY>`、`AT_PET_API_TOKEN` 或 `AT_PET_CREDENTIALS`。详见[本地 API 鉴权与事件顺序](https://github.com/At-PetAdmin/At-Pet/blob/main/docs/local-api-security.md)。
- Command Code 的 hook 只做观察，不会弹出 At-Pet 的权限确认。`PreToolUse` 脚本输出为空，表示允许工具执行，不会阻止任何操作。
- 提问转发默认关闭。若 Command Code 的 `PreToolUse` 支持 Claude 风格的 `permissionDecision: "allow"` + `updatedInput`，可设置 `AT_PET_QUESTION_AGENTS=command-code`，并把 `PreToolUse` 的 `timeout` 调到 600 后试用。
- 桥接脚本会忽略 `PreToolUse` 和 `PostToolUse` 之外的 matcher 设置，始终对所有工具发出事件。

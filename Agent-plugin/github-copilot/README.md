# atpet-github-copilot-plugin

将 GitHub Copilot 的会话、提示、工具调用和错误事件接入 [At-Pet](https://github.com/Ni-ShuWu/At-Pet) 桌宠。

## 前提

- Windows 10/11，且 At-Pet 已启动（默认 `127.0.0.1:8765`）。
- At-Pet 1.3.4 起本地 API 需要鉴权：本目录的 `client-auth.mjs` 必须与 `bridge.mjs` 放在一起，安装时一起拷贝。
- 已安装 Node.js（用于运行 `bridge.mjs`，无第三方依赖）。
- GitHub Copilot CLI，或支持 hooks 的 Copilot 环境。

## 安装

1. 把 `hooks/atpet.json` 中所有 `ABSOLUTE_PATH` 替换为**本目录**（`github-copilot`，即 `bridge.mjs` 所在目录）的绝对路径，例如 `D:\code\At-Pet_Agent-plugin\Agent-plugin\github-copilot`。
2. 选一个位置放置修改后的文件：
   - 用户级（所有项目生效）：`%USERPROFILE%\.copilot\hooks\atpet.json`
   - 仓库级：`<仓库>\.github\hooks\atpet.json`
3. 重启 Copilot CLI。配置在启动时加载。

## 文件布局

```
github-copilot/
├── hooks/atpet.json
├── bridge.mjs      # hook 实际执行入口，必须与 hooks/ 同级
├── client-auth.mjs # 读取本机 At-Pet 凭据，必须与 bridge.mjs 同目录
└── README.md
```

- `atpet.json` 中的 `ABSOLUTE_PATH` 指向本目录（`github-copilot`），不是 `hooks` 子目录。
- 把 `atpet.json` 复制到 `~/.copilot/hooks/` 或仓库的 `.github/hooks/` 后，`bridge.mjs` 仍留在本目录；不要移动或改名 `bridge.mjs`，否则要同步修改 `atpet.json` 里的命令。

## 事件映射

| Copilot hook | At-Pet 事件 |
| --- | --- |
| `sessionStart` | 无（首次提交时才显示会话） |
| `userPromptSubmitted` | `thinking` |
| `preToolUse` | `tool_start`（消息为工具名） |
| `postToolUse` | `tool_end` |
| `errorOccurred` | `error` |
| `agentStop` | `done` |
| `sessionEnd` | `session_end` |

## 说明

- 鉴权：`bridge.mjs` 通过同目录的 `client-auth.mjs` 读取本机 At-Pet 凭据，请求自动带上 `Authorization: Bearer`。两个文件要一起拷贝，升级 At-Pet 后同步更新本目录；需要覆盖时可用 `AT_PET_API_TOKEN_<AGENTKEY>`、`AT_PET_API_TOKEN` 或 `AT_PET_CREDENTIALS`。详见[本地 API 鉴权与事件顺序](https://github.com/At-PetAdmin/At-Pet/blob/main/docs/local-api-security.md)。
- Copilot 的 hook 只负责观察，没有权限回调，因此 At-Pet 不会弹出权限确认，也不会转发提问。
- 桥接脚本从 hook 的 stdin 读取 `toolName`、`cwd` 等字段；若 payload 中没有会话 ID，则用工作目录生成一个稳定 ID。
- 如果需要排查，可在命令行手动测试：
  ```powershell
  '{"cwd":"D:\\demo","toolName":"bash"}' | node bridge.mjs github-copilot preToolUse
  ```

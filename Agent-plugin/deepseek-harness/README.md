# atpet-deepseek-harness-plugin

把 [At-Pet](https://github.com/At-PetAdmin/At-Pet) 桌宠接到 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）：桌宠跟着回合思考、挖土、庆祝，权限询问和 `ask_user_question` 直接弹到桌宠窗口，在桌宠上点完就回到 Harness。

本目录是**原生 Host 插件**。早期基于 `dsh-hooks-codex` 的 hook 方案保留在 [`hooks-codex/`](hooks-codex/)，两者只能开一个（同时开启会对同一批工具调用各报一次）。

## 与 hook 方案的差别

| | `hooks-codex/`（旧） | 本插件（原生） |
| --- | --- | --- |
| 运行方式 | 每次事件 `spawn node bridge.mjs` | 无子进程，Host 内直接发包 |
| 事件来源 | 5 个 Codex hook 点 | `session/event` 持久日志 + 原生拦截点 |
| 权限回传 | —（桥接包只有 5 个事件） | ✅ 原生 `approval/request`，失败自动回退 |
| 提问转发 | — | ✅ `user-questions/request` → 桌宠气泡 |
| 需要改配置的 | `hooks.yml` + `hooks.json` + 绝对路径 | 只有 `cordis.patch.yml` 一行 |

## 前提

- Windows 10/11，At-Pet 已启动（默认监听 `127.0.0.1:8765`）。
- DeepSeek Harness 0.2.x。插件只用 Host 侧公开的 Cordis 事件，无第三方依赖、无安装脚本。

## 安装

克隆本仓库后，把 `install_bundle` 指向**本目录**：

```js
plugin_manager({ action: 'install_bundle', target: '<仓库路径>/Agent-plugin/deepseek-harness' })
```

安装后通过 HMR 立即生效，不用重启。At-Pet 没开也不会报错：插件先探测 `/health`，不可达就静默跳过，权限与提问回退到 Harness 原生界面。

卸载：

```js
plugin_manager({ action: 'remove_bundle', target: '@local/dsh-atpet' })
```

## 目录

| 路径 | 内容 |
| --- | --- |
| `index.js` | 插件全部逻辑（Host 半） |
| `cordis.patch.yml` | 插入 `dsh-atpet` 一行与默认配置 |
| `package.json` | bundle 清单（`dsh.bundle.patch`） |
| `locale/*.json`、`icon.svg` | Plugin Manager 里显示的标题、描述、图标 |
| `test/bridge.test.mjs` | 15 个零依赖行为用例，桩实现 At-Pet 协议 |
| `tools/live-check.mjs`、`tools/question-check.mjs` | 对真实运行中的 At-Pet 做端到端自检 |
| `hooks-codex/` | 旧的 hook 桥接方案（保留） |

## 行为

### 1. 活动镜像（`POST /event`）

| Harness 事件 | At-Pet 事件 | 桌宠表现 |
| --- | --- | --- |
| `turn/start` | `thinking` | 思考 |
| `user/message`（用户本人） | `user_prompt_submit` | 思考，气泡显示提问摘要 |
| `tool/call` | `tool_start` | 干活，气泡显示工具名 |
| `tool/result` | `tool_end` | 回到思考 |
| `turn/end` · `completed` / `max-tokens` | `done` | 庆祝（5 秒后收工） |
| `turn/end` · `aborted` / `blocked` / `interrupted` | `cancelled` | 中止 |
| `turn/end` · `error` | `error` | 报错，气泡显示失败原因 |
| `session/disposed` | `session_end` | 移除该会话桌宠 |

- 读的是**已提交的会话日志**，所以重试、重放、子代理都不会让桌宠错位；工具失败不算回合失败，桌宠不会因此提前退场。
- `agentApp` 默认 `deepseek-harness`，At-Pet 归一化成注册键 `deepseekharness`，显示为「DeepSeek Harness」。
- 模型名取自会话的请求上下文；子代理会话带 `parentSessionId` 单独开一只桌宠（`reportSubagents: false` 可关闭）。

### 2. 权限转接（`/permission`）

Harness 需要批准某个工具时，插件把请求发到桌宠窗口（标题 = 工具名，详情 = Harness 给出的理由）。桌宠上点「Allow once」→ 工具放行；点「Deny」或关窗 → 拒绝。

这条通路**只在 At-Pet 应答 `/health` 时**才接管，且以下情况一律 `next()` 交回 Harness 原生批准界面：

- At-Pet 未启动 / 端口不可达 / 请求发不出去；
- 超时（`approvalTimeoutMs`，默认 120 秒）没人点；
- 桌宠那边请求被取消（`DELETE`）。

所以「桌宠挂着没人管」不会把会话锁死，最多是晚一点在 Harness 里再问一次。

### 3. 提问转接（`/question`）

`ask_user_question` 只问**一个问题**且带选项时，插件把它发到桌宠：选项变成下拉框，选中的那一项就是答案。多问题、纯开放问题、以及 plan-review 提示（`intent`）都留在 Harness 里，避免把复杂交互压扁成一个气泡。

## 配置

全部可选。默认值写在本目录的 `cordis.patch.yml`；也可以在 profile 的 `cordis.patch.yml` 里按 id 覆盖同一行：

```yaml
- id: dsh-atpet
  config:
    bridgeApprovals: false
```

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8765` | At-Pet 本地 API 地址 |
| `agentApp` | `deepseek-harness` | 上报给桌宠的 Agent 标识 |
| `reportEvents` | `true` | 是否镜像回合与工具活动 |
| `reportSubagents` | `true` | 子代理是否单独开窗 |
| `includePromptText` | `true` | 气泡里是否显示提问摘要 |
| `bridgeApprovals` | `true` | 是否把权限询问转给桌宠 |
| `bridgeQuestions` | `true` | 是否把单问题提问转给桌宠 |
| `requestTimeoutMs` | `1200` | 单次 HTTP 超时 |
| `healthTtlMs` | `5000` | `/health` 探测缓存时间 |
| `pollIntervalMs` | `250` | 等待用户在桌宠上作答的轮询间隔 |
| `approvalTimeoutMs` | `120000` | 权限等待上限，超时回退 Harness |
| `questionTimeoutMs` | `180000` | 提问等待上限，超时回退 Harness |
| `maxMessageChars` | `160` | 气泡文字截断长度 |

非法值按单键回退默认值，不会让插件或 Harness 起不来。

## 设计要点

- **不写会话日志**：不 `append` 事件、不注入上下文，纯观察者，卸载即干净。
- **不阻塞工具**：镜像上报 fire-and-forget，桌宠不可达只消耗一次本地连接。
- **只接管能回退的东西**：权限与提问两条水位失败时一律 `next()`，绝不替用户做决定，也不静默吞掉询问。
- **上报不抛错**：桌宠是外设，任何网络异常都不会冒泡成 Harness 错误。

## 测试

零依赖，直接跑：

```bash
node test/bridge.test.mjs
```

15 个用例覆盖事件映射、子代理分窗、失败工具不误报、权限允许/拒绝/超时/离线回退、提问选项与自定义答案、多问题让位、卸载后停止上报。桩实现了 At-Pet 的 `/health`、`/event`、`/permission`、`/question`。

真机自检（会弹窗）：

```bash
node tools/live-check.mjs
node tools/question-check.mjs 127.0.0.1 60000
```

## 排错

| 现象 | 检查 |
| --- | --- |
| 桌宠完全不动 | At-Pet 是否在跑：`curl http://127.0.0.1:8765/health`；`/state` 里有没有 `DeepSeek Harness` 会话 |
| 桌宠动了但显示别的 agent | `agentApp` 被改成了别的值 |
| 权限弹在 Harness 而不是桌宠 | At-Pet 没启动，或 `bridgeApprovals: false`，或等待已超时 |
| 桌宠里选了答案但 Harness 仍弹窗 | 该提问是多问题 / plan-review / 超时，属于设计内回退 |
| 桌宠状态来回跳 | 同时开着 `hooks-codex/` 的桥接，关掉其中一个 |

# atpet-opencode-v1-plugin

将 OpenCode V1 的会话、工具事件与权限请求接入 [At-Pet](https://github.com/Ni-ShuWu/At-Pet) 桌宠。源码 `at-pet.ts` 使用 V1 插件接口（`@opencode-ai/plugin`）。

## 前提

- Windows 10/11，且 At-Pet 已启动（默认监听 `127.0.0.1:8765`）。
- At-Pet 1.3.4 起本地 API 需要鉴权：`at-pet.ts` 依赖同目录的 `client-auth.mjs` 读取凭据，两个文件要一起复制。
- OpenCode V1。

## 安装

任选一种：

- 项目级：将 `at-pet.ts` 和 `client-auth.mjs` 一起复制到项目的 `.opencode/plugins/` 目录。
- 全局：将 `at-pet.ts` 和 `client-auth.mjs` 一起复制到 `%USERPROFILE%\.config\opencode\plugins\`。

然后重启 OpenCode。

## 说明

- 插件会把会话状态、工具执行前后事件发送到 `/agent-event/opencode`。
- 当 OpenCode 发出 `ask` 权限请求时，会在桌宠中弹出提示，你可选择「允许一次」或「拒绝」，结果会同步给 OpenCode。At-Pet 会依据权限类型和资源列表显示潜在危险操作警告。
- OpenCode 没有提问类工具，因此不涉及提问回传。
- At-Pet 不可用时，插件不会改变 OpenCode 原有的 `ask` 决策。
- 若 At-Pet 使用了非默认端口，请设置环境变量 `AT_PET_URL`，例如 `http://127.0.0.1:9000`。
- 插件卸载时会取消未完成的 At-Pet 权限请求。
- V1 的 `tool.execute.after` 不提供执行状态，因此工具完成事件不带 `statusType`。
- 鉴权：`at-pet.ts` 通过同目录的 `client-auth.mjs` 读取本机 At-Pet 凭据，请求自动带上 `Authorization: Bearer`；缺少 `client-auth.mjs` 时插件无法加载（模块解析失败），事件与权限都不会上报，OpenCode 保留原生 `ask`。升级 At-Pet 后请同步更新这两个文件。详见[本地 API 鉴权与事件顺序](https://github.com/At-PetAdmin/At-Pet/blob/main/docs/local-api-security.md)。

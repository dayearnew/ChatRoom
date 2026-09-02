<p align="center">
  <img src="../assets/chatroom.svg" alt="ChatRoom" width="88" height="88" />
</p>

<h1 align="center">ChatRoom</h1>

<p align="center">
  <a href="../README.md">English</a> | 简体中文 | <a href="https://doc.chatroomcp.com/zh/">文档</a>
</p>

ChatRoom 是一个本地 MCP Runtime，让 ChatGPT 可以处理设备上的项目和进程。WebUI 用于浏览工作区、管理 Git 仓库和进程、管理 ChatRoom Cloud，并按插件查看操作日志。

## 安装

需要 Node.js 24.15.0 或更高版本以及 Git。

```bash
npm install -g @chatroomcp/chatroom
chatroom init
chatroom serve
```

默认本地地址：

```text
WebUI  http://127.0.0.1:8765/
MCP    http://127.0.0.1:8765/mcp
```

`chatroom init` 会创建 `~/.config/chatroom/config.json`，并默认允许访问 `~/Projects` 下的工作区。

## 与 ChatGPT 配合使用

ChatGPT 通过 MCP Endpoint 连接 ChatRoom。需要远程访问时，可以直接在 WebUI 中启用 ChatRoom Cloud，也可以自行通过 HTTPS 将 ChatRoom 暴露到公网，并配置对应的公网地址。

在 ChatGPT Developer Mode 中创建自定义 MCP App，填写 ChatRoom 的 `/mcp` 地址，并使用 `~/.config/chatroom/config.json` 中的 `ownerToken` 完成 OAuth 授权。

当前 ChatGPT 接入流程见：[在 ChatGPT 中使用 ChatRoom](https://doc.chatroomcp.com/zh/chatgpt)。

## ChatRoom Cloud

ChatRoom Cloud 已内置于 ChatRoom，用于提供可选的 Remote MCP 和 Remote WebUI 公网访问。在 WebUI 的 **Cloud** 页面即可购买、恢复和管理服务。

## 文档

[官方文档](https://doc.chatroomcp.com/zh/)

## License

Apache-2.0

<p align="center">
  <img src="./assets/chatroom.svg" alt="ChatRoom" width="88" height="88" />
</p>

<h1 align="center">ChatRoom</h1>

<p align="center">
  English | <a href="./docs/README.zh-CN.md">简体中文</a> | <a href="https://doc.chatroomcp.com/">Documentation</a>
</p>

ChatRoom is a local MCP runtime that lets ChatGPT work with files, Git worktrees, and processes on your device. Its WebUI provides workspace browsing, process monitoring, ChatRoom Cloud controls, and plugin-attributed operation logs.

## Install

Requires Node.js 24.15.0 or newer and Git.

```bash
npm install -g @chatroomcp/chatroom
chatroom init
chatroom serve
```

Default local endpoints:

```text
WebUI  http://127.0.0.1:8765/
MCP    http://127.0.0.1:8765/mcp
```

`chatroom init` creates `~/.config/chatroom/config.json` and uses `~/Projects` as the default allowed workspace root.

## Use with ChatGPT

ChatGPT connects to ChatRoom through its MCP endpoint. For remote access, either enable ChatRoom Cloud from the WebUI or expose ChatRoom through your own HTTPS ingress and configure the corresponding public URL.

Create a custom MCP app in ChatGPT Developer Mode, use the ChatRoom `/mcp` URL, and complete OAuth authorization with the `ownerToken` stored in `~/.config/chatroom/config.json`.

See [Use ChatRoom with ChatGPT](https://doc.chatroomcp.com/chatgpt) for the current ChatGPT setup flow.

## ChatRoom Cloud

ChatRoom Cloud is built into ChatRoom and provides optional public access for Remote MCP and Remote WebUI. Open the **Cloud** page in the WebUI to purchase, restore, or manage access.

## Documentation

[Official Documentation](https://doc.chatroomcp.com/)

## License

Apache-2.0

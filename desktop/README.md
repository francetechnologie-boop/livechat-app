# MCP Desktop Client (Electron)

A minimal Electron desktop app that connects to an MCP-compatible WebSocket server and lets you send JSON-RPC requests (e.g., `tools/list`).

## Quick start

- Prereq: Node.js 18+ installed
- Run:

```
cd livechat-app/desktop
npm install
npm start
```

## Connect

- Paste your WebSocket endpoint into the "WebSocket URL" field. Example:
  - `wss://mcp.piscinesondespro.fr/mcp/ws/bot/bot_mypiscine_fr`
- If your server requires a token, paste it in the Token field. The app automatically appends `?token=YOUR_TOKEN` to the URL if not present.
- Click "Connect". On success, the app sends `tools/list` automatically.

## Send requests

- Use the prefill button "Send tools/list" or specify a custom `method` and JSON `params`.
- The app increments the `id` after each send. You can override it manually.

## Notes

- The app uses WebSocket subprotocols `["vnd.mcp+json", "mcp", "jsonrpc"]`.
- Custom headers are not supported by browsers/Electron WebSocket; use the `token` query parameter if your server enforces auth.
- Packaging (optional):

```
npm run build
# Artifacts will be placed in dist/ (electron-builder)
```

## Troubleshooting

- If you see CLOSE with code 1008/1011, verify your token and bot id.
- If your URL already includes query parameters, the Token field only adds `token` if it’s not already present.
- Logs area shows raw JSON frames for easy debugging.


// src/lib/socket.js
import { io } from "socket.io-client";

// Use default transports (polling + websocket) for better proxy compatibility
export const socket = io("/", {
  path: "/socket",
});

// Always join the "agents" room on connect/reconnect
const joinAgents = () => {
  try {
    socket.emit("agent_hello");
  } catch {}
};
if (socket.connected) joinAgents();
socket.on("connect", joinAgents);
socket.on("connect_error", (e) => {
  try { console.warn("[socket] connect_error", e?.message || e); } catch {}
});

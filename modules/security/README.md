# Security module

4 tabs:
- Uptime Kuma (embedded iframe)
- UFW status (server-side `ufw status verbose`)
- Cloudflare (embedded iframe)
- Remote Apache log tail (via SSH)

## Remote log configuration

Set these environment variables on the backend host or use the module’s Settings tab:

- `SECURITY_LOG_SSH_HOST` (required unless configured via the UI)
- `SECURITY_LOG_SSH_USER` (default: `root`)
- `SECURITY_LOG_SSH_PORT` (default: `22`)
- `SECURITY_LOG_SSH_KEY_PATH` (optional; uses default SSH agent/config if omitted)
- `SECURITY_LOG_PATH` (default: `/var/log/apache2/access_unified_website.log`)

The Settings tab lets you persist connection details into the database so that you don’t need to edit `.env` directly. After saving, the Remote Apache log tab uses that stored configuration first (falling back to env vars otherwise).

The new “VPS Commands” tab allows you to save sets of frequently used shell commands (per organization). Save them once, copy them directly into your terminal, and keep contextual notes next to each tab for quick references.
The “Cockpit” tab embeds `https://185.97.146.187:9090/metrics`; use the Open button if the remote server blocks framing.

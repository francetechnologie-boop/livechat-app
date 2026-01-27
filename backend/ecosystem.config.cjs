// PM2 ecosystem file for the Livechat backend.
// Ensures env vars (DATABASE_URL, PGSSL, etc.) persist across restarts.

module.exports = {
  apps: [
    {
      name: "livechat",
      cwd: __dirname,
      script: "bootstrap.cjs",
      // Pin Node interpreter (override via PM2_NODE_INTERPRETER env)
      interpreter: process.env.PM2_NODE_INTERPRETER || "node",
      // For small servers keep a single process; switch to 'cluster' if needed
      exec_mode: "fork",
      instances: 1,
      watch: false,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,
      time: true,

      // Base environment (can be overridden by `--update-env` on restart)
      env: {
        NODE_ENV: "production",
        PORT: 3010,
        // IMPORTANT: set these to your production DB settings
        DATABASE_URL:
          "postgresql://livechat_user:Alexcaroline12@127.0.0.1:5432/livechat",
        PGSSL: "false", // set to 'true' if your DB requires SSL

        // Default OpenAI model for Responses (Prompt + Tools)
        OPENAI_MODEL: "gpt-5",

        // Optional logging toggles for backend/chat.log
        LOG_ENABLED: "1",
        LOG_STDOUT: "1",

        // Optional: set a global MCP token if you use MCP auth
        // MCP_TOKEN: '',
        // MCP_PUBLIC_BASE: '',

        // Playwright: use persistent cache so browsers aren't re-downloaded each deploy
        PLAYWRIGHT_BROWSERS_PATH:
          process.env.PLAYWRIGHT_BROWSERS_PATH ||
          (process.env.HOME
            ? `${process.env.HOME}/.cache/ms-playwright`
            : "/var/cache/ms-playwright"),
        PRESTA_ROOT: "/var/www/html/3dtisk5",
      },

      // Environment overrides when started with: pm2 start ecosystem.config.js --env production
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};

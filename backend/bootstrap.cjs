// CommonJS bootstrap to enforce runtime Node version before loading ESM server
// Keeps PM2 starts from failing with cryptic syntax errors on older Node.

(function () {
  try {
    var version = process.versions && process.versions.node || "0.0.0";
    var major = parseInt(String(version).split(".")[0], 10) || 0;
    var required = 18; // minimum supported Node.js major version

    if (major < required) {
      var msg = [
        "Livechat backend requires Node.js >= " + required + ",",
        "but detected " + version + ".",
        "Please upgrade Node (e.g., 18/20 LTS) and restart PM2.",
      ].join(" ");
      console.error("[startup] " + msg);
      process.exitCode = 1;
      return;
    }

    // Optional syntax pre-check so PM2 logs show file:line on parse errors
    try {
      var cp = require('child_process');
      var chk = cp.spawnSync(process.execPath, ['--check', './server.js'], { stdio: 'inherit' });
      if (chk && chk.status && chk.status !== 0) {
        console.error('[startup] Syntax check failed (see above).');
        process.exitCode = chk.status || 1;
        return;
      }
    } catch (_) {}

    // Load the real ESM entrypoint
    import("./server.js").catch(function (err) {
      console.error("[startup] Failed to start server.js:", err && (err.stack || err));
      process.exitCode = 1;
    });
  } catch (e) {
    console.error("[startup] Bootstrap error:", e && (e.stack || e));
    process.exitCode = 1;
  }
})();

import createLogs2Routes from "./routes/logs2.routes.js";

export async function onModuleLoaded(ctx = {}) {
  try {
    const { app, requireAdmin, logToFile, extras = {} } = ctx;
    if (!app || typeof app.get !== 'function') return;
    createLogs2Routes({
      app,
      requireAuth: requireAdmin,
      getLogFilePath: extras.getLogFilePath,
      isLogEnabled: extras.isLogEnabled,
      isLogStdout: extras.isLogStdout,
      setLogStdout: extras.setLogStdout,
      logToFile,
    });
    try { logToFile?.(`[hooks] logs2 routes mounted via onModuleLoaded`); } catch {}
  } catch (e) {
    try { ctx.logToFile?.(`[hooks] logs2 mount failed: ${e?.message || e}`); } catch {}
  }
}

export async function onModuleDisabled(_ctx = {}) {
  // No-op for now (could unmount routes if using a router registry)
}


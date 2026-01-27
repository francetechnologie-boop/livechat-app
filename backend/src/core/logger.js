import fs from "fs";

export function createLogger({ logFile, defaultEnabled = true, defaultStdout = false }) {
  let enabled = defaultEnabled;
  let stdout = defaultStdout;

  function logToFile(message) {
    if (!enabled) return;
    const ts = new Date().toISOString();
    const line = `[${ts}] ${message}\n`;
    try {
      fs.appendFile(logFile, line, () => {});
    } catch {}
    if (stdout) {
      try {
        console.log(line.trim());
      } catch {}
    }
  }

  return {
    logToFile,
    getLogFile: () => logFile,
    isEnabled: () => enabled,
    setEnabled(value) {
      enabled = Boolean(value);
    },
    isStdout: () => stdout,
    setStdout(value) {
      stdout = Boolean(value);
    },
  };
}

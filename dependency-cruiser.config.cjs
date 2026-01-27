// Dependency-Cruiser config to flag dead/unused files in grabbing-sensorex (backend only)
// - Focus on backend to avoid false positives from frontend entry points the loader consumes dynamically.
// - Treat backend/index.js as an allowed entry (it’s imported by the module loader outside this repo graph).

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-orphans-backend',
      comment: 'Prevent unused backend modules from lingering in the repo',
      severity: 'error',
      from: { path: '^modules/grabbing-sensorex/backend' },
      to: {
        orphan: true,
        // Allow the backend entry file to be unreferenced within the local graph
        pathNot: 'modules/grabbing-sensorex/backend/index\\.js$',
      },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    doNotFollow: {
      path: 'node_modules',
    },
    exclude: [
      // ignore data, migrations and non-code assets
      '(^|/)db/migrations/.*',
      '\\.(?:sql|md|zip|ps1|sh)$',
    ].join('|'),
    reporterOptions: {
      dot: { collapsePattern: 'node_modules' },
    },
  },
};


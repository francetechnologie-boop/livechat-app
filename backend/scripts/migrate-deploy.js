#!/usr/bin/env node
const { execSync } = require("node:child_process");
const fs = require("node:fs");
process.chdir(__dirname + "/..");
const hasPrisma = fs.existsSync("prisma");
const hasKnex = fs.existsSync("knexfile.js") || fs.existsSync("knexfile.ts");
try {
  if (hasPrisma) execSync("npx prisma migrate deploy", { stdio: "inherit" });
  else if (hasKnex) execSync("npx knex migrate:latest", { stdio: "inherit" });
  else throw new Error("No migrator detected (prisma/knex).");
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}


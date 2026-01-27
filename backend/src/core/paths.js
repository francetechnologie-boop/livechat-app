import path from "path";
import { fileURLToPath } from "url";

const coreDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(coreDir, "..");
const backendRoot = path.resolve(srcDir, "..");
const projectRoot = path.resolve(backendRoot, "..");
const frontendRoot = path.resolve(backendRoot, "../frontend");
const distDir = path.join(frontendRoot, "dist");

export const paths = {
  coreDir,
  srcDir,
  backendRoot,
  projectRoot,
  frontendRoot,
  distDir,
};

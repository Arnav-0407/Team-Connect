const { copyFileSync, cpSync, mkdirSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { backendConfig, browserConfigSource, supabaseSdkFile } = require("../server/index.cjs");

const project = resolve(__dirname, "..");
const output = join(project, ".data", "live-server");

try {
  try { process.loadEnvFile(join(project, ".env")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const config = backendConfig({ ...process.env, TEAM_CONNECT_BACKEND: "supabase" });
  const sdk = supabaseSdkFile();

  mkdirSync(output, { recursive: true, mode: 0o700 });
  copyFileSync(join(project, "index.html"), join(output, "index.html"));
  for (const directory of ["css", "js"]) {
    cpSync(join(project, directory), join(output, directory), { recursive: true });
  }
  copyFileSync(sdk, join(output, "js", "supabase-sdk.js"));
  writeFileSync(join(output, "js", "backendConfig.js"), browserConfigSource(config));
  console.log("Prepared the Supabase frontend in .data/live-server.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

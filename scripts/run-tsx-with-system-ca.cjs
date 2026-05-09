const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const existingNodeOptions = process.env.NODE_OPTIONS ?? "";
const useSystemCaOption = "--use-system-ca";
const nodeOptions = existingNodeOptions.includes(useSystemCaOption)
  ? existingNodeOptions
  : `${existingNodeOptions} ${useSystemCaOption}`.trim();

const tsxCli = resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");
const result = spawnSync(process.execPath, [tsxCli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_OPTIONS: nodeOptions
  },
  windowsHide: true
});

if (typeof result.status === "number") {
  process.exit(result.status);
}

if (result.error) {
  console.error(result.error.message);
}

process.exit(1);

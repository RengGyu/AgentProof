import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_DATASET = "princeton-nlp/SWE-bench_Verified";
const DEFAULT_CONFIG = "default";
const DEFAULT_SPLIT = "test";
const DEFAULT_LENGTH = 10;
const DEFAULT_OUTPUT = "eval/generated/swebench-verified.rows.jsonl";

const options = parseArgs(process.argv.slice(2));
const dataset = options.dataset ?? DEFAULT_DATASET;
const config = options.config ?? DEFAULT_CONFIG;
const split = options.split ?? DEFAULT_SPLIT;
const offset = numberOption(options.offset, 0);
const length = numberOption(options.length, DEFAULT_LENGTH);
const output = resolve(options.output ?? DEFAULT_OUTPUT);

const url = new URL("https://datasets-server.huggingface.co/rows");
url.searchParams.set("dataset", dataset);
url.searchParams.set("config", config);
url.searchParams.set("split", split);
url.searchParams.set("offset", String(offset));
url.searchParams.set("length", String(length));

const response = await fetch(url);

if (!response.ok) {
  throw new Error(`Failed to fetch ${dataset}: HTTP ${response.status} ${response.statusText}`);
}

const payload = await response.json();
const rows = Array.isArray(payload.rows) ? payload.rows.map((item) => item.row).filter(Boolean) : [];

if (rows.length === 0) {
  throw new Error(`No rows returned for ${dataset}/${config}/${split}.`);
}

await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  "utf8"
);

console.log(`Wrote ${rows.length} ${dataset} row(s) to ${output}`);
console.log("Generated files under eval/generated are ignored by git; do not commit raw benchmark patches or logs.");

function parseArgs(args) {
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }

    if (!arg.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? args[index + 1];
    parsed[key] = value;

    if (inlineValue === undefined && value !== undefined) {
      index += 1;
    }
  }

  return parsed;
}

function numberOption(value, fallback) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

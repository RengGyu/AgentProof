import { pathToFileURL } from "node:url";
import { toolchainFailure } from "./toolchain-closure-policy.mjs";

export async function runAuthorityCli({
  argv = process.argv.slice(2),
  loadImplementation = () => import("./evaluate-production-authority-release.mjs"),
  writeError = (value) => process.stderr.write(value)
} = {}) {
  try {
    const implementation = await loadImplementation();
    const result = implementation.runProductionAuthorityReleaseCli(argv);
    return result ?? true;
  } catch (error) {
    writeError(`${JSON.stringify(toolchainFailure(error))}\n`);
    process.exitCode = 1;
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runAuthorityCli();

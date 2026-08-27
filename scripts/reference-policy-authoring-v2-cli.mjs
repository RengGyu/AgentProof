import { pathToFileURL } from "node:url";
import { runReferencePolicyAuthoringCliV2 } from "./reference-policy-authoring-v2.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runReferencePolicyAuthoringCliV2(process.argv[2], process.argv.slice(3));
}

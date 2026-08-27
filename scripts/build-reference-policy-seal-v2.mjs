import { runReferencePolicySealCliV2 } from "./reference-policy-authoring-v2.mjs";

process.exitCode = runReferencePolicySealCliV2(process.argv.slice(2));

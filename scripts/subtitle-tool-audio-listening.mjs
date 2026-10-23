import { pathToFileURL } from "node:url";
import {
  prepareListening,
  recordListening,
  verifyListening,
} from "./lib/audio-coverage-calibration.mjs";
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    let result;
    if (mode === "prepare" && args.length === 2)
      result = await prepareListening(...args);
    else if (mode === "evaluate" && args.length === 2)
      result = await recordListening(...args);
    else if (mode === "verify" && args.length === 1) {
      await verifyListening(args[0]);
      result = { integrity: "passed" };
    } else
      throw Error(
        "Usage: prepare FROZEN_OBSERVER NEW_OUTPUT_PARENT | evaluate LISTENING_ROOT LABELS_JSON | verify LISTENING_ROOT",
      );
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}

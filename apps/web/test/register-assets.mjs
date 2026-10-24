import { registerHooks } from "node:module";

// jsdom exercises the real editor; Vite handles stylesheet loading in browsers.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css"))
      return {
        format: "module",
        source: "export default {};",
        shortCircuit: true,
      };
    return nextLoad(url, context);
  },
});

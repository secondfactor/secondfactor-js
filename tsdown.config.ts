import { defineConfig } from "tsdown";

// ESM for bundlers and modern runtimes, CommonJS for older toolchains (Jest
// set-ups, require()), each with its own type declarations. ES2019 keeps the
// output readable by older React Native and browser runtimes.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  target: "es2019",
  platform: "neutral",
  clean: true,
});

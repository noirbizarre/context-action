import { defineConfig } from "tsdown"

export default defineConfig({
  entry: { index: "src/main.ts" },
  format: "esm",
  platform: "node",
  target: "node24",
  outDir: "dist",
  // Emit `index.js` (not `.mjs`); package.json has "type": "module".
  fixedExtension: false,
  clean: true,
  dts: false,
  minify: false,
  sourcemap: false,
  // GitHub Actions users must not install dependencies: inline everything.
  noExternal: [/.*/],
  outputOptions: {
    // Some bundled CJS dependencies call `require` for Node built-ins.
    banner:
      'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
})

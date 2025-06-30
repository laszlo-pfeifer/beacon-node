import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import dts from "rollup-plugin-dts";
import packageJson from "./package.json" with { type: "json" };

export default [
  // 1. JS builds (ESM & CJS)
  {
    input: "src/index.ts",
    output: [
      {
        file: "dist/index.mjs",
        format: "esm",
        sourcemap: true,
      },
      {
        file: "dist/index.js",
        format: "cjs",
        sourcemap: true,
        exports: "named",
      },
    ],
    plugins: [
      nodeResolve(),
      commonjs(),
      typescript({
        tsconfig: "./tsconfig.json",
        declaration: false, // We emit types in the next step
        outDir: "dist",
      }),
    ],
    external: [
      ...Object.keys(packageJson.dependencies || {}),
      ...Object.keys(packageJson.peerDependencies || {}),
    ],
  },

  // 2. Types (.d.ts)
  {
    input: "src/index.ts",
    output: [{ file: "dist/index.d.ts", format: "es" }],
    plugins: [dts()],
    external: [
      ...Object.keys(packageJson.dependencies || {}),
      ...Object.keys(packageJson.peerDependencies || {}),
    ],
  },
];

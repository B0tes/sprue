import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      ".claude/**",
      "products/**/figure/**",
      "skills/sprue/kit/**", // vendored from Anatomy, with one change (skills/sprue/NOTICE)
      "skills/sprue/viewer/vendor/three/**", // three.js, minified by scripts/vendor-three.mjs (skills/sprue/NOTICE)
      "evals/**", // raw outputs of benchmark runs, kept as they came out
    ],
  },
];

export default eslintConfig;

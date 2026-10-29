import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "build/**",
      "dist/**",
      "coverage/**",
      ".kilo/**",
      ".worktrees/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,cjs,mjs,ts}"],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
  {
    files: ["**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    rules: {
      // Existing DTOs and Express handlers contain intentionally unused parameters;
      // TypeScript checks names and declarations while ESLint checks runtime hazards.
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-redeclare": "off",
      "no-dupe-class-members": "off",
    },
  },
);

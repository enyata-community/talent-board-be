import type { Config } from "jest";
import base from "./jest.config";
const config: Config = {
  ...base,
  displayName: "integration",
  collectCoverage: false,
  coverageThreshold: undefined,
  testMatch: ["<rootDir>/src/__tests__/**/*.integration.test.ts"],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/build/",
    "/.kilo/",
    "/.worktrees/",
  ],
  setupFiles: [
    "<rootDir>/test/integration.setup.cjs",
    "<rootDir>/jest.setup.ts",
  ],
  setupFilesAfterEnv: ["<rootDir>/test/integration.cleanup.cjs"],
  testTimeout: 30000,
};
export default config;

import type { Config } from "jest";

const config: Config = {
  verbose: true,
  preset: "ts-jest",
  testEnvironment: "node",
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.jest.json" }],
  },
  moduleNameMapper: {
    "^@src/(.*)$": "<rootDir>/src/$1",
    "^@tests/(.*)$": "<rootDir>/src/__tests__/$1",
  },
  moduleDirectories: ["node_modules", "src"],
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageThreshold: {
    global: { statements: 65, branches: 45, functions: 40, lines: 65 },
  },
  coverageReporters: ["json", "lcov", "text", "clover"],
  modulePathIgnorePatterns: [
    "<rootDir>/build/",
    "<rootDir>/.kilo/",
    "<rootDir>/.worktrees/",
  ],
  testPathIgnorePatterns: [
    "<rootDir>/config/",
    "<rootDir>/build/",
    "/.kilo/",
    "/.worktrees/",
    "\\.integration\\.test\\.ts$",
  ],
  detectOpenHandles: true,
  maxWorkers: 1,
  clearMocks: true,
  setupFiles: ["<rootDir>/jest.setup.ts"],
};

export default config;

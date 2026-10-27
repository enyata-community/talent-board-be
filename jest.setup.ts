process.env.TALENTS_NODE_ENV = "test";
jest.mock("@src/utils/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  closeLogger: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@src/utils/redis", () => ({
  __esModule: true,
  default: {
    set: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn(),
    quit: jest.fn(),
  },
}));

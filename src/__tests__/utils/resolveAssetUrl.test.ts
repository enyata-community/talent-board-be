describe("resolveAssetUrl", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("resolves upload paths against the configured base URL", () => {
    const mockConfig = {
      has: jest.fn().mockReturnValue(true),
      get: jest.fn((key) =>
        key === "API_PREFIX" ? "api/v1" : "https://talents-api.enyata.com/",
      ),
    };

    jest.doMock("config", () => mockConfig);

    const { resolveAssetUrl } = require("@src/utils/resolveAssetUrl");

    expect(resolveAssetUrl("/uploads/avatars/avatar.png")).toBe(
      "https://talents-api.enyata.com/api/v1/assets/avatars/avatar.png",
    );
  });

  it("leaves existing absolute URLs unchanged", () => {
    const mockConfig = {
      has: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue("https://talents-api.enyata.com"),
    };

    jest.doMock("config", () => mockConfig);

    const { resolveAssetUrl } = require("@src/utils/resolveAssetUrl");

    expect(resolveAssetUrl("https://cdn.example.com/resume.pdf")).toBe(
      "https://cdn.example.com/resume.pdf",
    );
  });
});

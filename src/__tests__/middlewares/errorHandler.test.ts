import config from "config";
import { JsonWebTokenError } from "jsonwebtoken";
import errorHandler from "@src/middlewares/errorHandler";
import { AppError } from "@src/exceptions/appError";
afterEach(() => jest.restoreAllMocks());
const response = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
  headersSent: false,
});
test.each(["production", "test", "staging", undefined])(
  "errors return a safe response in %s",
  (env) => {
    jest.spyOn(config, "has").mockReturnValue(env !== undefined);
    jest.spyOn(config, "get").mockReturnValue(env);
    const res = response();
    errorHandler(
      new AppError("Invalid request", 400),
      {} as any,
      res as any,
      jest.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Invalid request" }),
    );
    expect(res.json.mock.calls[0][0]).not.toHaveProperty("stack");
  },
);
test("unexpected errors do not expose implementation details", () => {
  const res = response();
  errorHandler(new Error("database secret"), {} as any, res as any, jest.fn());
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json.mock.calls[0][0].message).toBe("Something went wrong!");
});
test("JWT errors are converted to an authentication response", () => {
  const res = response();
  errorHandler(
    new JsonWebTokenError("bad signature"),
    {} as any,
    res as any,
    jest.fn(),
  );
  expect(res.status).toHaveBeenCalledWith(401);
});
test("errors after response headers are sent delegate to Express", () => {
  const res = { ...response(), headersSent: true };
  const next = jest.fn();
  const error = new Error("stream failed");
  errorHandler(error, {} as any, res as any, next);
  expect(next).toHaveBeenCalledWith(error);
  expect(res.json).not.toHaveBeenCalled();
});

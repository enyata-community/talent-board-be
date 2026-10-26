import config from "config";
import { CorsOptions } from "cors";

const adminOrigin = new URL(config.get<string>("ADMIN_FRONTEND_URL")).origin;

const devOrigins = [
  adminOrigin,
  "http://localhost:3000",
  "http://localhost:8000",
];

const prodOrigins = [
  adminOrigin,
  "http://localhost:3000",
  config.get<string>("BASE_URL"),
  config.get<string>("FRONTEND_URL"),
];

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const allowedOrigins =
      config.get<string>("NODE_ENV") === "production"
        ? prodOrigins
        : devOrigins;

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Authorization",
    "x-refresh-token",
    "x-admin-csrf",
  ],
};

export default corsOptions;

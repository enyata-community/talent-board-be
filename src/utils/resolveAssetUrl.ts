import config from "config";

// Resolve API URLs without exposing storage paths.
const getBaseUrl = (): string => {
  const configuredBaseUrl = config.has("BASE_URL")
    ? config.get<string>("BASE_URL")
    : "";
  const baseUrl =
    configuredBaseUrl || process.env.BASE_URL || "http://localhost:8000";

  return baseUrl.replace(/\/+$/, "");
};

// OAuth image URLs and external portfolio URLs are preserved; uploaded avatars
// go through the image-only route. Résumés require the authorized download route.
export const resolveAssetUrl = (path?: string): string | null => {
  if (!path) return null;

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const avatar = path.match(
    /^\/?(?:uploads\/)?avatars\/([a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|webp))$/,
  );
  if (!avatar) return null;
  const prefix = config.has("API_PREFIX")
    ? config.get<string>("API_PREFIX")
    : "api/v1";
  return `${getBaseUrl()}/${prefix}/assets/avatars/${avatar[1]}`;
};

import config from "config";

export const resumeDownloadUrl = (talentId: string): string =>
  `${config.get<string>("BASE_URL").replace(/\/+$/, "")}/${config.get<string>("API_PREFIX")}/talents/${encodeURIComponent(talentId)}/resume`;

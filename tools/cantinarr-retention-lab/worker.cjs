const fs = require("node:fs");
const { createRequire } = require("node:module");
const requireApp = createRequire("/opt/app/apps/server/package.json");
requireApp("reflect-metadata");
const axios = requireApp("axios");
const { CantinarrApiService } = requireApp(
  "./dist/modules/api/cantinarr-api/cantinarr-api.service",
);
const { applyHttpRetry } = requireApp("./dist/modules/api/lib/httpRetry");
const { validateConfig, processCandidate } = require("./policy.cjs");

function client(url, headers = {}, write = false) {
  const http = axios.create({
    baseURL: url,
    headers,
    timeout: 10000,
    maxRedirects: 0,
    maxContentLength: 5 * 1024 * 1024,
  });
  applyHttpRetry(http, write ? { retries: 0 } : {});
  return http;
}
async function main() {
  const config = validateConfig(
    JSON.parse(fs.readFileSync("/run/secrets/policy.json", "utf8")),
  );
  const apply = process.argv.includes("--apply");
  if (
    apply &&
    process.env.CANTINARR_LAB_ALLOW_DELETE !== "disposable-fixtures-only"
  )
    throw new Error("lab_delete_ack_required");
  const maintainerr = client(config.maintainerr.url);
  const action = client(config.maintainerr.url, {}, true);
  const radarr = client(config.radarr.url, {
    "X-Api-Key": config.radarr.apiKey,
  });
  const jellyfin = client(config.jellyfin.url, {
    "X-Emby-Token": config.jellyfin.apiKey,
  });
  const cantinarr = new CantinarrApiService({});
  const get = async (http, path, signal) =>
    (await http.get(path, { signal })).data;
  async function read(item) {
    const signal = AbortSignal.timeout(60000);
    const [
      requests,
      settings,
      collection,
      radarrSettings,
      exclusions,
      users,
      sessions,
      movie,
      files,
      queue,
      tags,
    ] = await Promise.all([
      cantinarr.getRequests({
        url: config.cantinarr.url,
        api_key: config.cantinarr.token,
      }),
      get(maintainerr, "/api/settings", signal),
      get(
        maintainerr,
        "/api/collections/collection/" + item.collectionId,
        signal,
      ),
      get(maintainerr, "/api/settings/radarr", signal),
      get(
        maintainerr,
        "/api/rules/exclusion?mediaServerId=" +
          encodeURIComponent(item.mediaId),
        signal,
      ),
      get(jellyfin, "/Users", signal),
      get(jellyfin, "/Sessions", signal),
      get(radarr, "/api/v3/movie/" + item.movieId, signal),
      get(radarr, "/api/v3/moviefile?movieId=" + item.movieId, signal),
      get(radarr, "/api/v3/queue?page=1&pageSize=1000", signal),
      get(radarr, "/api/v3/tag", signal),
    ]);
    if (!Array.isArray(users) || users.length > 100)
      throw new Error("users_unreadable");
    const userItems = [];
    for (const user of users)
      userItems.push({
        userId: user.Id,
        item: await get(
          jellyfin,
          "/Users/" +
            encodeURIComponent(user.Id) +
            "/Items/" +
            encodeURIComponent(item.mediaId),
          signal,
        ),
      });
    return {
      requests,
      settings,
      collection,
      radarrSettings,
      exclusions,
      users,
      sessions,
      movie,
      files,
      queue,
      tags,
      userItems,
    };
  }
  const act = async (item) => {
    await action.post("/api/collections/media/handle", {
      collectionId: item.collectionId,
      mediaId: item.mediaId,
    });
    const remaining = await get(
      radarr,
      "/api/v3/moviefile?movieId=" + item.movieId,
      AbortSignal.timeout(10000),
    );
    if (!Array.isArray(remaining) || remaining.length)
      throw new Error("delete_unconfirmed");
  };
  do {
    const results = [];
    for (const candidate of config.candidates)
      results.push({
        mediaId: candidate.mediaId,
        ...(await processCandidate({ config, candidate, read, act, apply })),
      });
    const result = {
      at: new Date().toISOString(),
      mode: apply ? "apply" : "dry-run",
      minimumAgeSeconds: config.minimumAgeSeconds,
      results,
    };
    fs.writeFileSync("/state/latest.json.tmp", JSON.stringify(result, null, 2));
    fs.renameSync("/state/latest.json.tmp", "/state/latest.json");
    console.log(JSON.stringify(result));
    if (!process.argv.includes("--loop")) break;
    await new Promise((resolve) => setTimeout(resolve, 30000));
  } while (true);
}
main().catch(() => {
  console.error(
    "Lab worker stopped: invalid configuration or unavailable dependency.",
  );
  process.exitCode = 1;
});

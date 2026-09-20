const path = require("node:path");
const hold = (reason) => ({ eligible: false, reason });
const array = (v) => Array.isArray(v);
const id = (v) => Number.isInteger(v) && v > 0;

function validateConfig(c) {
  const urls = {
    cantinarr: "http://cantinarr:8585",
    maintainerr: "http://maintainerr:6246",
    radarr: "http://radarr:7878",
    jellyfin: "http://jellyfin-fixture:8096",
  };
  if (c.labOnly !== true || ![300, 3600].includes(c.minimumAgeSeconds))
    throw new Error("lab_policy_required");
  for (const [name, url] of Object.entries(urls))
    if (c[name]?.url !== url) throw new Error("lab_service_required");
  if (
    !c.cantinarr.token ||
    !c.radarr.apiKey ||
    !c.jellyfin.apiKey ||
    !id(c.radarr.settingsId) ||
    !c.cantinarr.instanceId ||
    !c.jellyfin.cantinarrInstanceId
  )
    throw new Error("explicit_bindings_required");
  if (
    !array(c.identities) ||
    !c.identities.length ||
    c.identities.some(
      (x) =>
        !id(x.cantinarrUserId) ||
        typeof x.mediaUserId !== "string" ||
        !x.mediaUserId,
    )
  )
    throw new Error("identity_bindings_required");
  if (
    new Set(c.identities.map((x) => x.cantinarrUserId)).size !==
      c.identities.length ||
    new Set(c.identities.map((x) => x.mediaUserId)).size !== c.identities.length
  )
    throw new Error("ambiguous_identity_bindings");
  if (
    !array(c.candidates) ||
    !c.candidates.length ||
    c.candidates.length > 20 ||
    c.candidates.some(
      (x) =>
        !id(x.tmdbId) ||
        !id(x.movieId) ||
        !id(x.collectionId) ||
        typeof x.mediaId !== "string" ||
        !x.mediaId,
    )
  )
    throw new Error("candidate_bindings_required");
  for (const key of ["tmdbId", "movieId", "mediaId"])
    if (new Set(c.candidates.map((x) => x[key])).size !== c.candidates.length)
      throw new Error("ambiguous_candidates");
  return c;
}

/** All inputs are fresh reads. Absence or malformed evidence never permits deletion. */
function evaluate(c, item, s, now = Date.now()) {
  if (
    s.settings?.media_server_type !== "jellyfin" ||
    s.settings.jellyfin_url !== c.jellyfin.url ||
    s.settings.download_client_url != null
  )
    return hold("maintainerr_binding_or_downloader");
  const collection = s.collection;
  if (
    !collection ||
    collection.id !== item.collectionId ||
    collection.type !== "movie" ||
    collection.radarrSettingsId !== c.radarr.settingsId ||
    collection.arrAction !== 1 ||
    collection.deleteAfterDays !== null ||
    collection.isActive !== true ||
    collection.forceSeerr !== false ||
    collection.cleanupLeftoverFolders !== false ||
    collection.keepInMaintainerrOnly !== true
  )
    return hold("collection_policy");
  if (
    !array(s.radarrSettings) ||
    !s.radarrSettings.some(
      (x) => x.id === c.radarr.settingsId && x.url === c.radarr.url,
    )
  )
    return hold("radarr_binding");
  if (!array(s.exclusions)) return hold("exclusions_unreadable");
  // Conservative across rule groups: a lab exclusion anywhere protects the item.
  if (
    s.exclusions.some(
      (x) => x.mediaServerId === item.mediaId || x.parent === item.mediaId,
    )
  )
    return hold("excluded");
  if (
    !array(s.users) ||
    !s.users.length ||
    s.users.some((x) => typeof x.Id !== "string" || !x.Id) ||
    new Set(s.users.map((x) => x.Id)).size !== s.users.length
  )
    return hold("users_unreadable");
  if (!array(s.sessions)) return hold("sessions_unreadable");
  if (s.sessions.some((x) => x.NowPlayingItem?.Id === item.mediaId))
    return hold("actively_playing");
  if (!array(s.requests)) return hold("history_unreadable");
  const requests = s.requests.filter(
    (x) =>
      x.media_type === "movie" &&
      x.tmdb_id === item.tmdbId &&
      x.instance_id === c.cantinarr.instanceId,
  );
  if (!requests.length) return hold("no_mapped_request");
  let newest = 0;
  for (const request of requests) {
    if (
      request.requester_known !== true ||
      !id(request.requester_id) ||
      request.saved_mapping_known !== true ||
      request.recorded_status !== "completed"
    )
      return hold("request_incomplete");
    const binding = c.identities.find(
      (x) => x.cantinarrUserId === request.requester_id,
    );
    const links = array(request.identities)
      ? request.identities.filter(
          (x) => x.instance_id === c.jellyfin.cantinarrInstanceId,
        )
      : [];
    if (
      !binding ||
      links.length !== 1 ||
      links[0].provider !== "jellyfin" ||
      links[0].state !== "recorded" ||
      links[0].remote_user_id !== binding.mediaUserId ||
      !s.users.some((x) => x.Id === binding.mediaUserId)
    )
      return hold("requester_unmapped");
    const date = Date.parse(request.requested_at);
    if (!Number.isFinite(date) || date > now)
      return hold("request_time_unknown");
    newest = Math.max(newest, date);
  }
  if (now - newest < c.minimumAgeSeconds * 1000)
    return hold("request_too_recent");
  const movie = s.movie;
  if (
    !movie ||
    movie.id !== item.movieId ||
    movie.tmdbId !== item.tmdbId ||
    typeof movie.path !== "string" ||
    path.posix.normalize(movie.path) !== movie.path ||
    !movie.path.startsWith("/lab/movies/")
  )
    return hold("movie_mapping");
  if (!array(movie.tags) || !array(s.tags)) return hold("tags_unreadable");
  if (movie.tags.some((id) => !s.tags.some((t) => t.id === id)))
    return hold("tags_unreadable");
  if (s.tags.some((t) => typeof t.label !== "string"))
    return hold("tags_unreadable");
  if (
    s.tags.some(
      (t) => t.label.toLowerCase() === "keep" && movie.tags.includes(t.id),
    )
  )
    return hold("keep_tag");
  if (!array(s.files) || !s.files.length) return hold("no_files");
  if (
    s.files.some(
      (f) =>
        !id(f.id) ||
        f.movieId !== item.movieId ||
        typeof f.path !== "string" ||
        path.posix.normalize(f.path) !== f.path ||
        !f.path.startsWith(movie.path + "/"),
    )
  )
    return hold("file_mapping");
  if (
    !s.queue ||
    !array(s.queue.records) ||
    !Number.isInteger(s.queue.totalRecords) ||
    s.queue.totalRecords !== s.queue.records.length
  )
    return hold("queue_incomplete");
  if (s.queue.records.some((x) => !id(x.movieId) || x.movieId === item.movieId))
    return hold("acquisition_active");
  if (!array(s.userItems) || s.userItems.length !== s.users.length)
    return hold("user_state_incomplete");
  for (const user of s.users) {
    const matches = s.userItems.filter((x) => x.userId === user.Id);
    const media = matches[0]?.item;
    if (
      matches.length !== 1 ||
      !media ||
      media.Id !== item.mediaId ||
      media.Type !== "Movie" ||
      Number(media.ProviderIds?.Tmdb) !== item.tmdbId ||
      !media.UserData ||
      typeof media.UserData.IsFavorite !== "boolean" ||
      typeof media.UserData.Played !== "boolean" ||
      !Number.isFinite(media.UserData.PlaybackPositionTicks) ||
      !Number.isFinite(media.UserData.PlayedPercentage)
    )
      return hold("user_state_incomplete");
    if (media.UserData.IsFavorite) return hold("favorite");
    if (
      media.UserData.PlaybackPositionTicks > 0 ||
      (!media.UserData.Played && media.UserData.PlayedPercentage > 0)
    )
      return hold("unfinished_viewing");
  }
  return {
    eligible: true,
    reason: "mapped_completed_request_old_enough",
    newestRequestAt: new Date(newest).toISOString(),
  };
}

async function processCandidate({
  config,
  candidate,
  read,
  act,
  apply,
  now = Date.now,
}) {
  try {
    const first = await read(candidate);
    const verdict = evaluate(config, candidate, first, now());
    if (!verdict.eligible || !apply)
      return { ...verdict, action: apply ? "held" : "dry-run" };
    // No write based on the old candidate snapshot. Repeat ALL live guards.
    const fresh = await read(candidate);
    const checked = evaluate(config, candidate, fresh, now());
    if (!checked.eligible) return { ...checked, action: "held" };
    // The POST has no retries. Unknown write outcomes are never claimed successful.
    await act(candidate);
    return { ...checked, action: "submitted" };
  } catch {
    // HTTP errors may contain API tokens; only a fixed reason reaches logs.
    return {
      eligible: false,
      reason: "read_or_action_failed",
      action: "held_or_unconfirmed",
    };
  }
}
module.exports = { validateConfig, evaluate, processCandidate };

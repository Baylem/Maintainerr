const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateConfig, evaluate, processCandidate } = require("./policy.cjs");
const now = Date.parse("2026-09-20T12:00:00Z");
const candidate = { tmdbId: 1, movieId: 1, collectionId: 1, mediaId: "sample" };
const config = {
  labOnly: true,
  minimumAgeSeconds: 300,
  cantinarr: {
    url: "http://cantinarr:8585",
    token: "synthetic",
    instanceId: "movies",
  },
  maintainerr: { url: "http://maintainerr:6246" },
  radarr: { url: "http://radarr:7878", apiKey: "synthetic", settingsId: 1 },
  jellyfin: {
    url: "http://jellyfin-fixture:8096",
    apiKey: "synthetic",
    cantinarrInstanceId: "media",
  },
  identities: [{ cantinarrUserId: 1, mediaUserId: "viewer" }],
  candidates: [candidate],
};
function snapshot() {
  return {
    settings: {
      media_server_type: "jellyfin",
      jellyfin_url: config.jellyfin.url,
      download_client_url: null,
    },
    collection: {
      id: 1,
      type: "movie",
      radarrSettingsId: 1,
      arrAction: 1,
      deleteAfterDays: null,
      isActive: true,
      forceSeerr: false,
      cleanupLeftoverFolders: false,
      keepInMaintainerrOnly: true,
    },
    radarrSettings: [{ id: 1, url: config.radarr.url }],
    exclusions: [],
    users: [{ Id: "viewer" }],
    sessions: [],
    requests: [
      {
        requester_id: 1,
        requester_known: true,
        media_type: "movie",
        tmdb_id: 1,
        instance_id: "movies",
        saved_mapping_known: true,
        recorded_status: "completed",
        requested_at: new Date(now - 300000).toISOString(),
        identities: [
          {
            instance_id: "media",
            provider: "jellyfin",
            state: "recorded",
            remote_user_id: "viewer",
          },
        ],
      },
    ],
    movie: { id: 1, tmdbId: 1, path: "/lab/movies/sample", tags: [] },
    tags: [],
    files: [{ id: 1, movieId: 1, path: "/lab/movies/sample/sample.mkv" }],
    queue: { records: [], totalRecords: 0 },
    userItems: [
      {
        userId: "viewer",
        item: {
          Id: "sample",
          Type: "Movie",
          ProviderIds: { Tmdb: "1" },
          UserData: {
            IsFavorite: false,
            Played: false,
            PlaybackPositionTicks: 0,
            PlayedPercentage: 0,
          },
        },
      },
    ],
  };
}
test("only explicit lab bindings and supported test windows", () => {
  assert.equal(validateConfig(config), config);
  for (const change of [
    { labOnly: false },
    { minimumAgeSeconds: 0 },
    { identities: [] },
    { candidates: [] },
    { radarr: { ...config.radarr, url: "http://production" } },
    { identities: [config.identities[0], config.identities[0]] },
  ])
    assert.throws(() => validateConfig({ ...config, ...change }));
});
test("exactly five minutes passes, one millisecond before does not", () => {
  assert.equal(evaluate(config, candidate, snapshot(), now).eligible, true);
  assert.equal(
    evaluate(config, candidate, snapshot(), now - 1).reason,
    "request_too_recent",
  );
});
const holds = [
  [
    "newer second request restarts the clock",
    (s) =>
      s.requests.push({
        ...s.requests[0],
        requested_at: new Date(now - 1000).toISOString(),
      }),
    "request_too_recent",
  ],
  [
    "wrong instance",
    (s) => (s.requests[0].instance_id = "other"),
    "no_mapped_request",
  ],
  ["missing request", (s) => (s.requests = []), "no_mapped_request"],
  [
    "unknown requester",
    (s) => (s.requests[0].requester_known = false),
    "request_incomplete",
  ],
  [
    "unmapped requester",
    (s) => (s.requests[0].requester_id = 2),
    "requester_unmapped",
  ],
  [
    "disabled identity",
    (s) => (s.requests[0].identities[0].state = "disabled"),
    "requester_unmapped",
  ],
  [
    "pending identity",
    (s) => (s.requests[0].identities[0].state = "pending"),
    "requester_unmapped",
  ],
  [
    "wrong linked user",
    (s) => (s.requests[0].identities[0].remote_user_id = "other"),
    "requester_unmapped",
  ],
  [
    "duplicate identity",
    (s) => s.requests[0].identities.push(s.requests[0].identities[0]),
    "requester_unmapped",
  ],
  [
    "unmapped movie",
    (s) => (s.requests[0].saved_mapping_known = false),
    "request_incomplete",
  ],
  [
    "pending request",
    (s) => (s.requests[0].recorded_status = "requested"),
    "request_incomplete",
  ],
  [
    "future time",
    (s) => (s.requests[0].requested_at = new Date(now + 1).toISOString()),
    "request_time_unknown",
  ],
  [
    "invalid time",
    (s) => (s.requests[0].requested_at = "invalid"),
    "request_time_unknown",
  ],
  [
    "explicit exclusion",
    (s) => s.exclusions.push({ mediaServerId: "sample" }),
    "excluded",
  ],
  [
    "favorite",
    (s) => (s.userItems[0].item.UserData.IsFavorite = true),
    "favorite",
  ],
  [
    "unfinished viewing",
    (s) => (s.userItems[0].item.UserData.PlayedPercentage = 1),
    "unfinished_viewing",
  ],
  [
    "active session",
    (s) => s.sessions.push({ NowPlayingItem: { Id: "sample" } }),
    "actively_playing",
  ],
  [
    "unknown user state",
    (s) => delete s.userItems[0].item.UserData.Played,
    "user_state_incomplete",
  ],
  [
    "additional viewer not read",
    (s) => s.users.push({ Id: "second" }),
    "user_state_incomplete",
  ],
  [
    "keep tag",
    (s) => {
      s.movie.tags = [1];
      s.tags = [{ id: 1, label: "keep" }];
    },
    "keep_tag",
  ],
  ["unknown tag", (s) => (s.movie.tags = [1]), "tags_unreadable"],
  ["incomplete queue", (s) => (s.queue.totalRecords = 1), "queue_incomplete"],
  [
    "active download",
    (s) => (s.queue = { totalRecords: 1, records: [{ movieId: 1 }] }),
    "acquisition_active",
  ],
  ["different movie file", (s) => (s.files[0].movieId = 2), "file_mapping"],
  [
    "path traversal",
    (s) => (s.movie.path = "/lab/movies/../../outside"),
    "movie_mapping",
  ],
  [
    "non-lab file",
    (s) => (s.files[0].path = "/media/personal.mkv"),
    "file_mapping",
  ],
  ["no files", (s) => (s.files = []), "no_files"],
  [
    "native timer enabled",
    (s) => (s.collection.deleteAfterDays = 0),
    "collection_policy",
  ],
  [
    "wrong manager binding",
    (s) => (s.radarrSettings[0].url = "http://other"),
    "radarr_binding",
  ],
  [
    "downloader configured",
    (s) => (s.settings.download_client_url = "http://download"),
    "maintainerr_binding_or_downloader",
  ],
];
for (const [name, mutate, reason] of holds)
  test(name, () => {
    const s = snapshot();
    mutate(s);
    assert.equal(evaluate(config, candidate, s, now).reason, reason);
  });
test("dry-run never calls the deletion endpoint", async () => {
  const result = await processCandidate({
    config,
    candidate,
    read: async () => snapshot(),
    act: async () => assert.fail("unexpected write"),
    apply: false,
    now: () => now,
  });
  assert.equal(result.action, "dry-run");
});
test("fresh request or favorite between snapshots prevents deletion", async () => {
  for (const mutate of [
    (s) => (s.requests[0].requested_at = new Date(now).toISOString()),
    (s) => (s.userItems[0].item.UserData.IsFavorite = true),
  ]) {
    let reads = 0;
    const result = await processCandidate({
      config,
      candidate,
      read: async () => {
        const s = snapshot();
        if (++reads === 2) mutate(s);
        return s;
      },
      act: async () => assert.fail("unexpected write"),
      apply: true,
      now: () => now,
    });
    assert.equal(result.action, "held");
    assert.equal(reads, 2);
  }
});
test("read failure, including incomplete Cantinarr history, never reaches deletion", async () => {
  const result = await processCandidate({
    config,
    candidate,
    read: async () => {
      throw new Error("secret");
    },
    act: async () => assert.fail("unexpected write"),
    apply: true,
  });
  assert.equal(result.action, "held_or_unconfirmed");
  assert.equal(JSON.stringify(result).includes("secret"), false);
});
test("apply submits once only after two successful fresh reads", async () => {
  let reads = 0,
    writes = 0;
  const result = await processCandidate({
    config,
    candidate,
    read: async () => {
      reads++;
      return snapshot();
    },
    act: async () => {
      writes++;
    },
    apply: true,
    now: () => now,
  });
  assert.equal(result.action, "submitted");
  assert.equal(reads, 2);
  assert.equal(writes, 1);
});
test("unknown mutation outcome is not retried or claimed successful", async () => {
  let writes = 0;
  const result = await processCandidate({
    config,
    candidate,
    read: async () => snapshot(),
    act: async () => {
      writes++;
      throw new Error("secret");
    },
    apply: true,
    now: () => now,
  });
  assert.equal(result.action, "held_or_unconfirmed");
  assert.equal(writes, 1);
});

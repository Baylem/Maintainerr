# Cantinarr retention eligibility Docker lab

An opt-in, movie-only prototype that connects the Cantinarr integration API v1 to Maintainerr's existing collection action endpoint. This is a separate Docker worker, not a native rule-editor provider or a production retention-policy replacement. It reuses the compiled Cantinarr client and shared HTTP retry policy from the companion Maintainerr fork.

## Policy

A configured candidate may be submitted only when its newest matching Cantinarr request is at least 300 seconds old (3600 is also supported), every matching request is completed, and every requester has an explicit identity binding confirmed by a recorded Cantinarr media-server link and a current Jellyfin user. The binding includes the Cantinarr Radarr instance, Maintainerr Radarr connection ID, Cantinarr media-server instance, and each candidate's TMDB, Radarr and Jellyfin IDs. No request, missing identity, unsupported media or uncertain history means hold.

The worker reads all retained history through CantinarrApiService, which rejects incompatible capabilities, incomplete history and inconsistent pagination. It also reads Maintainerr's settings, collection configuration and item-specific exclusions, Radarr's live movie/file/tag/queue state, and Jellyfin's users, sessions and per-user item state. Favorites, unfinished playback, active playback, keep tags and active/unknown acquisition queues prevent deletion. The latest request sets the lab clock; this deliberately does not model production watch-based or availability-based deadlines.

Every write is preceded by a second complete evaluation. The worker then calls Maintainerr's `POST /api/collections/media/handle` once, without automatic write retries, and checks that Radarr no longer lists files. Unknown write outcomes are reported as unconfirmed. The same candidate is not automatically added back to a collection. The native collection timer must be unset, the action must retain the unmonitored Radarr record, and downloader integration, request-reset and leftover-directory cleanup must be disabled.

## Isolation and execution

Build from the repository root after building the Maintainerr fork image:

```sh
docker build -f tools/cantinarr-retention-lab/Dockerfile -t local/cantinarr-retention-lab:dev .
```

The worker reads `/run/secrets/policy.json` and writes sanitized results to `/state/latest.json`. Mount the configuration read-only and keep it out of Git: it contains the lab integration token and Radarr/Jellyfin API keys. Default execution is one dry run. `--apply` additionally requires `CANTINARR_LAB_ALLOW_DELETE=disposable-fixtures-only`; `--loop` repeats sequentially every 30 seconds. Stop the worker when the experiment finishes.

The config is intentionally fenced to `labOnly: true`, the four Docker DNS names declared in `validateConfig`, `/lab/movies/` paths, explicit candidates (at most 20), and a 300- or 3600-second threshold. It is not a general deployment config. Do not attach real libraries or production credentials to this lab. Keep credentials local; errors are sanitized because HTTP exceptions may contain Authorization headers.

Config keys (secrets deliberately omitted): `labOnly`, `minimumAgeSeconds`, `cantinarr {url, token, instanceId}`, `maintainerr {url}`, `radarr {url, apiKey, settingsId}`, `jellyfin {url, apiKey, cantinarrInstanceId}`, `identities [{cantinarrUserId, mediaUserId}]`, and `candidates [{tmdbId, movieId, collectionId, mediaId}]`.

Run the policy tests with `node --test tools/cantinarr-retention-lab/policy.test.cjs`. They cover deadline boundaries, clock resets, mapping uncertainty, protection conditions, fresh pre-write revalidation and unknown mutation outcomes.

## Boundaries

This experiment does not add native Cantinarr rules, TV/anime season deletion, real acquisition/import or a production scheduler. The live verification uses the real two forks and Radarr with synthetic DB records and disposable marker files; Jellyfin responses are simulated. A five-minute request age is a test policy, not evidence that media was watched or became available five minutes ago.

Read-then-write checks cannot be atomic across these applications. Another request or protection can change after the final read but before the action reaches Radarr. Production adoption needs native rule integration, a deletion-time gate with a defined consistency contract, real media-server acceptance and the existing production guard's watch/availability rules. Retained Cantinarr history also does not include requests deleted before integration tracking or requests made in Seerr. The lab does not claim production retention parity.

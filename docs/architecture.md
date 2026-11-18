# Architecture

CrawlLab is one Node process for the API and the fixture origin, plus a Vite app in development. Production builds the dashboard and the API serves it.

```text
preset or seed batch
        |
        v
policy (allowlist, robots.txt, lab-script allowlist)
        |
        v
retry loop ---- backoff ---- optional host token bucket
        |
        v
BrowserPool.withContext
        |
        +-- page.on(request, response, console, pageerror)
        +-- goto / selector or error selector / HTTP request API
        +-- screenshot, trace, CDP Browser.getVersion (once per browser)
        |
        v
Observation
        |
        +-- objectiveMet -> success | failed
        +-- classify -> findings, confidence, primary category
        |
        v
SQLite (node:sqlite)  -->  Fastify  -->  dashboard
```

## Modules

- `src/fixtures/server.ts` is the only origin the presets use. It serves the pages, `robots.txt`, the minified gate, and the fault injector (`flake`, `ratelimit`, `overload`).
- `src/engine/pool.ts` launches bundled Chromium, falls back to system Chrome only if that launch throws, and reads `Browser.getVersion` over CDP. `withContext` closes the context in a `finally`. If the browser is already disconnected, the next call launches a new one.
- `src/engine/scrape.ts` is one attempt. It does not decide success. It returns an observation.
- `src/diagnostics/classify.ts` is pure. It can run in unit tests with no browser. Confidence is `high` only when the captured evidence contains the signal the sentence relies on. A page error next to a missing node is `medium`: the error is real, the causal link is not proven.
- `src/reliability` holds the queue, the token bucket, and backoff. The seed creates a queue per batch so a concurrency experiment is the queue size, not a global constant.
- `src/re` never drives Chromium. Folding understands string tables and `return a + b`. The simulator is `node:vm` with a fake `navigator`.

## Data

`runs` stores the request, the observation JSON, the diagnostic report, artifact paths, and logs. `fingerprint_observations` stores signals separately so two configs can be diffed without parsing every run. `experiment_notes` stores the fixture's own counters for that batch. `meta` stores the seed environment. Aggregates are computed when the API is read. They are not a second source of truth.

Startup marks leftover `queued` and `running` rows as `error`. A crash does not leave a run looking in-flight.

## Requests the API will not do

`POST /api/runs` accepts a preset id. It does not accept an arbitrary URL. Preset paths are resolved against the fixture origin started in-process. `ALLOW_EXTERNAL` does not bypass robots.txt, and lab init scripts exist only as the one token assignment in `src/policy/lab-scripts.ts`.

## Decisions

See `docs/adrs`.

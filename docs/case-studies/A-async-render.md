---
title: A late catalog looks like a missing node
summary: DOMContentLoaded reads an empty document. Waiting for networkidle times out on a heartbeat. Waiting for the node, or calling the JSON catalog, succeeds.
---

## Problem

The catalog is not in the first HTML payload. A timer inserts `#catalog` after 1200ms, and `setInterval` fetches `/api/ping` every 250ms. A job that reads the selector at `DOMContentLoaded` finds nothing. Retrying that read does not change the document state at that event.

## Reproduction

Fixture: `GET /pages/async` on the lab server.

1. `baseline-dcl` uses `waitStrategy: domcontentloaded`, selector `#catalog`, two retries, and `retryOnMiss`.
2. `networkidle` waits for network idle with a 2500ms budget and the same selector.
3. `selector-ready` waits for `#catalog` with an 8s budget and no retries.
4. `json-api` calls `GET /api/catalog` through Playwright's request API.

`npm run seed` runs 8, 4, 8, and 8 samples of those variants. The commands and the machine are in the results below.

## Evidence

The early run's page sets `data-crawllab-render="deferred"`. The classifier treats that marker, a finished load, and a missing selector as `async_content_not_ready` at high confidence. It does not claim a JavaScript exception unless one was captured.

The network-idle run still has the catalog text in the observation, plus repeated `/api/ping` entries. The category is `networkidle_false_timeout`. The objective stays failed because the wait condition itself timed out. Calling that a success would hide the wasted budget.

## Cause

`DOMContentLoaded` fires when the parser finishes. The timer has not run. `networkidle` requires the network to stay quiet for 500ms, and the heartbeat never allows that. The data is ready about 1200ms after parse. The JSON route never waits on either event.

## What we changed

The improved browser job waits for `#catalog`. The improved HTTP job skips rendering. Both are in `src/experiments/catalog.ts`. Retries were left off those two variants because the first attempt is the one that should succeed.

## What did not work

Retrying `DOMContentLoaded` three times. Waiting for `networkidle`. Raising the timeout on `networkidle` would only make the false failure slower. The heartbeat does not stop.

## Results

<!-- bench:case-a -->
Generated 2026-11-18T02:19:43.931Z by `npm run seed`. Node v22.23.4, linux 6.12.113+ x64, 4× Intel(R) Xeon(R) Processor. Playwright 1.65.1, browser channel `chromium`, CDP HeadlessChrome/159.0.8154.6.

| Variant | Role | Samples | Successes | Success rate | Avg ms | p95 ms | Avg attempts | Failure categories |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| baseline-dcl | baseline | 8 | 0 | 0% | 34.6 | 40 | 3 | async_content_not_ready 8 |
| json-api | improved | 8 | 8 | 100% | 8 | 11 | 1 | — |
| networkidle | baseline | 4 | 0 | 0% | 2536.8 | 2552 | 1 | networkidle_false_timeout 4 |
| selector-ready | improved | 8 | 8 | 100% | 1342 | 1382 | 1 | — |
<!-- /bench:case-a -->

## Limits

The marker is part of the fixture, so the high-confidence async finding depends on the page telling the truth. A third-party page without that marker falls through to `missing_dom` at high confidence that the node is absent, and does not claim the node will appear later. The 1200ms delay is fixed. A machine that cannot start Chromium will not reproduce the latency column.

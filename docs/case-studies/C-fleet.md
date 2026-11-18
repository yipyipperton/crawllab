---
title: Retries fix one fault and miss three others
summary: An injected 500 clears on the next attempt. A timeout below the render delay does not. Extra concurrency and a burst into a 2-per-5-second window do not.
---

## Problem

A fleet gets a lower success rate and the first patch is usually "retry". That helps only when a later attempt faces a different outcome. This case runs four faults on the fixture and records which knob moves the rate.

## Reproduction

All of these are batches in `src/experiments/catalog.ts`. The fixture policies are in `src/fixtures/policy.ts`.

| Variant | Fault | Client |
| --- | --- | --- |
| `flake-no-retry` | every 4th response is HTTP 500 (`seq % 4 === 0`) | 12 samples, concurrency 1, no retry, error selector |
| `flake-retry` | same counter | 12 samples, up to 3 retries, equal-jitter backoff |
| `overload-burst` | in-flight above 2 sleeps 4500ms; at or below 2 sleeps 1500ms | 6 samples, concurrency 6, timeout 2500ms |
| `overload-retry` | same | concurrency 6, timeout 2500ms, 2 retries |
| `overload-bounded` | same | concurrency 2, timeout 6000ms, no retry |
| `short-timeout` | `#ready-label` appears at 1200ms | timeout 400ms, 3 retries |
| `sufficient-timeout` | same page | timeout 5000ms, no retry |
| `ratelimit-burst` | 2 admissions per 5 seconds | 6 navigations, concurrency 6 |
| `ratelimit-paced` | same window | concurrency 1, shared token bucket of 1 token per 3 seconds |

The error selector is `#error[data-state="error"]`. A 500 or 429 from the follow-up fetch sets it, so the attempt ends without burning the timeout. The overload and slow-node faults do not set it. They lose on the clock.

Server counters for each batch are stored with the run notes and shown on the Experiments page.

## Evidence

Each failed run has a primary category: `upstream_error` for the error selector, `selector_timeout` when the budget expires, `http_429` when the rate-limited navigation itself is the document. Attempt rows show whether a later try succeeded. The fixture counters are the server's view of the same batch.

## Cause

The 500 is a function of a counter. The next attempt increments it, so it is a different request. The short timeout is a function of the clock. Every attempt is 400ms and the node cannot exist before 1200ms. The overload path keys off how many requests are in flight, so more workers and more retries add load. The rate limit is a sliding window of 2 per 5000ms. Six starts inside that window cannot all be admitted. One start every 3 seconds can.

## What we changed

Fail fast on the error marker. Retry 5xx with backoff. Cap concurrency at the fixture's fast-path limit and give that path a timeout above 1500ms. Pace the host with one shared bucket instead of six independent bursts. Set the slow-node budget to 5000ms and stop retrying it.

## What did not work

`retryOnMiss` is not used here. The short-timeout variant is already retryable because it times out, and the retries still fail. `overload-retry` keeps concurrency at 6. If the success rate stays near the burst rate, retries were the wrong knob. The results table is the check. A paced client that still receives 429s would mean the bucket was not actually shared or the window math was wrong. The attempt column and the fixture's `http429` counter are there for that.

## Results

<!-- bench:case-c -->
Generated 2026-11-18T02:19:43.931Z by `npm run seed`. Node v22.23.4, linux 6.12.113+ x64, 4× Intel(R) Xeon(R) Processor. Playwright 1.65.1, browser channel `chromium`, CDP HeadlessChrome/159.0.8154.6.

| Variant | Role | Samples | Successes | Success rate | Avg ms | p95 ms | Avg attempts | Failure categories |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| flake-no-retry | baseline | 12 | 9 | 75% | 119.3 | 126 | 1 | upstream_error 3 |
| flake-retry | improved | 12 | 12 | 100% | 119.3 | 124 | 1.25 | — |
| overload-bounded | improved | 6 | 6 | 100% | 1837.2 | 1841 | 1 | — |
| overload-burst | baseline | 6 | 2 | 33.3% | 2205 | 2527 | 1 | selector_timeout 4 |
| overload-retry | baseline | 6 | 2 | 33.3% | 2204.2 | 2521 | 2.33 | selector_timeout 4 |
| ratelimit-burst | baseline | 6 | 2 | 33.3% | 66.3 | 77 | 1 | http_429 4 |
| ratelimit-paced | improved | 4 | 4 | 100% | 29 | 31 | 1 | — |
| short-timeout | baseline | 6 | 0 | 0% | 409 | 411 | 4 | selector_timeout 6 |
| sufficient-timeout | improved | 6 | 6 | 100% | 1330.8 | 1348 | 1 | — |
<!-- /bench:case-c -->

## Limits

The overload result depends on the six fetches overlapping while two are held for 1500ms. If the machine staggers them more than that, more than two can take the fast path. That is reported, not smoothed. The flake counter is process-local and reset between batches. It is not a model of a remote origin's failure process, only of "the next attempt is a new request".

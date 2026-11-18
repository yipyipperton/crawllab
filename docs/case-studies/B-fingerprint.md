---
title: Two browser configs, one webdriver bit
summary: A local page records navigator, screen, WebGL, CDP, and request headers. Changing the user agent, locale, timezone, and viewport does not clear navigator.webdriver.
---

## Problem

People compare a stock Playwright context with a context that sets a different user agent and then talk about the two as if every signal moved. Most do not. This case records both, on a page that does not block, hide, or score the visitor.

## Reproduction

Fixture: `GET /pages/fingerprint`.

The page's table names each signal, the API that produces it, and why it is on the page. After `fetch('/api/echo-headers')` it writes JSON into `#fp-json` and sets `data-ready`. The engine also collects the same family of values itself, including `Browser.getVersion` from a browser CDP session, and stores that object. The diff uses the engine object.

Configs, in `src/engine/configs.ts`:

- `stock-headless`: Playwright defaults, 1280×720, `en-US`, `America/New_York`.
- `custom-ua-viewport`: user agent `CrawlLabResearch/1.0 (config=custom-ua) Chrome/131.0.0.0`, 1920×1080, `de-DE`, `Europe/Berlin`.

Four runs of each. No init script. No stealth plugin.

## Evidence

The results section is the diff of the latest observation of each config, plus the `webdriver` value on both. Signals that do not appear in the diff were equal in this run. The fingerprint page source documents the read for each row.

CDP is the browser-level `Browser.getVersion` product, protocol version, user agent, and JavaScript version. It is cached on the pool for the life of that browser process.

## Cause

Playwright's context options change the user agent, locale, timezone, and viewport because those are context settings. `navigator.webdriver` is set by Chromium under automation. This project never assigns it.

## What we changed

Nothing about the browser fingerprint. The engineering output is the diff and the decision not to paper over the bit that stayed true. Collection is `src/fingerprint/collect.ts`. Comparison is a flat key diff in `src/fingerprint/compare.ts`.

## What did not work

Using the custom user agent as a stand-in for "not automated". The label is intentionally obvious, and the webdriver column is the check.

## Results

<!-- bench:case-b -->
Generated 2026-11-18T02:19:43.931Z by `npm run seed`. Node v22.23.4, linux 6.12.113+ x64, 4× Intel(R) Xeon(R) Processor. Playwright 1.65.1, browser channel `chromium`, CDP HeadlessChrome/159.0.8154.6.

| Variant | Role | Samples | Successes | Success rate | Avg ms | p95 ms | Avg attempts | Failure categories |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| custom-ua-viewport | research | 4 | 4 | 100% | 77.5 | 83 | 1 | — |
| stock-headless | research | 4 | 4 | 100% | 73.5 | 79 | 1 | — |

Signal diffs between the latest observation of each config:

- `headlessTokenInUa`: `false` → `true`
- `language`: `de-DE` → `en-US`
- `languages`: `de-DE` → `en-US`
- `requestHeaders.accept-language`: `de-DE` → `en-US`
- `requestHeaders.sec-ch-ua-platform`: `"Windows"` → `"Linux"`
- `requestHeaders.user-agent`: `CrawlLabResearch/1.0 (config=custom-ua) Chrome/131.0.0.0` → `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/159.0.8154.6 Safari/537.36`
- `screen.height`: `1080` → `720`
- `screen.width`: `1920` → `1280`
- `timezone`: `Europe/Berlin` → `America/New_York`
- `userAgent`: `CrawlLabResearch/1.0 (config=custom-ua) Chrome/131.0.0.0` → `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/159.0.8154.6 Safari/537.36`
- `viewport.innerHeight`: `1080` → `720`
- `viewport.innerWidth`: `1920` → `1280`

webdriver by config: {"stock-headless":true,"custom-ua-viewport":true}
sameWebdriver flag: true
<!-- /bench:case-b -->

The value before each arrow is `custom-ua-viewport`. The value after is `stock-headless`. `webdriver` is not in the list because both observations were `true`. On this machine the stock user agent contained `HeadlessChrome/159.0.8154.6`. The lab user agent removed that token. It also moved `sec-ch-ua-platform` from `Linux` to `Windows`, so the override changed a client hint and not only `navigator.userAgent`. It did not change `navigator.webdriver`.

## Limits

Headless only. A headed run was not part of this batch, so the table does not claim a headed difference. WebGL strings can change with the GPU; they are recorded, not treated as an access control. Client hints may or may not follow the user-agent override. The diff is the authority for this machine, not a general rule about Chrome.

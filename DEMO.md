# Demo script

This is the path to show a real failure, the evidence, a change in strategy, and the measured result. All of it stays on the local fixture server.

## Setup

```bash
npm install
npx playwright install chromium
npm run seed
npm run dev
```

Dashboard: [http://127.0.0.1:43125](http://127.0.0.1:43125)

The seed has already stored the batch numbers. The steps below add two live runs on top of that.

## 1. Fail the extraction

On Overview, open **Run a preset** and choose **DOMContentLoaded, then read**. Run it.

Open the new run.

What you should see:

- Status `failed`.
- Primary category `async_content_not_ready`, high confidence.
- Evidence that the page carried `data-crawllab-render=deferred` and that the wait strategy was `domcontentloaded`.
- The investigation says to wait for `#catalog`, not to retry the same load event. The seeded baseline batch is the proof: those runs set `retryOnMiss` and still fail, because the node is not in the document at DOMContentLoaded.

## 2. Change the readiness check

Run **Wait for #catalog**.

Open that run.

What you should see:

- Status `success`.
- Extracted text `Copper kettle, Field notebook, Brass compass`.
- Latency near the fixture's 1200ms timer, not a timeout.

## 3. Show a wait strategy that does not help

Run **Wait for networkidle**.

The run fails even though the extracted text is present. The category is `networkidle_false_timeout`. The network log contains repeated `/api/ping` requests. Retrying that wait spends the timeout again. The seeded `networkidle` row is the batch version of this.

## 4. Read the comparison

Open Experiments and find `case-a`.

`baseline-dcl` and `networkidle` are the failures. `selector-ready` and `json-api` are the two fixes: wait for the node, or call `GET /api/catalog` when you are allowed to. The JSON variant does not render the page.

Case C is the fleet batch: injected 500s, concurrency above the fixture's fast path, a timeout shorter than the render delay, and a 2-per-5-second rate limit. Read the success rates in the table. They were produced by `npm run seed` on the date in the case study. Do not expect a retry to fix the short timeout. That row stays at zero.

## 5. Fingerprints and the gate

Open Fingerprints. Both configs report `webdriver: true`. The diff is the user agent, locale, viewport, timezone, and request headers. The custom user agent is `CrawlLabResearch/1.0`. It is a lab label, not a disguise, and it does not clear `webdriver`.

Open Research. The sandbox table shows which mocked `navigator.webdriver` values reach `full`. Then open a **Gate, lab token** run. Chromium returns `PARTIAL_PAYLOAD_BETA`. The **expect full payload** preset fails with `access_challenge`. The project does not ship a script that deletes `webdriver`.

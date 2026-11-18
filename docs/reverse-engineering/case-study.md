---
title: Reading the lab gate without running it blind
summary: A minified fixture chooses teaser, partial, or full from a string table, a token, and navigator.webdriver. Static folding and a vm mock recover the table. Chromium only observes teaser and partial.
---

## Problem

The page `/pages/gate` loads `/js/gate.min.js` and writes one of three payloads into `#gate-result`. The file is one line. The readable source in `fixtures/js/gate.source.js` is the same program with whitespace. The exercise is to recover the branch conditions from the minified form and then check them, without changing Chromium's automation flags.

## Steps

1. `minifyJs` strips comments and collapses whitespace. The committed workflow analyzes that string, so a pretty copy is not required.
2. Acorn parses it as a script. The walker records string literals, array tables of literals, and function declarations whose body is exactly `return a + b`.
3. Calls to those functions with table indexes are folded. `cat(S[0], S[1])` becomes `webdriver`. `cat(S[2], S[3])` becomes `userAgent`. The token and the three payload names sit in the table as their own entries.
4. `if` statements are sliced from the minified source so the conditions can be read next to the folded names.
5. `simulateMatrix` runs the minified program in `node:vm` with a fake document and six navigator shapes: webdriver true, false, and absent, with and without `window.__LAB_UNLOCK__ = 'lab-unlock-7f3a'`.
6. Playwright loads the real page twice: once with no token, once with that assignment as an allowlisted init script. A third job asks for `#gate-result[data-mode="full"]` and is expected to fail.

Regenerate the tool output with `npm run analyze:gate`. The dashboard's Research page runs the same function.

## What the script is doing

`wd` is true only when `navigator["webdriver"] === true`. The token is compared to table entry 10. Both the token and a non-true webdriver value select `full`. The token and a true webdriver value select `partial`. Anything else is `teaser`. The teaser and partial branches set `data-crawllab-challenge="gate"` and a reason string. The script also reads plugins, language, viewport, `window.chrome`, and a WebGL vendor. Those values are stored on `window.__GATE_TRACE__` and do not select the mode.

The `absent` simulation matters: a missing property is not strictly `true`, so the mock takes `full` when the token is set. That is a description of the condition. The Chromium presets do not delete the property. `src/policy/lab-scripts.ts` rejects an init script that mentions webdriver.

## Evidence from the browser

Seeded runs under `case-re`:

- `gate-teaser` extracts `TEASER_ONLY`.
- `gate-partial` extracts `PARTIAL_PAYLOAD_BETA`.
- `gate-expect-full` fails. The primary finding is `access_challenge` because the fixture set the challenge attribute and the full-mode selector never appeared. Confidence is high that the marker was present. The finding tells the reader to stop there.

The integration test `shows teaser without a token and partial with the lab token` locks those three outcomes.

## What this does not do

It does not patch `Navigator.prototype`, set `navigator.webdriver` in the page, or route around the branch. The full payload appears only in the vm rows where the mock was constructed that way. A trace of `gate-expect-full` shows the partial or teaser text on the page and the job still failing its selector.

## Limits

Folding does not execute arbitrary expressions. A concatenator that is not `return a + b` is ignored and the report says so. The vm's WebGL object returns `MockVendor`. That string is not a claim about the host GPU. The browser confirmation is the teaser and partial strings above.

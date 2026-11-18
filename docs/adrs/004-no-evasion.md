# ADR 004: No evasion in the fingerprint lab

## Status

Accepted.

## Decision

The fingerprint page records signals. It does not branch the document on them and it does not ask the client to delete `navigator.webdriver`. The custom configuration changes the user-agent string, locale, timezone, and viewport. The user agent is `CrawlLabResearch/1.0`, so a reader can see that it is a lab value.

The gate fixture does branch. Its `full` payload requires a lab token and `navigator.webdriver` to be strictly `false`. That branch is executed in `node:vm` with a mock. The Chromium presets are teaser (no token), partial (token, real webdriver), and an expected failure when the job demands `data-mode=full`. Init scripts are an allowlist of one assignment, rejected if they contain the word `webdriver`, and rejected off loopback.

## Consequences

A comparison that only changes the user agent still shows `webdriver: true` on both sides when Chromium reports it. The research report is allowed to say that the strict equality would take another branch if the property were absent. It is not allowed to do that in the browser.

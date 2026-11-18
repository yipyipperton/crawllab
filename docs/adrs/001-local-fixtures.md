# ADR 001: Local fixtures are the default target

## Status

Accepted.

## Decision

Presets navigate only to the in-process fixture server. A URL is fetched only when the host is allowlisted. With `ALLOW_EXTERNAL` unset, the host must also be loopback. robots.txt is fetched first and a disallow skips navigation entirely. A failed robots fetch fails closed.

## Why

The lab has to be runnable offline, deterministic enough to write down, and safe to point at a network. The failure modes we care about (late render, heartbeat, 429, 500, redirect, missing node) can all be produced by a server we own.

## Consequences

Numbers in the case studies describe the fixture, not the public web. Reproducing them does not require credentials or a third-party site.

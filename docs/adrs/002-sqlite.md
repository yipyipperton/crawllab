# ADR 002: SQLite through node:sqlite

## Status

Accepted.

## Decision

Runs, fingerprint observations, experiment notes, and seed metadata live in one SQLite file opened with `node:sqlite` `DatabaseSync`. The schema is created on open. WAL and a busy timeout are set.

## Why

The lab is a single node. A native addon such as `better-sqlite3` would add a compile step the Playwright image does not need. The dataset is the seed plus a few interactive runs, so synchronous queries on the API thread are acceptable.

## Consequences

`node:sqlite` is still marked experimental on Node 22 and prints a warning. Node 22 is the minimum in `package.json`. Aggregates are computed in process from the run rows so a dashboard number can be traced to those rows.

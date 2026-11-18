# ADR 003: Diagnostic confidence

## Status

Accepted.

## Decision

Every finding has `high`, `medium`, or `low` confidence. `high` means the observation contains the fact the sentence uses: an HTTP status, a timeout message, a DOM marker the page itself set, a robots decision, a count of heartbeat requests. `medium` means two facts are both present and the report is connecting them, as with a page error and a missing node. The report says that the connection is not proven.

The primary category is chosen from a fixed priority list of failure findings. Warnings do not fail a run. `objectiveMet` is separate: a timeout fails the objective even if the selector is discovered afterwards, which is how `networkidle` becomes a false failure instead of a slow success.

## Consequences

The UI can show more than one finding. The category used in the charts is the primary one, not a guess layered on top.

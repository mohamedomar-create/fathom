# Import performance

- Parsing runs in a web worker; the page stays interactive and shows progress.
- Large files go to private storage with resumable upload; stock and large line imports are background jobs (0014,
  pg_cron) with a state machine and progress, safe to retry (staged chunks stored once by digest, 0035).
- Saves are chunked and resumable; a failed chunk is split and retried; nothing switches live until every chunk arrived.
- Background jobs do nothing when there is no work (0055).
- Measured budgets live in `tests/e2e-auth/speed.spec.ts` (page load) and `payload.spec.ts` (download size).
- Open: one shared chunked uploader for every upload kind.

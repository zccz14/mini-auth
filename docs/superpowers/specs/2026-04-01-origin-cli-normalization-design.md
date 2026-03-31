# origin CLI normalization Design

## Context

- `mini-auth start` uses `cac` for CLI parsing and `zod` for runtime config validation.
- `--origin` is documented as required and repeatable.
- When `--origin` is passed once, `cac` returns a string; when passed multiple times, it returns a string array.
- `parseRuntimeConfig()` currently accepts only an array for `origin`, so single-origin startup fails before the server starts.

## Decision

- Normalize `options.origin` in the CLI layer before calling `runStartCommand()`.
- Preserve the existing runtime config contract: downstream code continues to receive `origin` as an array.
- Add a regression test that proves a single CLI-style `origin` value is accepted and converted into a one-item `origins` array.

## Rationale

- The mismatch originates at the CLI boundary, so normalizing there keeps responsibilities clear.
- This is the smallest change that fixes real user input without broadening shared config parsing beyond current needs.
- Existing multi-origin behavior remains unchanged.

## Testing

- Add a unit test for `parseRuntimeConfig()` with a single string `origin`.
- Run the targeted unit test file.
- Re-run the local start command with one `--origin` flag to confirm startup no longer errors.

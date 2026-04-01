# nodemailer email delivery Design

## Context

- `POST /email/start` currently selects an SMTP config from SQLite and sends OTP mail through a handwritten SMTP socket client.
- The current runtime SMTP implementation only supports a narrow command flow and does not implement `STARTTLS`, broader auth negotiation, or the transport hardening already solved by mature libraries.
- This creates real delivery risk for common provider setups such as port `587` with opportunistic TLS.

## Decision

- Replace the handwritten runtime SMTP delivery path with `nodemailer`.
- Remove the custom runtime SMTP abstraction from the application boundary; email OTP flow will no longer receive an injected SMTP transport.
- Keep SMTP implementation details inside `src/infra/smtp/mailer.ts`, but make that module a thin nodemailer-backed sender rather than a protocol implementation or compatibility layer.
- Keep the existing `smtp_configs` table, CLI import format, route contracts, and error codes unchanged.

## Rationale

- Email delivery is a commodity integration; maintaining our own SMTP protocol implementation adds risk without product value.
- `nodemailer` provides mature support for common provider behavior including `STARTTLS`, authentication handling, and transport-level error reporting.
- Keeping the database and HTTP contracts stable limits migration risk while fixing the real compatibility problem.

## Architecture

- `src/modules/email-auth/service.ts` keeps the business flow for OTP issuance, config lookup, and error handling, and continues to call infra helpers for actual email delivery.
- `SmtpTransport` is removed from both `createApp()` and `startEmailAuth()` signatures.
- SMTP config selection continues to read from `smtp_configs`; active filtering and weighted selection semantics remain unchanged.
- `src/infra/smtp/mailer.ts` owns nodemailer transport creation and `sendMail` invocation.
- Nodemailer transport creation stays entirely inside `src/infra/smtp/mailer.ts`; the rest of the app only calls exported mailer functions.
- The chosen row is translated into a nodemailer transport config when sending.
- The runtime uses a non-pooled nodemailer transporter created per send attempt; startup does not create or cache SMTP transport state.
- Field mapping is direct: `host -> host`, `port -> port`, `username/password -> auth.user/auth.pass`, `secure -> secure`, `connectionTimeout -> 10000`, `greetingTimeout -> 10000`, `socketTimeout -> 10000`; `from_email` and `from_name` continue to shape the outgoing `from` header only. No schema changes and no extra compatibility layer are added.
- `src/server/app.ts` stops threading a runtime SMTP transport through app state.
- `src/cli/start.ts` no longer constructs a custom SMTP client during startup.
- Testing keeps route-level coverage for success, no-config, and delivery-failure paths by module-mocking the exported mailer send function from `src/infra/smtp/mailer.ts`, without reintroducing runtime transport injection.

## Behavioral Rules

- If no active SMTP config exists, `POST /email/start` still returns `503 smtp_not_configured`.
- Explicit nodemailer timeouts are part of the runtime transport config so `/email/start` does not hang indefinitely; timeout failures map to `503 smtp_temporarily_unavailable`.
- Any nodemailer or runtime SMTP failure after config selection, including transporter creation, connection, TLS/auth negotiation, timeout, or `sendMail` rejection, invalidates the pending OTP and returns `503 smtp_temporarily_unavailable`.
- Delivery counts as success only when nodemailer reports the target recipient in `accepted`, with the target absent from `rejected`; empty `accepted` or partial acceptance is treated as `503 smtp_temporarily_unavailable`.
- `secure: true` continues to mean implicit TLS.
- `secure: false` is delegated to nodemailer so standard SMTP submission setups can use plain connection plus `STARTTLS` upgrade when available.

## Rollback

- Rollback is `git revert` of the nodemailer migration change set; no schema, CLI, or API rollback steps are required because those contracts remain unchanged.

## Testing

- Update the existing email auth tests to cover the unchanged route behavior after the nodemailer migration.
- Add focused tests around the nodemailer-backed send path only where needed to verify config mapping and failure handling.
- Run targeted email auth tests plus the broader test suite sections touched by startup wiring.

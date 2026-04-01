# nodemailer email delivery Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the handwritten runtime SMTP sender with `nodemailer` while keeping the SQLite schema, CLI input, route contracts, and HTTP error codes unchanged.

**Architecture:** Keep SMTP config lookup and weighted selection semantics unchanged, but move actual delivery to a nodemailer-backed helper in `src/infra/smtp/mailer.ts`. Remove SMTP transport injection from app startup and tests, then switch route tests to module-mock the mailer send function so the business flow remains covered without a reusable transport abstraction.

**Tech Stack:** TypeScript, Node.js, nodemailer, Hono, SQLite, Vitest

---

## File Structure

- Modify: `package.json` - add `nodemailer` runtime dependency
- Modify: `package-lock.json` - record the new runtime dependency
- Modify: `src/infra/smtp/mailer.ts` - remove socket-level SMTP implementation, add nodemailer-backed send helper and timeout config
- Modify: `src/modules/email-auth/service.ts` - stop accepting injected SMTP transport and call the mailer helper directly
- Modify: `src/server/app.ts` - remove SMTP transport from app variables and `/email/start` wiring
- Modify: `src/cli/start.ts` - remove runtime SMTP client creation during startup
- Modify: `tests/helpers/app.ts` - stop creating/injecting mock SMTP transports and keep only DB/bootstrap wiring
- Modify: `tests/helpers/mock-smtp.ts` - add a shared mocked mail-delivery seam usable from integration tests without app-state injection
- Modify: `tests/integration/email-auth.test.ts` - switch route tests to the shared mocked mail-delivery seam
- Modify: `tests/integration/sessions.test.ts` - switch `createSignedInApp()` OTP extraction to the shared mocked mail-delivery seam while keeping runtime SMTP tests real
- Modify: `tests/integration/webauthn.test.ts` - switch sign-in helper OTP extraction to the shared mocked mail-delivery seam
- Create: `tests/unit/smtp-mailer.test.ts` - focused coverage for nodemailer config mapping and success/failure semantics

## Chunk 1: Lock nodemailer Delivery Semantics With Failing Tests

### Task 1: Add failing mailer tests for nodemailer-backed sending

**Files:**

- Create: `tests/unit/smtp-mailer.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Add focused tests for `src/infra/smtp/mailer.ts` that mock `nodemailer` and verify:

- transport config maps `host`, `port`, `secure`, `auth.user`, `auth.pass`, and the three explicit timeout values
- `sendOtpMail()` succeeds only when the target recipient appears in `accepted` and not in `rejected`
- `sendOtpMail()` throws when `sendMail()` rejects or returns empty/partial acceptance

- [ ] **Step 2: Run the unit test to verify it fails**

Run: `npm test -- tests/unit/smtp-mailer.test.ts`
Expected: FAIL because the production mailer still uses the handwritten socket implementation and does not expose nodemailer acceptance semantics.

## Chunk 2: Replace Runtime SMTP Delivery

### Task 2: Add nodemailer as the runtime sender

**Files:**

- Modify: `package.json`
- Modify: `src/infra/smtp/mailer.ts`

- [ ] **Step 1: Add the dependency**

Add `nodemailer` to runtime dependencies in `package.json`.

- [ ] **Step 2: Replace the handwritten SMTP client with a nodemailer-backed helper**

In `src/infra/smtp/mailer.ts`:

- remove `SmtpTransport`
- remove `createRuntimeSmtpTransport()`
- remove the socket/TLS protocol helpers used only by the handwritten client
- keep `listSmtpConfigs()` and `selectSmtpConfig()` unchanged in behavior
- change `sendOtpMail()` to create a non-pooled nodemailer transport per send with:
  - `host: config.host`
  - `port: config.port`
  - `secure: config.secure`
  - `auth.user: config.username`
  - `auth.pass: config.password`
  - `connectionTimeout: 10000`
  - `greetingTimeout: 10000`
  - `socketTimeout: 10000`
- send the OTP email with the existing `from`, `to`, `subject`, and `text`
- treat success as: recipient email is present in `info.accepted` and absent from `info.rejected`
- throw on transporter creation failure, `sendMail()` rejection, or empty/partial acceptance

- [ ] **Step 3: Run the unit mailer tests**

Run: `npm test -- tests/unit/smtp-mailer.test.ts`
Expected: PASS.

## Chunk 3: Replace Integration Test Seams Without App Injection

### Task 3: Move OTP test capture to a shared mocked mail-delivery seam

**Files:**

- Modify: `tests/helpers/app.ts`
- Modify: `tests/helpers/mock-smtp.ts`
- Modify: `tests/integration/email-auth.test.ts`
- Modify: `tests/integration/sessions.test.ts`
- Modify: `tests/integration/webauthn.test.ts`

- [ ] **Step 1: Add a reusable test seam for OTP mail capture**

Update `tests/helpers/mock-smtp.ts` to expose a shared mailbox/failure controller that can back a module-mocked `sendOtpMail()` function without depending on `createApp()` injection.

- [ ] **Step 2: Remove SMTP transport injection from the app helper**

Remove mock SMTP transport creation and the `mailbox` / `failNextMail` API from `tests/helpers/app.ts`, leaving database setup, SMTP config inserts, key bootstrap, and app creation only.

- [ ] **Step 3: Update integration tests to use the shared mocked seam**

In `tests/integration/email-auth.test.ts`, `tests/integration/sessions.test.ts`, and `tests/integration/webauthn.test.ts`:

- module-mock the exported mailer send function from `src/infra/smtp/mailer.ts`
- use the shared mailbox helper to capture OTP emails for `/email/verify` flows
- use the shared failure helper to trigger `smtp_temporarily_unavailable`
- leave runtime SMTP tests in `tests/integration/sessions.test.ts` unmocked so they still exercise the real nodemailer transport against the mock SMTP server

- [ ] **Step 4: Run the affected integration tests**

Run: `npm test -- tests/integration/email-auth.test.ts`
Expected: PASS for route behavior and OTP extraction using the new mocked mail seam.

Run: `npm test -- tests/integration/sessions.test.ts tests/integration/webauthn.test.ts`
Expected: PASS, including helper-driven sign-in flows and real runtime SMTP integration.

## Chunk 4: Remove SMTP Injection From App Wiring

### Task 4: Delete obsolete runtime transport plumbing

**Files:**

- Modify: `src/modules/email-auth/service.ts`
- Modify: `src/server/app.ts`
- Modify: `src/cli/start.ts`

- [ ] **Step 1: Remove SMTP transport from the email auth service signature**

Change `startEmailAuth()` to accept only `{ email }`, keep config lookup in place, and call the exported mailer send helper directly.

- [ ] **Step 2: Remove SMTP app-state wiring**

In `src/server/app.ts`:

- remove the `smtpTransport` app variable
- remove the fallback failing transport helper
- update `/email/start` to call `startEmailAuth(c.var.db, { email: body.email })`

- [ ] **Step 3: Remove startup transport creation**

In `src/cli/start.ts`, remove the `createRuntimeSmtpTransport()` import and stop passing `smtpTransport` into `createApp()`.

- [ ] **Step 4: Run tests for the touched paths**

Run: `npm test -- tests/integration/email-auth.test.ts tests/integration/sessions.test.ts`
Expected: PASS, confirming the email flow still mints OTPs and downstream session behavior is unaffected.

## Chunk 5: Final Verification

### Task 5: Verify the migration end to end

**Files:**

- Modify: none expected

- [ ] **Step 1: Install dependencies if needed**

Run: `npm install`
Expected: lockfile and dependency tree include `nodemailer`.

- [ ] **Step 2: Run the relevant automated checks**

Run: `npm test -- tests/integration/email-auth.test.ts tests/integration/sessions.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Build the CLI**

Run: `npm run build`
Expected: PASS and `dist/` updates compile cleanly.

- [ ] **Step 4: Manually verify the original failure mode**

Run the local server against a DB containing a real SMTP config and call `POST /email/start`.
Expected: providers that require standard submission behavior such as `STARTTLS` on port `587` no longer fail because of the handwritten SMTP implementation.

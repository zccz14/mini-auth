# origin CLI normalization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `mini-auth start` accept a single `--origin` flag without requiring the user to repeat it.

**Architecture:** Keep runtime config consumers unchanged by normalizing CLI input at the `cac` boundary. Add one regression test that models the single-value case, then apply the minimal normalization in the `start` command action.

**Tech Stack:** TypeScript, Node.js, cac, zod, Vitest

---

## File Structure

- Modify: `tests/unit/shared.test.ts` - add regression coverage for a single `origin` string input
- Modify: `src/index.ts` - normalize CLI `origin` input to a string array before calling `runStartCommand()`

## Chunk 1: Regression Test

### Task 1: Cover single-origin CLI input

**Files:**

- Modify: `tests/unit/shared.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test that calls `parseRuntimeConfig()` with `origin: 'http://localhost:5173'` and expects `origins: ['http://localhost:5173']`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/shared.test.ts`
Expected: FAIL because `origin` is a string, not an array.

## Chunk 2: Minimal Fix

### Task 2: Normalize single origin values

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Write minimal implementation**

Convert `options.origin` so that:

- `undefined` stays `undefined`
- a string becomes `[string]`
- an array stays unchanged

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test -- tests/unit/shared.test.ts`
Expected: PASS.

- [ ] **Step 3: Verify with CLI reproduction**

Run: `node dist/index.js start test.sqlite --issuer http://localhost:7777 --rp-id localhost --origin http://localhost:5173`
Expected: no validation error about `origin`; process stays running until stopped.

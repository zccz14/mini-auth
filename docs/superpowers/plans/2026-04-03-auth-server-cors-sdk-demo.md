# Auth Server CORS for SDK and Demo Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Auth Server 增加与 `--origin` 严格一致的 CORS 支持，让 singleton browser SDK 与 demo 可以直接跨域使用且不再依赖 proxy。

**Architecture:** 在 `src/server/app.ts` 的全局 middleware / error 边界层统一施加 CORS 与 preflight 处理，保证所有浏览器可见路由（包括 `/sdk/singleton-iife.js` 与错误响应）都有一致的 header 行为。SDK 的 script-origin 推导合同保持不变，只更新文档与 demo，将浏览器主路径从 same-origin proxy 切换为 direct cross-origin usage。

**Tech Stack:** TypeScript, Hono, Vitest, browser singleton SDK, README/demo static assets

---

## Chunk 1: Server CORS contract

### Task 1: Add failing integration coverage for CORS headers and preflight

**Files:**

- Create: `tests/integration/cors.test.ts`
- Modify: `tests/helpers/app.ts`
- Reference: `docs/superpowers/specs/2026-04-03-auth-server-cors-sdk-demo-design.md`

- [ ] **Step 1: Extend the test helper so origin lists are configurable**

```ts
type CreateTestAppOptions = {
  origins?: string[];
  // existing options...
};

const app = createApp({
  // ...
  origins: options.origins ?? ['https://app.example.com'],
});
```

- [ ] **Step 2: Write the failing tests for allowed-origin API responses**

```ts
it('returns Access-Control-Allow-Origin for allowed origins', async () => {
  const testApp = await createTestApp({
    origins: ['http://localhost:8080'],
  });

  const response = await testApp.app.request('/jwks', {
    headers: { origin: 'http://localhost:8080' },
  });

  expect(response.headers.get('access-control-allow-origin')).toBe(
    'http://localhost:8080',
  );
  expect(response.headers.get('vary')).toContain('Origin');
});
```

- [ ] **Step 3: Run the targeted CORS tests to verify they fail**

Run: `npm test -- tests/integration/cors.test.ts`
Expected: FAIL because the file is new and the app does not emit the expected CORS headers yet.

- [ ] **Step 4: Add the remaining failing tests in the same file**

Use the same `const testApp = await createTestApp({ origins: ['http://localhost:8080'] });` setup pattern as Step 2 for the remaining cases.

```ts
it('does not emit allow headers for disallowed origins', async () => {
  const testApp = await createTestApp({
    origins: ['http://localhost:8080'],
  });
  const response = await testApp.app.request('/jwks', {
    headers: { origin: 'http://evil.example' },
  });

  expect(response.headers.get('access-control-allow-origin')).toBeNull();
});

it('handles allowed-origin preflight globally', async () => {
  const testApp = await createTestApp({
    origins: ['http://localhost:8080'],
  });
  const response = await testApp.app.request('/session/logout', {
    method: 'OPTIONS',
    headers: {
      origin: 'http://localhost:8080',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization, content-type',
    },
  });

  expect(response.status).toBe(204);
  expect(response.headers.get('access-control-allow-methods')).toContain(
    'POST',
  );
  expect(response.headers.get('access-control-allow-headers')).toContain(
    'Authorization',
  );
});

it('does not emit allow headers for disallowed-origin preflight', async () => {
  const testApp = await createTestApp({
    origins: ['http://localhost:8080'],
  });
  const response = await testApp.app.request('/session/logout', {
    method: 'OPTIONS',
    headers: {
      origin: 'http://evil.example',
      'access-control-request-method': 'POST',
    },
  });

  expect(response.headers.get('access-control-allow-origin')).toBeNull();
});

it('keeps CORS headers on error responses for allowed origins', async () => {
  const testApp = await createTestApp({
    origins: ['http://localhost:8080'],
  });
  const response = await testApp.app.request('/email/start', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:8080',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email: '' }),
  });

  expect(response.status).toBe(400);
  expect(response.headers.get('access-control-allow-origin')).toBe(
    'http://localhost:8080',
  );
});
```

- [ ] **Step 5: Implement minimal app-level CORS handling**

```ts
const CORS_METHODS = 'GET, POST, DELETE, OPTIONS';
const CORS_HEADERS = 'Authorization, Content-Type';

app.use(async (c, next) => {
  const origin = c.req.header('origin');
  const allowedOrigin =
    origin && input.origins.includes(origin) ? origin : null;

  if (c.req.method === 'OPTIONS') {
    const headers = new Headers();

    if (allowedOrigin) {
      headers.set('Access-Control-Allow-Origin', allowedOrigin);
      headers.set('Access-Control-Allow-Methods', CORS_METHODS);
      headers.set('Access-Control-Allow-Headers', CORS_HEADERS);
      headers.append('Vary', 'Origin');
    }

    return new Response(null, { status: 204, headers });
  }

  await next();

  if (allowedOrigin) {
    c.res.headers.set('Access-Control-Allow-Origin', allowedOrigin);
    c.res.headers.append('Vary', 'Origin');
  }
});
```

- [ ] **Step 6: Ensure the error path also carries CORS headers**

```ts
function applyCorsHeaders(response: Response, origin: string | null): Response {
  if (!origin) {
    return response;
  }

  response.headers.set('Access-Control-Allow-Origin', origin);
  response.headers.append('Vary', 'Origin');
  return response;
}
```

- [ ] **Step 7: Re-run the targeted CORS tests to verify they pass**

Run: `npm test -- tests/integration/cors.test.ts`
Expected: PASS with coverage for allowed origins, disallowed origins, preflight, and error responses.

- [ ] **Step 8: Commit the server CORS slice**

```bash
git add tests/integration/cors.test.ts tests/helpers/app.ts src/server/app.ts
git commit -m "feat: add auth server cors responses"
```

### Task 2: Update existing SDK endpoint coverage to match the new browser contract

**Files:**

- Modify: `tests/integration/sdk-endpoint.test.ts`
- Modify: `src/sdk/singleton-entry.ts`
- Reference: `src/server/app.ts`

- [ ] **Step 1: Write the failing endpoint assertions for CORS-aware SDK serving**

```ts
it('serves the sdk endpoint with CORS headers for allowed origins', async () => {
  const testApp = await createTestApp();
  const response = await testApp.app.request('/sdk/singleton-iife.js', {
    headers: { origin: 'https://app.example.com' },
  });

  expect(response.headers.get('access-control-allow-origin')).toBe(
    'https://app.example.com',
  );
});

it('documents cross-origin usage instead of same-origin-only usage', async () => {
  const testApp = await createTestApp();
  const response = await testApp.app.request('/sdk/singleton-iife.js');
  const body = await response.text();

  expect(body).not.toContain('same-origin only');
});
```

- [ ] **Step 2: Run the targeted SDK endpoint tests to verify the new assertions fail**

Run: `npm test -- tests/integration/sdk-endpoint.test.ts`
Expected: FAIL until the served source text and headers reflect the new contract.

- [ ] **Step 3: Update the served-source contract text minimally**

```ts
function installOnWindow(window, document) {
  window.MiniAuth = bootstrapSingletonSdk({
    currentScript: document.currentScript,
    fetch: resolveFetch(window.fetch?.bind(window)),
  }).sdk;
  /* v1 supports cross-origin pages when the page origin is allowed by --origin. */
}
```

- [ ] **Step 4: Re-run the targeted SDK endpoint tests to verify they pass**

Run: `npm test -- tests/integration/sdk-endpoint.test.ts`
Expected: PASS with the new header and source-string expectations.

- [ ] **Step 5: Commit the SDK endpoint coverage slice**

```bash
git add tests/integration/sdk-endpoint.test.ts src/sdk/singleton-entry.ts
git commit -m "test: cover sdk endpoint cors contract"
```

## Chunk 2: Demo and documentation contract

### Task 3: Update demo setup inference and guidance with test-first changes

**Files:**

- Modify: `demo/setup.js`
- Modify: `demo/main.js`
- Modify: `demo/index.html`
- Test: `tests/unit/demo-setup.test.ts`
- Reference: `docs/superpowers/specs/2026-04-03-auth-server-cors-sdk-demo-design.md`

- [ ] **Step 1: Write the failing demo-setup tests for direct-origin guidance**

```ts
it('derives the auth server origin recommendation from window.location.origin', () => {
  expect(
    getDemoSetupState({
      href: 'http://localhost:8080/index.html',
      origin: 'http://localhost:8080',
      protocol: 'http:',
      hostname: 'localhost',
    }),
  ).toEqual(
    expect.objectContaining({
      currentOrigin: 'http://localhost:8080',
      suggestedOrigin: 'http://localhost:8080',
    }),
  );
});

it('does not return a proxy command anymore', () => {
  expect(
    getDemoSetupState({
      href: 'http://localhost:8080/index.html',
      origin: 'http://localhost:8080',
      protocol: 'http:',
      hostname: 'localhost',
    }),
  ).not.toHaveProperty('proxyCommand');
});
```

- [ ] **Step 2: Run the targeted demo setup tests to verify they fail**

Run: `npm test -- tests/unit/demo-setup.test.ts`
Expected: FAIL because the helper still returns proxy guidance and does not lock the contract around the current origin language.

- [ ] **Step 3: Update the helper to expose only the new direct-cross-origin guidance**

```ts
export function getDemoSetupState(locationLike) {
  const currentOrigin = locationLike.origin;

  return {
    currentOrigin,
    currentRpId: hostname,
    suggestedOrigin: webauthnReady ? currentOrigin : localhostOrigin,
    suggestedRpId: webauthnReady ? hostname : 'localhost',
    warning,
  };
}
```

- [ ] **Step 4: Update the HTML to stop hard-coding the proxy SDK path**

```html
<script src="http://127.0.0.1:7777/sdk/singleton-iife.js"></script>
```

- [ ] **Step 5: Update the demo UI copy and runtime wiring to remove proxy language**

```html
<p>
  Load this page from any static server, then start mini-auth on another origin
  with <code>--origin</code> set to the current page origin shown below.
</p>
```

```js
elements.baseUrl.value =
  document.querySelector('script[src*="/sdk/singleton-iife.js"]')?.src ??
  'http://127.0.0.1:7777/sdk/singleton-iife.js';

elements.setupWarning.textContent =
  'Serve this page from any static host, then start mini-auth with --origin set to the current page origin.';

elements.originCommand.textContent = `mini-auth start ./mini-auth.sqlite --origin ${setupState.suggestedOrigin} --rp-id ${setupState.suggestedRpId}`;
```

- [ ] **Step 6: Remove proxy-only DOM wiring and stale SDK error wording**

```js
elements.setupWarning.textContent =
  'MiniAuth SDK did not load. Point the page at an auth server SDK URL and make sure that server was started with --origin matching this page origin.';

// Remove proxyCommand reads and rendering.
```

- [ ] **Step 7: Manually verify the touched demo files no longer encode proxy assumptions**

Run: `rg -n "/api/sdk/singleton-iife.js|proxy|same-origin proxy" demo`
Expected: no matches in `demo/index.html`, `demo/main.js`, or `demo/setup.js` for the old proxy-specific contract.

- [ ] **Step 8: Re-run the targeted demo setup tests to verify they pass**

Run: `npm test -- tests/unit/demo-setup.test.ts`
Expected: PASS with direct-origin guidance and no proxy contract remaining.

- [ ] **Step 9: Commit the demo guidance slice**

```bash
git add demo/setup.js demo/main.js demo/index.html tests/unit/demo-setup.test.ts
git commit -m "feat: update demo for direct cors usage"
```

### Task 4: Update README browser SDK guidance and verify the touched suite

**Files:**

- Modify: `README.md`
- Test: `tests/integration/cors.test.ts`
- Test: `tests/integration/sdk-endpoint.test.ts`
- Test: `tests/unit/demo-setup.test.ts`

- [ ] **Step 1: Write the documentation changes that replace same-origin-only guidance**

```md
mini-auth now supports cross-origin browser apps when the page origin is listed
in `--origin`. The SDK script and API still come from the same auth server
origin, and the singleton SDK continues to infer its base URL from the script
URL.
```

- [ ] **Step 2: Add a cross-origin example**

```html
<script src="http://127.0.0.1:7777/sdk/singleton-iife.js"></script>
```

```bash
npx mini-auth start ./mini-auth.sqlite \
  --issuer http://127.0.0.1:7777 \
  --rp-id localhost \
  --origin http://localhost:8080
```

- [ ] **Step 3: Run the touched verification suite**

Run: `npm test -- tests/integration/cors.test.ts tests/integration/sdk-endpoint.test.ts tests/unit/demo-setup.test.ts`
Expected: PASS for all targeted browser-contract tests.

- [ ] **Step 4: Run a direct cross-origin smoke test**

Run: start a static server for `demo/` on `http://localhost:8080`, start mini-auth on `http://127.0.0.1:7777` with `--origin http://localhost:8080`, open the demo page, and confirm the page loads `http://127.0.0.1:7777/sdk/singleton-iife.js` plus at least one successful browser request such as `POST /email/start` or `GET /jwks`.
Expected: PASS with no proxy in the path and no browser CORS failure for the allowed origin.

- [ ] **Step 5: Run the broader repository verification commands**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: PASS with no new test, type, lint, or build regressions.

- [ ] **Step 6: Commit the documentation and final verification slice**

```bash
git add README.md
git commit -m "docs: add cors browser integration guidance"
```

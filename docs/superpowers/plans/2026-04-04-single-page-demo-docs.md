# mini-auth Single-Page Demo / Docs Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有 `demo/` 升级为单页长文站点，同时承担 mini-auth 的项目介绍、交互 demo、接入说明、API Reference、后端 JWT 集成与静态部署说明，并保持 `sdk-origin` 与页面 origin 的现有运行合同。

**Architecture:** 把 demo 拆成三个明确职责的前端模块：`demo/setup.js` 只负责输入规范化与派生运行时配置，`demo/content.js` 负责生成文档内容、代码片段、API Reference 与部署说明数据，`demo/main.js` 负责 DOM 渲染、SDK 动态加载、表单交互与失败降级。页面仍然是纯静态 HTML/CSS/JS，但所有命令、snippet、JWT 示例与 playground runtime 都从同一份 `sdk-origin + window.location.origin` 派生状态生成。

**Tech Stack:** HTML, CSS, browser JavaScript modules, singleton browser SDK, Vitest, GitHub Pages-compatible static assets

---

## Chunk 1: Shared state and content contracts

### Task 1: Make `demo/setup.js` the runtime-config authority

**Files:**

- Modify: `demo/setup.js`
- Modify: `tests/unit/demo-setup.test.ts`
- Reference: `docs/superpowers/specs/2026-04-04-single-page-demo-docs-design.md`

- [ ] **Step 1: Add failing tests for normalized config derivation**

```ts
it('derives page origin, sdk origin, issuer, jwks, and rp id from allowed inputs', () => {
  expect(
    getDemoSetupState({
      origin: 'https://docs.example.com',
      protocol: 'https:',
      hostname: 'docs.example.com',
      sdkOriginInput: 'https://auth.example.com',
    }),
  ).toEqual(
    expect.objectContaining({
      currentOrigin: 'https://docs.example.com',
      suggestedOrigin: 'https://docs.example.com',
      sdkOrigin: 'https://auth.example.com',
      sdkScriptUrl: 'https://auth.example.com/sdk/singleton-iife.js',
      issuer: 'https://auth.example.com',
      jwksUrl: 'https://auth.example.com/jwks',
      suggestedRpId: 'auth.example.com',
    }),
  );
});

it('rejects sdk-origin values that are not origin-only', () => {
  expect(
    getDemoSetupState({
      origin: 'https://docs.example.com',
      protocol: 'https:',
      hostname: 'docs.example.com',
      sdkOriginInput: 'https://auth.example.com/path?bad=1',
    }),
  ).toEqual(
    expect.objectContaining({
      configError: expect.stringContaining('sdk-origin must be an origin'),
    }),
  );
});
```

- [ ] **Step 2: Run the setup tests to verify they fail**

Run: `npm test -- tests/unit/demo-setup.test.ts`
Expected: FAIL because the current helper does not expose the full normalized state or reject path/query input.

- [ ] **Step 3: Implement normalized runtime-config derivation in `demo/setup.js`**

```js
export function getDemoSetupState(locationLike) {
  const currentOrigin = locationLike.origin;
  const normalizedSdkOrigin = normalizeSdkOrigin(
    locationLike.sdkOriginInput ?? getOriginFromSdkUrl(locationLike.sdkUrl),
  );

  if (!normalizedSdkOrigin.ok) {
    return {
      currentOrigin,
      suggestedOrigin: currentOrigin,
      configError: normalizedSdkOrigin.error,
      sdkOrigin: '',
      sdkScriptUrl: '',
      issuer: '',
      jwksUrl: '',
      suggestedRpId: '',
      startupCommand: '',
      webauthnReady: false,
    };
  }

  const sdkOrigin = normalizedSdkOrigin.value;
  const suggestedRpId = new URL(sdkOrigin).hostname;

  return {
    currentOrigin,
    suggestedOrigin: currentOrigin,
    sdkOrigin,
    sdkScriptUrl: new URL('/sdk/singleton-iife.js', sdkOrigin).toString(),
    issuer: sdkOrigin,
    jwksUrl: new URL('/jwks', sdkOrigin).toString(),
    suggestedRpId,
    startupCommand: `mini-auth start ./mini-auth.sqlite --issuer ${sdkOrigin} --origin ${currentOrigin} --rp-id ${suggestedRpId}`,
  };
}
```

- [ ] **Step 4: Add the remaining failing tests for fallback/default behavior**

```ts
it('keeps ?sdk-origin as the only supported external config input', () => {
  const state = getDemoSetupState({
    origin: 'https://mini-auth.example.com',
    protocol: 'https:',
    hostname: 'mini-auth.example.com',
    sdkOriginInput: 'https://auth.example.com',
  });

  expect(state.sdkOrigin).toBe('https://auth.example.com');
  expect(state.issuer).toBe('https://auth.example.com');
});

it('falls back to the existing localhost sdk origin when no query param is present', () => {
  const state = getDemoSetupState({
    origin: 'http://localhost:8080',
    protocol: 'http:',
    hostname: 'localhost',
    sdkUrl: 'http://127.0.0.1:7777/sdk/singleton-iife.js',
  });

  expect(state.sdkOrigin).toBe('http://127.0.0.1:7777');
});
```

- [ ] **Step 5: Re-run the setup tests to verify they pass**

Run: `npm test -- tests/unit/demo-setup.test.ts`
Expected: PASS with origin-only parsing, RP ID derivation, and fallback behavior locked in.

- [ ] **Step 6: Commit the setup contract slice**

```bash
git add demo/setup.js tests/unit/demo-setup.test.ts
git commit -m "feat: expand single-page demo setup state"
```

### Task 2: Extract page-copy and reference builders into `demo/content.js`

**Files:**

- Create: `demo/content.js`
- Create: `tests/unit/demo-content.test.ts`
- Modify: `demo/setup.js`
- Reference: `demo/index.html`

- [ ] **Step 1: Write failing tests for shared content builders**

```ts
import { buildDemoContent } from '../../demo/content.js';

it('builds sdk script and jose snippets from the shared setup state', () => {
  const content = buildDemoContent({
    currentOrigin: 'https://docs.example.com',
    sdkOrigin: 'https://auth.example.com',
    sdkScriptUrl: 'https://auth.example.com/sdk/singleton-iife.js',
    issuer: 'https://auth.example.com',
    jwksUrl: 'https://auth.example.com/jwks',
    suggestedOrigin: 'https://docs.example.com',
    suggestedRpId: 'auth.example.com',
    startupCommand:
      'mini-auth start ./mini-auth.sqlite --issuer https://auth.example.com --origin https://docs.example.com --rp-id auth.example.com',
  });

  expect(content.sdkScriptTag).toContain(
    'https://auth.example.com/sdk/singleton-iife.js',
  );
  expect(content.joseSnippet).toContain("new URL('/jwks', issuer)");
  expect(content.joseSnippet).toContain(
    "const issuer = 'https://auth.example.com'",
  );
});

it('lists the required api reference endpoints', () => {
  const content = buildDemoContent(sampleState);

  const required = [
    'POST /email/start',
    'POST /email/verify',
    'POST /session/refresh',
    'GET /me',
    'POST /session/logout',
    'POST /webauthn/register/options',
    'POST /webauthn/register/verify',
    'POST /webauthn/authenticate/options',
    'POST /webauthn/authenticate/verify',
    'GET /jwks',
  ];

  for (const key of required) {
    const entry = content.apiReference.find(
      (candidate) => `${candidate.method} ${candidate.path}` === key,
    );

    expect(entry).toEqual(
      expect.objectContaining({
        when: expect.any(String),
        request: expect.any(String),
        response: expect.any(String),
      }),
    );
  }
});

it('updates api example base urls when sdk-origin changes', () => {
  const content = buildDemoContent({
    ...sampleState,
    sdkOrigin: 'https://staging-auth.example.com',
    issuer: 'https://staging-auth.example.com',
    jwksUrl: 'https://staging-auth.example.com/jwks',
    sdkScriptUrl: 'https://staging-auth.example.com/sdk/singleton-iife.js',
  });

  for (const entry of content.apiReference) {
    expect(entry.request).toContain('https://staging-auth.example.com');
  }
});
```

- [ ] **Step 2: Run the new content tests to verify they fail**

Run: `npm test -- tests/unit/demo-content.test.ts`
Expected: FAIL because there is no `demo/content.js` module yet.

- [ ] **Step 3: Implement `buildDemoContent()` with structured sections and snippets**

```js
export function buildDemoContent(setupState) {
  return {
    sdkScriptTag: `<script src="${setupState.sdkScriptUrl}"></script>`,
    hero: {
      title: 'mini-auth',
      valueProp:
        'A small, self-hosted auth server for apps that just need auth.',
      audience:
        'For teams that want email OTP, passkeys, JWTs, and SQLite without adopting a larger platform.',
      capabilities: [
        'email OTP',
        'passkey',
        'JWT',
        'JWKS',
        'SQLite',
        'self-hosted',
      ],
    },
    howItWorks: [
      'The page origin is the value you pass to mini-auth --origin.',
      'The sdk-origin is where the browser loads /sdk/singleton-iife.js.',
      'script origin == api origin: the singleton SDK always talks back to the auth server that served the script.',
      'WebAuthn and CORS both depend on the auth server being started with the right origin settings.',
    ],
    joseSnippet: [
      "import { createRemoteJWKSet, jwtVerify } from 'jose';",
      '',
      `const issuer = '${setupState.issuer}';`,
      "const jwks = createRemoteJWKSet(new URL('/jwks', issuer));",
      '// Validate aud when your backend defines an audience boundary.',
      'await jwtVerify(token, jwks, { issuer });',
    ].join('\n'),
    apiReference: [
      {
        method: 'POST',
        path: '/email/start',
        when: 'Start email sign-in',
        detailsLabel: 'Show request and response',
        request: `fetch('${setupState.sdkOrigin}/email/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'user@example.com' }) })`,
        response: '{ "ok": true }',
      },
      // ...all remaining required endpoints
    ],
    backendNotes: [
      'Validate iss on every backend token check.',
      'Validate aud whenever your backend uses audience boundaries between services.',
      'Use GET /me for frontend user-state hydration, not as the backend per-request auth path.',
    ],
    backendNotesDisclosureLabel: 'More backend JWT notes',
    knownIssues: [
      'Passkeys depend on a valid RP ID and a browser environment that supports WebAuthn.',
      'Cross-origin pages must start mini-auth with --origin set to the page origin.',
      'Multiple tabs can currently race during session refresh. This is a known SDK bug, not a product contract.',
    ],
  };
}
```

- [ ] **Step 4: Add failing tests for deployment notes and issue wording**

```ts
it('includes github pages and custom domain deployment notes', () => {
  const content = buildDemoContent(sampleState);

  expect(content.deploymentNotes.join('\n')).toContain('GitHub Pages');
  expect(content.deploymentNotes.join('\n')).toContain('CNAME');
  expect(content.deploymentNotes.join('\n')).toContain('--origin');
});

it('describes multi-tab behavior as a bug, not a supported limit', () => {
  const content = buildDemoContent(sampleState);

  expect(content.knownIssues.join('\n')).toContain('known SDK bug');
  expect(content.knownIssues.join('\n')).not.toContain('single-tab only');
});

it('documents audience validation and /me usage in backend jwt guidance', () => {
  const content = buildDemoContent(sampleState);

  expect(content.backendNotes.join('\n')).toContain('Validate aud');
  expect(content.backendNotes.join('\n')).toContain('GET /me');
  expect(content.backendNotes.join('\n')).toContain(
    'not as the backend per-request auth path',
  );
});

it('includes hero and how-it-works copy for the landing-page role', () => {
  const content = buildDemoContent(sampleState);

  expect(content.hero.title).toContain('mini-auth');
  expect(content.hero.valueProp).toContain('small');
  expect(content.hero.audience).toContain('auth');
  expect(content.hero.capabilities).toEqual(
    expect.arrayContaining([
      'email OTP',
      'passkey',
      'JWT',
      'JWKS',
      'SQLite',
      'self-hosted',
    ]),
  );
  expect(content.howItWorks.join('\n')).toContain('script origin');
  expect(content.howItWorks.join('\n')).toContain('--origin');
  expect(content.howItWorks.join('\n')).toContain('WebAuthn');
});

it('marks long reference sections for progressive disclosure', () => {
  const content = buildDemoContent(sampleState);

  expect(content.apiReference.every((entry) => entry.detailsLabel)).toBe(true);
  expect(content.backendNotesDisclosureLabel).toContain('More');
});

it('includes all required known-issue topics', () => {
  const content = buildDemoContent(sampleState);
  const knownIssues = content.knownIssues.join('\n');

  expect(knownIssues).toContain('RP ID');
  expect(knownIssues).toContain('browser');
  expect(knownIssues).toContain('--origin');
  expect(knownIssues).toContain('known SDK bug');
});
```

- [ ] **Step 5: Re-run the content tests to verify they pass**

Run: `npm test -- tests/unit/demo-content.test.ts`
Expected: PASS with snippet generation, API Reference coverage, deployment notes, and known-issue wording locked in.

- [ ] **Step 6: Commit the content-builder slice**

```bash
git add demo/content.js demo/setup.js tests/unit/demo-content.test.ts
git commit -m "feat: add single-page demo content builders"
```

## Chunk 2: Page structure and runtime wiring

### Task 3: Rebuild `demo/index.html` and `demo/style.css` around the long-form layout

**Files:**

- Modify: `demo/index.html`
- Modify: `demo/style.css`
- Reference: `docs/superpowers/specs/2026-04-04-single-page-demo-docs-design.md`

- [ ] **Step 1: Replace the current shell with explicit long-page sections**

```html
<main class="page-shell">
  <section class="hero panel">...</section>
  <section class="quick-start panel">...</section>
  <section class="playground panel">...</section>
  <section class="how-it-works panel">...</section>
  <section class="api-reference panel">...</section>
  <section class="backend-jwt panel">...</section>
  <section class="deployment-notes panel">...</section>
  <section class="known-issues panel">...</section>
</main>
```

- [ ] **Step 2: Add stable render targets for all dynamic content blocks**

```html
<section class="hero panel">
  <p class="eyebrow">mini-auth</p>
  <h1 id="hero-title"></h1>
  <p id="hero-value-prop"></p>
  <p id="hero-audience"></p>
</section>

<input id="sdk-origin-input" type="url" />
<p id="config-error" hidden></p>
<pre id="origin-command"></pre>
<pre id="sdk-script-snippet"></pre>
<pre id="jose-snippet"></pre>
<ul id="how-it-works-list"></ul>
<div id="api-reference-list"></div>
<ul id="deployment-notes-list"></ul>
<ul id="known-issues-list"></ul>
```

- [ ] **Step 2.5: Keep all local static assets path-safe for GitHub Pages subpaths**

```html
<link rel="stylesheet" href="./style.css" />
<script type="module" src="./main.js"></script>
```

Run: `npm test -- tests/unit/demo-content.test.ts`
Expected: PASS after adding a content/path assertion that the page uses relative local asset references instead of root-path `/...` references.

- [ ] **Step 3: Update the CSS for a docs-first reading experience**

```css
.page-shell {
  max-width: 1180px;
  display: grid;
  gap: 20px;
}

.section-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
  gap: 20px;
}

.doc-prose,
.doc-code {
  line-height: 1.6;
}
```

- [ ] **Step 4: Keep the interactive controls from the current playground in the new layout**

```html
<button id="email-start-button" type="button">POST /email/start</button>
<button id="email-verify-button" type="button">POST /email/verify</button>
<button id="register-button" type="button">Create and bind passkey</button>
<button id="authenticate-button" type="button">Sign in with passkey</button>
<button id="clear-state-button" type="button">Logout</button>
```

- [ ] **Step 4.5: Use disclosure UI for secondary details so the shortest path stays first**

```html
<details class="doc-details">
  <summary>Show request and response</summary>
  <pre class="doc-code"></pre>
</details>

<details id="backend-notes-disclosure" class="doc-details">
  <summary>More backend JWT notes</summary>
  <ul id="backend-notes-list"></ul>
</details>
```

- [ ] **Step 5: Commit the static layout slice**

```bash
git add demo/index.html demo/style.css
git commit -m "feat: reshape demo into long-form docs page"
```

### Task 4: Make `demo/main.js` render from shared state and survive failure paths

**Files:**

- Modify: `demo/main.js`
- Modify: `demo/index.html`
- Modify: `demo/content.js`
- Create: `demo/bootstrap.js`
- Create: `tests/unit/demo-render.test.ts`
- Create: `tests/unit/demo-bootstrap.test.ts`

- [ ] **Step 1: Extract render helpers from `demo/main.js` and write failing tests for them**

```ts
import { renderContentState, renderApiReference } from '../../demo/main.js';

it('renders config-dependent snippets into the page', () => {
  const root = document.createElement('div');
  root.innerHTML = `
    <pre id="origin-command"></pre>
    <pre id="sdk-script-snippet"></pre>
    <pre id="jose-snippet"></pre>
    <p id="config-error" hidden></p>
  `;

  renderContentState(root, sampleSetupState, sampleContent);

  expect(root.querySelector('#sdk-script-snippet')?.textContent).toContain(
    'https://auth.example.com/sdk/singleton-iife.js',
  );
});

it('renders api reference entries into the page', () => {
  const root = document.createElement('div');
  root.innerHTML = '<div id="api-reference-list"></div>';

  renderApiReference(root, sampleContent.apiReference);

  expect(root.querySelector('#api-reference-list')?.textContent).toContain(
    '/email/start',
  );
  expect(root.querySelector('#api-reference-list')?.textContent).toContain(
    '/jwks',
  );
});

it('renders hero and how-it-works content for the landing-page view', () => {
  const root = document.createElement('div');
  root.innerHTML = `
    <h1 id="hero-title"></h1>
    <p id="hero-value-prop"></p>
    <p id="hero-audience"></p>
    <ul id="how-it-works-list"></ul>
  `;

  renderContentState(root, sampleSetupState, sampleContent);

  expect(root.querySelector('#hero-title')?.textContent).toContain('mini-auth');
  expect(root.querySelector('#how-it-works-list')?.textContent).toContain(
    'script origin',
  );
});

it('renders progressive disclosure containers for secondary details', () => {
  const root = document.createElement('div');
  root.innerHTML = `
    <div id="api-reference-list"></div>
    <details id="backend-notes-disclosure"><summary></summary><ul id="backend-notes-list"></ul></details>
  `;

  renderContentState(root, sampleSetupState, sampleContent);
  renderApiReference(root, sampleContent.apiReference);

  expect(
    root.querySelector('#backend-notes-disclosure summary')?.textContent,
  ).toContain('More');
  expect(
    root.querySelector('#api-reference-list details summary')?.textContent,
  ).toContain('Show request and response');
});

it('renders explicit failure reasons for cors and webauthn guidance', () => {
  const root = document.createElement('div');
  root.innerHTML = `
    <p id="setup-warning"></p>
    <pre id="register-output"></pre>
    <pre id="authenticate-output"></pre>
  `;

  renderContentState(
    root,
    {
      ...sampleSetupState,
      corsWarning: 'Start mini-auth with --origin set to this page origin.',
      passkeyWarning:
        'Open this page on localhost or an HTTPS domain for passkeys.',
    },
    sampleContent,
  );

  expect(root.querySelector('#setup-warning')?.textContent).toContain(
    '--origin',
  );
  expect(root.querySelector('#register-output')?.textContent).toContain(
    'localhost or an HTTPS domain',
  );
});
```

- [ ] **Step 2: Run the new render tests to verify they fail**

Run: `npm test -- tests/unit/demo-render.test.ts`
Expected: FAIL because `demo/main.js` does not yet export/render those helpers.

- [ ] **Step 3: Move SDK bootstrap ownership into `demo/main.js`**

```js
export async function loadSdkScript(setupState) {
  const script = document.createElement('script');
  script.src = setupState.sdkScriptUrl;
  script.dataset.miniAuthSdk = 'true';
  document.body.append(script);
  return await waitForScript(script);
}
```

- [ ] **Step 4: Extract an entrypoint bootstrap helper and add failing tests for real startup behavior**

```ts
import { bootstrapDemoPage } from '../../demo/bootstrap.js';

it('boots the page from window.location and renders docs even when sdk loading fails', async () => {
  document.body.innerHTML = buildDemoFixtureHtml();

  await bootstrapDemoPage({
    location: new URL(
      'https://docs.example.com/demo/?sdk-origin=https://auth.example.com',
    ),
    loadSdkScript: async () => {
      throw new Error('network down');
    },
  });

  expect(document.querySelector('#origin-command')?.textContent).toContain(
    '--origin https://docs.example.com',
  );
  expect(document.querySelector('#api-reference-list')?.textContent).toContain(
    '/email/start',
  );
  expect(document.querySelector('#latest-response')?.textContent).toContain(
    'MiniAuth SDK did not load',
  );
});

it('real demo/main.js bootstraps from window.location on import', async () => {
  document.body.innerHTML = buildDemoFixtureHtml();
  window.history.replaceState(
    {},
    '',
    '/demo/?sdk-origin=https://auth.example.com',
  );
  window.__MINI_AUTH_TEST_HOOKS__ = {
    loadSdkScript: async () => {
      window.MiniAuth = fakeSdk;
    },
  };

  await import('../../demo/main.js');

  expect(document.querySelector('#origin-command')?.textContent).toContain(
    '--origin http://localhost',
  );
  expect(document.querySelector('#sdk-script-snippet')?.textContent).toContain(
    'https://auth.example.com/sdk/singleton-iife.js',
  );
});

it('changing sdk-origin forces a clean re-bootstrap on the new origin', async () => {
  document.body.innerHTML = buildDemoFixtureHtml();
  window.history.replaceState(
    {},
    '',
    '/demo/?sdk-origin=https://auth-a.example.com',
  );

  await import('../../demo/main.js');

  document.querySelector('#sdk-origin-input').value =
    'https://auth-b.example.com';
  await dispatchSdkOriginApply();

  expect(window.location.search).toContain(
    'sdk-origin=https%3A%2F%2Fauth-b.example.com',
  );
  expect(window.location.reload).toHaveBeenCalled();
});
```

- [ ] **Step 5: Run the render/bootstrap tests to verify they fail**

Run: `npm test -- tests/unit/demo-render.test.ts tests/unit/demo-bootstrap.test.ts`
Expected: FAIL because there is no entrypoint-level bootstrap helper yet, the real startup path is not injectable/testable, and importing `demo/main.js` does not yet exercise a test hookable bootstrap.

- [ ] **Step 6: Implement `demo/bootstrap.js` and make `demo/main.js` delegate to it**

```js
export async function bootstrapDemoPage({
  location = window.location,
  loadSdkScript = defaultLoadSdkScript,
} = {}) {
  const setupState = getDemoSetupState(readLocationInputs(location));
  const content = buildDemoContent(setupState);

  renderContentState(document, setupState, content);

  if (setupState.configError) {
    disableFlowButtons(document);
    return;
  }

  try {
    await loadSdkScript(setupState);
  } catch (error) {
    renderSdkLoadError(document, error);
  }
}
```

- [ ] **Step 6.5: Add a default-loader failure test that simulates real script load errors**

```ts
it('shows docs and disables actions when the default script element fails to load', async () => {
  document.body.innerHTML = buildDemoFixtureHtml();

  const append = document.body.appendChild.bind(document.body);
  vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
    const result = append(node);

    if (node instanceof HTMLScriptElement) {
      queueMicrotask(() => node.dispatchEvent(new Event('error')));
    }

    return result;
  });

  await bootstrapDemoPage({
    location: new URL(
      'https://docs.example.com/demo/?sdk-origin=https://auth.example.com',
    ),
  });

  expect(document.querySelector('#api-reference-list')?.textContent).toContain(
    '/jwks',
  );
  expect(document.querySelector('#latest-response')?.textContent).toContain(
    'MiniAuth SDK did not load',
  );
  expect(
    document.querySelector('#email-start-button')?.hasAttribute('disabled'),
  ).toBe(true);
});
```

- [ ] **Step 7: Add failure-path rendering for invalid config and SDK load failure**

```js
if (setupState.configError) {
  renderContentState(document, setupState, content);
  disableFlowButtons();
  return;
}

try {
  await loadSdkScript(setupState);
} catch (error) {
  state.latestResult = `MiniAuth SDK did not load: ${formatError(error)}`;
  disableFlowButtons();
}
```

- [ ] **Step 7.5: Preserve specific CORS and WebAuthn guidance when the runtime cannot proceed**

```js
elements.setupWarning.textContent = setupState.corsWarning || '';

if (setupState.passkeyWarning) {
  elements.registerOutput.textContent = setupState.passkeyWarning;
  elements.authenticateOutput.textContent = setupState.passkeyWarning;
}
```

- [ ] **Step 7.6: Add runtime tests for real failure-reason presentation**

```ts
it('shows a cors-oriented failure message when sdk requests reject after startup', async () => {
  document.body.innerHTML = buildDemoFixtureHtml();
  window.MiniAuth = {
    ...fakeSdk,
    email: {
      start: async () => {
        throw new TypeError('Failed to fetch');
      },
    },
  };

  await bootstrapDemoPage({
    location: new URL(
      'https://docs.example.com/demo/?sdk-origin=https://auth.example.com',
    ),
    loadSdkScript: async () => {},
  });

  await clickEmailStartButton();

  expect(document.querySelector('#latest-response')?.textContent).toContain(
    'Failed to fetch',
  );
  expect(document.querySelector('#setup-warning')?.textContent).toContain(
    '--origin',
  );
});

it('shows a webauthn-environment explanation when passkeys are unavailable', async () => {
  document.body.innerHTML = buildDemoFixtureHtml();
  Object.defineProperty(window, 'PublicKeyCredential', {
    configurable: true,
    value: undefined,
  });

  await bootstrapDemoPage({
    location: new URL(
      'http://127.0.0.1:8080/demo/?sdk-origin=http://127.0.0.1:7777',
    ),
    loadSdkScript: async () => {},
  });

  expect(document.querySelector('#register-output')?.textContent).toContain(
    'passkeys',
  );
  expect(document.querySelector('#authenticate-output')?.textContent).toContain(
    'passkeys',
  );
});
```

- [ ] **Step 8: Keep `?sdk-origin=` as the only external config source and force a clean page reload after changes**

```js
function handleSdkOriginInput() {
  state.sdkOrigin = elements.sdkOriginInput.value.trim();
  const params = new URLSearchParams(window.location.search);
  params.set('sdk-origin', state.sdkOrigin);
  history.replaceState(
    {},
    '',
    `${window.location.pathname}?${params.toString()}${window.location.hash}`,
  );
  window.location.reload();
}
```

Run: `npm test -- tests/unit/demo-bootstrap.test.ts`
Expected: PASS with a runtime contract that changing `sdk-origin` cannot leave the old SDK instance active; the page always re-enters through a clean bootstrap on the new origin.

- [ ] **Step 9: Re-run the render, bootstrap, and content tests to verify they pass**

Run: `npm test -- tests/unit/demo-content.test.ts tests/unit/demo-render.test.ts tests/unit/demo-bootstrap.test.ts`
Expected: PASS with rendered snippets, complete API entry structure, deployment notes, real-entry bootstrap coverage, and default script-loader failure behavior all driven by one state object.

- [ ] **Step 10: Commit the runtime-wiring slice**

```bash
git add demo/index.html demo/main.js demo/bootstrap.js demo/content.js tests/unit/demo-content.test.ts tests/unit/demo-render.test.ts tests/unit/demo-bootstrap.test.ts
git commit -m "feat: sync single-page demo runtime and content"
```

## Chunk 3: Deployment docs and retained-flow verification

### Task 5: Add explicit deployment documentation and README linkage

**Files:**

- Modify: `README.md`
- Modify: `demo/content.js`
- Modify: `demo/index.html`

- [ ] **Step 1: Add failing content tests for GitHub Pages deployment guidance**

```ts
it('documents how to publish to github pages and update origin config', () => {
  const content = buildDemoContent(sampleState);
  const deploymentText = content.deploymentNotes.join('\n');

  expect(deploymentText).toContain('GitHub Pages');
  expect(deploymentText).toContain('publish');
  expect(deploymentText).toContain('CNAME');
  expect(deploymentText).toContain('--origin');
});
```

- [ ] **Step 2: Run the content tests to verify they fail if the guidance is missing**

Run: `npm test -- tests/unit/demo-content.test.ts`
Expected: FAIL until deployment notes include GitHub Pages publishing, custom domain/CNAME, and origin update guidance.

- [ ] **Step 3: Add the required deployment notes to `demo/content.js` and surface them in the page**

```js
deploymentNotes: [
  'Publish the static demo directory to GitHub Pages or any other static host.',
  'If you attach a custom domain, commit a matching CNAME file in the published artifact.',
  'After moving the page to a new domain, start mini-auth with --origin set to the new page origin.',
],
```

- [ ] **Step 4: Add a concise README pointer to the single-page docs page**

```md
## Demo / Docs

The `demo/` directory now hosts a single-page static site that doubles as the browser integration guide, API reference, and JWT verification walkthrough.
```

- [ ] **Step 5: Re-run the content tests to verify they pass**

Run: `npm test -- tests/unit/demo-content.test.ts`
Expected: PASS with deployment notes and README pointer wording aligned with the approved spec.

- [ ] **Step 6: Commit the deployment-doc slice**

```bash
git add README.md demo/content.js demo/index.html tests/unit/demo-content.test.ts
git commit -m "docs: add single-page demo deployment guidance"
```

### Task 6: Verify retained playground flows and non-root static compatibility

**Files:**

- Verify: `demo/index.html`
- Verify: `demo/main.js`
- Verify: `demo/setup.js`
- Verify: `demo/content.js`
- Verify: `demo/style.css`
- Verify: `tests/unit/demo-setup.test.ts`
- Verify: `tests/unit/demo-content.test.ts`
- Verify: `tests/unit/demo-render.test.ts`

- [ ] **Step 1: Run the focused demo unit suite**

Run: `npm test -- tests/unit/demo-setup.test.ts tests/unit/demo-content.test.ts tests/unit/demo-render.test.ts tests/unit/demo-bootstrap.test.ts`
Expected: PASS with setup derivation, content builders, render helpers, entrypoint bootstrap behavior, and known-issue wording covered.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS with no regressions beyond the demo/docs work.

- [ ] **Step 3: Run static quality checks**

Run: `npm run lint && npm run typecheck`
Expected: PASS with no new lint or type errors in demo files or tests.

- [ ] **Step 4: Run the production build**

Run: `npm run build`
Expected: PASS and regenerate the singleton IIFE successfully.

- [ ] **Step 5: Manual smoke-check the retained playground flows on a local static host**

Run: `python3 -m http.server 8080`
Expected: `http://localhost:8080/demo/` still exposes working buttons for email start, email verify, passkey register, passkey authenticate, and logout/session visibility once pointed at a live mini-auth server.

- [ ] **Step 6: Manual smoke-check a non-root static path with an explicit server root**

Run: `mkdir -p /tmp/mini-auth-pages/mini-auth && cp -R demo /tmp/mini-auth-pages/mini-auth/ && python3 -m http.server 8081 --directory /tmp/mini-auth-pages`
Expected: `http://localhost:8081/mini-auth/demo/?sdk-origin=http://127.0.0.1:7777` loads styles and module scripts correctly, shows `http://localhost:8081` as the recommended `--origin`, and preserves all docs sections when served from a project-style subpath.

- [ ] **Step 7: Manual smoke-check SDK load failure with an explicit fault injection**

Run: `python3 -m http.server 8082 --directory /tmp/mini-auth-pages`
Expected: Visiting `http://localhost:8082/mini-auth/demo/?sdk-origin=http://127.0.0.1:9999` shows rendered docs, API Reference, deployment notes, and a visible SDK load failure message while playground actions stay disabled.

- [ ] **Step 8: Commit the final verified slice**

```bash
git add demo/index.html demo/main.js demo/bootstrap.js demo/setup.js demo/content.js demo/style.css README.md tests/unit/demo-setup.test.ts tests/unit/demo-content.test.ts tests/unit/demo-render.test.ts tests/unit/demo-bootstrap.test.ts
git commit -m "feat: publish single-page demo docs"
```

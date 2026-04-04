import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sampleSdkState = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  status: 'authenticated',
};

describe('demo bootstrap', () => {
  let previousDocument;
  let previousWindow;
  let previousHistory;
  let previousLocalStorage;
  let previousLocation;
  let previousEvent;

  beforeEach(() => {
    previousDocument = globalThis.document;
    previousWindow = globalThis.window;
    previousHistory = globalThis.history;
    previousLocalStorage = globalThis.localStorage;
    previousLocation = globalThis.location;
    previousEvent = globalThis.Event;
  });

  afterEach(() => {
    restoreGlobal('document', previousDocument);
    restoreGlobal('window', previousWindow);
    restoreGlobal('history', previousHistory);
    restoreGlobal('localStorage', previousLocalStorage);
    restoreGlobal('location', previousLocation);
    restoreGlobal('Event', previousEvent);
    delete globalThis.__MINI_AUTH_TEST_HOOKS__;
    delete globalThis.MiniAuth;
  });

  it('boots the page from window.location and renders docs even when sdk loading fails', async () => {
    const env = createTestEnvironment(
      'https://docs.example.com/demo/?sdk-origin=https://auth.example.com',
    );
    const { bootstrapDemoPage } = await import('../../demo/bootstrap.js');

    await bootstrapDemoPage({
      document: env.document,
      history: env.history,
      localStorage: env.localStorage,
      location: env.location,
      window: env.window,
      loadSdkScript: async () => {
        throw new Error('network down');
      },
    });

    expect(
      env.document.querySelector('#origin-command')?.textContent,
    ).toContain('--origin https://docs.example.com');
    expect(
      env.document.querySelector('#api-reference-list')?.textContent,
    ).toContain('/email/start');
    expect(
      env.document.querySelector('#latest-response')?.textContent,
    ).toContain('MiniAuth SDK did not load');
  });

  it('shows docs and disables actions when the default script element fails to load', async () => {
    const env = createTestEnvironment(
      'https://docs.example.com/demo/?sdk-origin=https://auth.example.com',
      { autoFailScript: true },
    );
    const { bootstrapDemoPage } = await import('../../demo/bootstrap.js');

    await bootstrapDemoPage({
      document: env.document,
      history: env.history,
      localStorage: env.localStorage,
      location: env.location,
      window: env.window,
    });

    expect(
      env.document.querySelector('#api-reference-list')?.textContent,
    ).toContain('/jwks');
    expect(
      env.document.querySelector('#latest-response')?.textContent,
    ).toContain('MiniAuth SDK did not load');
    expect(env.document.querySelector('#email-start-button')?.disabled).toBe(
      true,
    );
  });

  it('shows a cors-oriented failure message when sdk requests reject after startup', async () => {
    const env = createTestEnvironment(
      'https://docs.example.com/demo/?sdk-origin=https://auth.example.com',
    );
    const { bootstrapDemoPage } = await import('../../demo/bootstrap.js');

    env.window.MiniAuth = createFakeSdk({
      email: {
        start: async () => {
          throw new TypeError('Failed to fetch');
        },
      },
    });

    await bootstrapDemoPage({
      document: env.document,
      history: env.history,
      localStorage: env.localStorage,
      location: env.location,
      window: env.window,
      loadSdkScript: async () => {},
    });

    env.document.querySelector('#email')!.value = 'user@example.com';
    await env.document.querySelector('#email-start-button')!.click();

    expect(
      env.document.querySelector('#latest-response')?.textContent,
    ).toContain('Failed to fetch');
    expect(env.document.querySelector('#setup-warning')?.textContent).toContain(
      '--origin',
    );
  });

  it('shows a webauthn-environment explanation when passkeys are unavailable', async () => {
    const env = createTestEnvironment(
      'http://127.0.0.1:8080/demo/?sdk-origin=http://127.0.0.1:7777',
      { publicKeyCredential: undefined },
    );
    const { bootstrapDemoPage } = await import('../../demo/bootstrap.js');
    env.window.MiniAuth = createFakeSdk();

    await bootstrapDemoPage({
      document: env.document,
      history: env.history,
      localStorage: env.localStorage,
      location: env.location,
      window: env.window,
      loadSdkScript: async () => {},
    });

    expect(env.document.querySelector('#register-output')?.textContent).toMatch(
      /passkeys/i,
    );
    expect(
      env.document.querySelector('#authenticate-output')?.textContent,
    ).toMatch(/passkeys/i);
  });

  it('real demo/main.js bootstraps from window.location on import', async () => {
    const env = createTestEnvironment(
      'http://localhost/demo/?sdk-origin=https://auth.example.com',
    );
    applyGlobals(env);
    env.window.__MINI_AUTH_TEST_HOOKS__ = {
      loadSdkScript: async () => {
        env.window.MiniAuth = createFakeSdk();
      },
    };

    vi.resetModules();
    await import('../../demo/main.js?bootstrap-import');

    expect(
      env.document.querySelector('#origin-command')?.textContent,
    ).toContain('--origin http://localhost');
    expect(
      env.document.querySelector('#sdk-script-snippet')?.textContent,
    ).toContain('https://auth.example.com/sdk/singleton-iife.js');
  });

  it('changing sdk-origin preserves pathname/hash and forces a clean page reload', async () => {
    const env = createTestEnvironment(
      'https://docs.example.com/demo/index.html?sdk-origin=https://auth-a.example.com#playground',
    );
    const { bootstrapDemoPage } = await import('../../demo/bootstrap.js');
    env.window.MiniAuth = createFakeSdk();

    await bootstrapDemoPage({
      document: env.document,
      history: env.history,
      localStorage: env.localStorage,
      location: env.location,
      window: env.window,
      loadSdkScript: async () => {},
    });

    env.document.querySelector('#sdk-origin-input')!.value =
      'https://auth-b.example.com';
    await env.document.querySelector('#sdk-origin-input')!.dispatchEvent({
      type: 'change',
      preventDefault() {},
    });

    expect(env.window.location.search).toContain(
      'sdk-origin=https%3A%2F%2Fauth-b.example.com',
    );
    expect(env.window.location.pathname).toBe('/demo/index.html');
    expect(env.window.location.hash).toBe('#playground');
    expect(env.window.location.reload).toHaveBeenCalledTimes(1);
  });
});

function createTestEnvironment(urlString, options = {}) {
  const location = new URL(urlString);
  location.reload = vi.fn();
  const localStorage = createStorage();
  const document = createFakeDocument(options);
  const history = {
    replaceState(_state, _title, nextUrl) {
      const next = new URL(nextUrl, location.origin);
      location.pathname = next.pathname;
      location.search = next.search;
      location.hash = next.hash;
    },
  };
  const window = {
    MiniAuth: undefined,
    __MINI_AUTH_TEST_HOOKS__: undefined,
    PublicKeyCredential:
      'publicKeyCredential' in options
        ? options.publicKeyCredential
        : function PublicKeyCredential() {},
    location,
    history,
    localStorage,
  };

  document.defaultView = window;

  return {
    document,
    history,
    localStorage,
    location,
    window,
  };
}

function applyGlobals(env) {
  globalThis.Event = class Event {
    constructor(type) {
      this.type = type;
    }
  };
  globalThis.document = env.document;
  globalThis.window = env.window;
  globalThis.history = env.history;
  globalThis.localStorage = env.localStorage;
  globalThis.location = env.location;
  globalThis.__MINI_AUTH_TEST_HOOKS__ = env.window.__MINI_AUTH_TEST_HOOKS__;
}

function restoreGlobal(name, value) {
  if (value === undefined) {
    delete globalThis[name];
    return;
  }

  globalThis[name] = value;
}

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function createFakeSdk(overrides = {}) {
  const sessionState = { ...sampleSdkState };
  const listeners = [];

  const sdk = {
    ready: Promise.resolve(),
    email: {
      start: async () => ({ ok: true }),
      verify: async () => ({ session: 'email-session' }),
      ...overrides.email,
    },
    webauthn: {
      register: async () => ({ ok: true }),
      authenticate: async () => ({ session: 'passkey-session' }),
      ...overrides.webauthn,
    },
    me: {
      get: () => ({ email: 'user@example.com' }),
      reload: async () => ({ email: 'user@example.com' }),
      ...overrides.me,
    },
    session: {
      getState: () => sessionState,
      onChange: (listener) => listeners.push(listener),
      logout: async () => {
        sessionState.status = 'anonymous';
      },
      ...overrides.session,
    },
  };

  return { ...sdk, ...overrides };
}

function createFakeDocument(options) {
  const elements = new Map();
  const body = createElement('body');
  body.append = (...nodes) => {
    body.children.push(...nodes);
    for (const node of nodes) {
      if (options.autoFailScript && node.tagName === 'SCRIPT') {
        queueMicrotask(() => node.dispatchEvent({ type: 'error' }));
      }
    }
  };
  body.appendChild = (node) => {
    body.append(node);
    return node;
  };

  const document = {
    body,
    defaultView: null,
    createElement,
    querySelector(selector) {
      if (selector === 'script[data-mini-auth-sdk]') {
        return (
          body.children.find((node) => node.dataset.miniAuthSdk === 'true') ??
          null
        );
      }
      return elements.get(selector) ?? null;
    },
  };

  for (const id of [
    'base-url',
    'sdk-origin-input',
    'email',
    'otp-code',
    'access-token',
    'refresh-token',
    'request-id',
    'latest-request',
    'latest-response',
    'page-origin',
    'page-rp-id',
    'config-error',
    'setup-warning',
    'origin-command',
    'sdk-script-snippet',
    'jose-snippet',
    'email-start-output',
    'email-verify-output',
    'register-output',
    'authenticate-output',
    'email-start-button',
    'email-verify-button',
    'register-button',
    'authenticate-button',
    'clear-state-button',
    'status-config',
    'status-email-start',
    'status-email-verify',
    'status-register',
    'status-authenticate',
    'hero-title',
    'hero-value-prop',
    'hero-audience',
    'hero-capabilities',
    'how-it-works-list',
    'api-reference-list',
    'backend-notes-list',
    'deployment-notes-list',
    'known-issues-list',
    'backend-notes-disclosure-summary',
  ]) {
    const element = createElement('div');
    element.id = id;
    if (
      id.includes('button') ||
      id === 'clear-state-button' ||
      id === 'sdk-origin-input' ||
      id === 'email' ||
      id === 'otp-code' ||
      id === 'access-token' ||
      id === 'refresh-token' ||
      id === 'request-id' ||
      id === 'base-url'
    ) {
      element.value = '';
    }
    elements.set(`#${id}`, element);
  }

  return document;

  function createElement(tagName) {
    const listeners = new Map();
    return {
      tagName: String(tagName).toUpperCase(),
      id: '',
      value: '',
      textContent: '',
      innerHTML: '',
      hidden: false,
      disabled: false,
      dataset: {},
      children: [],
      classList: {
        add() {},
        remove() {},
      },
      append(...nodes) {
        this.children.push(...nodes);
      },
      appendChild(node) {
        this.children.push(node);
        return node;
      },
      addEventListener(type, listener) {
        const bucket = listeners.get(type) ?? [];
        bucket.push(listener);
        listeners.set(type, bucket);
      },
      async dispatchEvent(event) {
        const bucket = listeners.get(event.type) ?? [];
        for (const listener of bucket) {
          await listener.call(this, event);
        }
      },
      async click() {
        await this.dispatchEvent({
          type: 'click',
          preventDefault() {},
        });
      },
      hasAttribute(name) {
        return Boolean(this[name]);
      },
    };
  }
}

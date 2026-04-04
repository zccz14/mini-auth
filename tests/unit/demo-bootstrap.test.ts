import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FakeEvent = {
  type: string;
  preventDefault?: () => void;
};

type FakeListener = (event: FakeEvent) => void | Promise<void>;

type FakeElement = {
  tagName: string;
  id: string;
  value: string;
  textContent: string;
  innerHTML: string;
  hidden: boolean;
  disabled: boolean;
  className: string;
  dataset: Record<string, string>;
  children: FakeElement[];
  classList: {
    add: (...names: string[]) => void;
    remove: (...names: string[]) => void;
  };
  append: (...nodes: FakeElement[]) => void;
  appendChild: (node: FakeElement) => FakeElement;
  replaceChildren: (...nodes: FakeElement[]) => void;
  addEventListener: (type: string, listener: FakeListener) => void;
  dispatchEvent: (event: FakeEvent) => Promise<void>;
  click: () => Promise<void>;
  hasAttribute: (name: string) => boolean;
  src?: string;
};

type FakeStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

type FakeLocation = URL & { reload: ReturnType<typeof vi.fn> };

type FakeHistory = {
  replaceState: (_state: unknown, _title: string, nextUrl: string) => void;
};

type FakeSdk = {
  ready: Promise<void>;
  email: {
    start: (input?: unknown) => Promise<unknown>;
    verify: (input?: unknown) => Promise<unknown>;
  };
  webauthn: {
    register: () => Promise<unknown>;
    authenticate: () => Promise<unknown>;
  };
  me: {
    get: () => unknown;
    reload: () => Promise<unknown>;
  };
  session: {
    getState: () => typeof sampleSdkState;
    onChange: (listener: () => void) => void;
    logout: () => Promise<void>;
  };
};

type FakeWindow = {
  MiniAuth?: FakeSdk;
  __MINI_AUTH_TEST_HOOKS__?: {
    loadSdkScript?: () => Promise<void>;
  };
  __MINI_AUTH_SDK_URL__?: string;
  PublicKeyCredential?: unknown;
  location: FakeLocation;
  history: FakeHistory;
  localStorage: FakeStorage;
};

type FakeDocument = {
  body: FakeElement;
  defaultView: FakeWindow | null;
  createElement: (tagName: string) => FakeElement;
  querySelector: (selector: string) => FakeElement | null;
  querySelectorAll: (selector: string) => FakeElement[];
};

type TestEnvironment = {
  document: FakeDocument;
  history: FakeHistory;
  localStorage: FakeStorage;
  location: FakeLocation;
  window: FakeWindow;
};

type TestGlobals = typeof globalThis & {
  document?: FakeDocument;
  window?: FakeWindow;
  history?: FakeHistory;
  localStorage?: FakeStorage;
  location?: FakeLocation;
  Event?: unknown;
  __MINI_AUTH_TEST_HOOKS__?: FakeWindow['__MINI_AUTH_TEST_HOOKS__'];
  MiniAuth?: FakeSdk;
};

const testGlobals = globalThis as TestGlobals;

const sampleSdkState = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  status: 'authenticated',
};

describe('demo bootstrap', () => {
  let previousDocument: TestGlobals['document'];
  let previousWindow: TestGlobals['window'];
  let previousHistory: TestGlobals['history'];
  let previousLocalStorage: TestGlobals['localStorage'];
  let previousLocation: TestGlobals['location'];
  let previousEvent: TestGlobals['Event'];

  beforeEach(() => {
    previousDocument = testGlobals.document;
    previousWindow = testGlobals.window;
    previousHistory = testGlobals.history;
    previousLocalStorage = testGlobals.localStorage;
    previousLocation = testGlobals.location;
    previousEvent = testGlobals.Event;
  });

  afterEach(() => {
    restoreGlobal('document', previousDocument);
    restoreGlobal('window', previousWindow);
    restoreGlobal('history', previousHistory);
    restoreGlobal('localStorage', previousLocalStorage);
    restoreGlobal('location', previousLocation);
    restoreGlobal('Event', previousEvent);
    Reflect.deleteProperty(testGlobals, '__MINI_AUTH_TEST_HOOKS__');
    Reflect.deleteProperty(testGlobals, 'MiniAuth');
  });

  it('boots the page from window.location and renders docs even when sdk loading fails', async () => {
    const env = createTestEnvironment(
      'https://docs.example.com/demo/?sdk-origin=https://auth.example.com',
    );
    const { bootstrapDemoPage } = await import('../../demo/bootstrap.js');

    await runBootstrap(bootstrapDemoPage, env, {
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
      env.document.querySelector('#api-reference-list article h3')?.tagName,
    ).toBe('H3');
    expect(
      env.document.querySelector('#api-reference-list article details summary')
        ?.tagName,
    ).toBe('SUMMARY');
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

    await runBootstrap(bootstrapDemoPage, env);

    expect(
      env.document.querySelector('#api-reference-list')?.textContent,
    ).toContain('/jwks');
    expect(
      env.document.querySelector('#latest-response')?.textContent,
    ).toContain('MiniAuth SDK did not load');
    expect(env.document.querySelector('#email-start-button')?.disabled).toBe(
      true,
    );
    expect(
      env.document.querySelector('#api-reference-list article details pre')
        ?.tagName,
    ).toBe('PRE');
  });

  it('keeps actions safe before sdk is attached', async () => {
    const env = createTestEnvironment(
      'https://docs.example.com/demo/?sdk-origin=https://auth.example.com',
    );
    const { bootstrapDemoPage } = await import('../../demo/bootstrap.js');

    const startup = runBootstrap(bootstrapDemoPage, env, {
      loadSdkScript: () => new Promise(() => {}),
    });

    expect(env.document.querySelector('#email-start-button')?.disabled).toBe(
      true,
    );
    await expect(
      env.document.querySelector('#email-start-button')!.click(),
    ).resolves.toBeUndefined();
    expect(
      env.document.querySelector('#latest-response')?.textContent,
    ).toContain('not ready yet');
    expect(env.document.querySelector('#clear-state-button')?.disabled).toBe(
      true,
    );

    void startup;
  });

  it('uses the injected window for fallback sdk url reads', async () => {
    const env = createTestEnvironment('https://docs.example.com/demo/');
    const { bootstrapDemoPage } = await import('../../demo/bootstrap.js');
    setTestGlobal('window', {
      location: Object.assign(new URL('https://global.example.com/demo/'), {
        reload: vi.fn(),
      }),
      __MINI_AUTH_SDK_URL__: 'https://global.example.com/sdk/singleton-iife.js',
      history: env.history,
      localStorage: env.localStorage,
    } as FakeWindow);

    env.window.__MINI_AUTH_SDK_URL__ =
      'https://injected-window.example.com/sdk/singleton-iife.js';

    await runBootstrap(bootstrapDemoPage, env, {
      loadSdkScript: async () => {
        throw new Error('network down');
      },
      location: undefined,
    });

    expect(
      env.document.querySelector('#sdk-script-snippet')?.textContent,
    ).toContain('https://injected-window.example.com/sdk/singleton-iife.js');
    expect(
      env.document.querySelector('#origin-command')?.textContent,
    ).toContain('--origin https://docs.example.com');
  });

  it('keeps actions disabled until sdk.ready settles', async () => {
    const env = createTestEnvironment(
      'https://docs.example.com/demo/?sdk-origin=https://auth.example.com',
    );
    const { bootstrapDemoPage } = await import('../../demo/bootstrap.js');
    const ready = createDeferred();
    env.window.MiniAuth = createFakeSdk({ ready: ready.promise });

    const startup = runBootstrap(bootstrapDemoPage, env, {
      loadSdkScript: async () => {},
    });

    expect(env.document.querySelector('#email-start-button')?.disabled).toBe(
      true,
    );
    await expect(
      env.document.querySelector('#clear-state-button')!.click(),
    ).resolves.toBeUndefined();
    expect(
      env.document.querySelector('#latest-response')?.textContent,
    ).toContain('not ready yet');

    ready.resolve?.();
    await startup;

    expect(env.document.querySelector('#email-start-button')?.disabled).toBe(
      false,
    );
    expect(env.document.querySelector('#clear-state-button')?.disabled).toBe(
      false,
    );
  });

  it('re-enables actions after sdk attachment', async () => {
    const env = createTestEnvironment(
      'https://docs.example.com/demo/?sdk-origin=https://auth.example.com',
    );
    const { bootstrapDemoPage } = await import('../../demo/bootstrap.js');
    env.window.MiniAuth = createFakeSdk();

    await runBootstrap(bootstrapDemoPage, env, {
      loadSdkScript: async () => {},
    });

    expect(env.document.querySelector('#email-start-button')?.disabled).toBe(
      false,
    );
    expect(env.document.querySelector('#clear-state-button')?.disabled).toBe(
      false,
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

    await runBootstrap(bootstrapDemoPage, env, {
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

    await runBootstrap(bootstrapDemoPage, env, {
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
    await import('../../demo/main.js');

    expect(
      env.document.querySelector('#origin-command')?.textContent,
    ).toContain('--origin http://localhost');
    expect(
      env.document.querySelector('#sdk-script-snippet')?.textContent,
    ).toContain('https://auth.example.com/sdk/singleton-iife.js');
    expect(env.document.querySelector('#hero-capabilities li')?.tagName).toBe(
      'LI',
    );
  });

  it('changing sdk-origin preserves pathname/hash and forces a clean page reload', async () => {
    const env = createTestEnvironment(
      'https://docs.example.com/demo/index.html?sdk-origin=https://auth-a.example.com#playground',
    );
    const { bootstrapDemoPage } = await import('../../demo/bootstrap.js');
    env.window.MiniAuth = createFakeSdk();

    await runBootstrap(bootstrapDemoPage, env, {
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

function runBootstrap(
  bootstrapDemoPage: unknown,
  env: TestEnvironment,
  overrides: Partial<{
    location: FakeLocation | undefined;
    loadSdkScript: () => Promise<void>;
  }> = {},
) {
  return (
    bootstrapDemoPage as (options: Record<string, unknown>) => Promise<void>
  )({
    document: env.document,
    history: env.history,
    localStorage: env.localStorage,
    location: overrides.location ?? env.location,
    window: env.window,
    ...overrides,
  });
}

function createTestEnvironment(
  urlString: string,
  options: { autoFailScript?: boolean; publicKeyCredential?: unknown } = {},
): TestEnvironment {
  const location = Object.assign(new URL(urlString), { reload: vi.fn() });
  const localStorage = createStorage();
  const document = createFakeDocument(options);
  const history: FakeHistory = {
    replaceState(_state: unknown, _title: string, nextUrl: string) {
      const next = new URL(nextUrl, location.origin);
      location.pathname = next.pathname;
      location.search = next.search;
      location.hash = next.hash;
    },
  };
  const window: FakeWindow = {
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

function applyGlobals(env: TestEnvironment) {
  setTestGlobal(
    'Event',
    class FakeEventClass {
      type: string;

      constructor(type: string) {
        this.type = type;
      }
    },
  );
  setTestGlobal('document', env.document);
  setTestGlobal('window', env.window);
  setTestGlobal('history', env.history);
  setTestGlobal('localStorage', env.localStorage);
  setTestGlobal('location', env.location);
  setTestGlobal(
    '__MINI_AUTH_TEST_HOOKS__',
    env.window.__MINI_AUTH_TEST_HOOKS__,
  );
}

function restoreGlobal(
  name: keyof TestGlobals,
  value: TestGlobals[keyof TestGlobals],
) {
  if (value === undefined) {
    Reflect.deleteProperty(testGlobals, name);
    return;
  }

  setTestGlobal(name, value);
}

function setTestGlobal<K extends keyof TestGlobals>(
  name: K,
  value: TestGlobals[K],
) {
  Object.defineProperty(testGlobals, name, {
    value,
    configurable: true,
    writable: true,
  });
}

function createStorage(): FakeStorage {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, String(value));
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

function createDeferred() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve,
  };
}

function createFakeSdk(
  overrides: Partial<{
    ready: Promise<void>;
    email: Partial<FakeSdk['email']>;
    webauthn: Partial<FakeSdk['webauthn']>;
    me: Partial<FakeSdk['me']>;
    session: Partial<FakeSdk['session']>;
  }> = {},
): FakeSdk {
  const sessionState = { ...sampleSdkState };
  const listeners: Array<() => void> = [];

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
      onChange: (listener: () => void) => listeners.push(listener),
      logout: async () => {
        sessionState.status = 'anonymous';
      },
      ...overrides.session,
    },
  };

  return { ...sdk, ...overrides } as FakeSdk;
}

function createFakeDocument(options: {
  autoFailScript?: boolean;
  publicKeyCredential?: unknown;
}): FakeDocument {
  const elements = new Map<string, FakeElement>();
  const body = createElement('body');
  body.append = (...nodes: FakeElement[]) => {
    body.children.push(...nodes);
    for (const node of nodes) {
      if (options.autoFailScript && node.tagName === 'SCRIPT') {
        queueMicrotask(() => node.dispatchEvent({ type: 'error' }));
      }
    }
  };
  body.appendChild = (node: FakeElement) => {
    body.append(node);
    return node;
  };

  const document = {
    body,
    defaultView: null,
    createElement,
    querySelector(selector: string) {
      if (selector === 'script[data-mini-auth-sdk]') {
        return (
          body.children.find((node) => node.dataset.miniAuthSdk === 'true') ??
          null
        );
      }
      if (elements.has(selector)) {
        return elements.get(selector) ?? null;
      }

      return queryNested(selector);
    },
    querySelectorAll(selector: string) {
      return queryNestedAll(selector);
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
    'backend-notes-disclosure',
  ]) {
    const element = createElement(id.includes('list') ? 'ul' : 'div');
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

  const backendNotesSummary = createElement('summary');
  elements.get('#backend-notes-disclosure')?.appendChild(backendNotesSummary);

  return document;

  function createElement(tagName: string): FakeElement {
    const listeners = new Map<string, FakeListener[]>();
    const classNames = new Set<string>();
    const element: FakeElement = {
      tagName: String(tagName).toUpperCase(),
      id: '',
      value: '',
      textContent: '',
      innerHTML: '',
      hidden: false,
      disabled: false,
      className: '',
      dataset: {},
      children: [],
      classList: {
        add(...names: string[]) {
          for (const name of names) {
            classNames.add(name);
          }
          element.className = [...classNames].join(' ');
        },
        remove(...names: string[]) {
          for (const name of names) {
            classNames.delete(name);
          }
          element.className = [...classNames].join(' ');
        },
      },
      append(...nodes: FakeElement[]) {
        this.children.push(...nodes);
        syncText(this);
      },
      appendChild(node: FakeElement) {
        this.children.push(node);
        syncText(this);
        return node;
      },
      replaceChildren(...nodes: FakeElement[]) {
        this.children = [...nodes];
        syncText(this);
      },
      addEventListener(type: string, listener: FakeListener) {
        const bucket = listeners.get(type) ?? [];
        bucket.push(listener);
        listeners.set(type, bucket);
      },
      async dispatchEvent(event: FakeEvent) {
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
      hasAttribute(name: string) {
        return Boolean(this[name as keyof FakeElement]);
      },
    };

    return element;
  }

  function queryNested(selector: string) {
    return queryNestedAll(selector)[0] ?? null;
  }

  function queryNestedAll(selector: string): FakeElement[] {
    const parts = selector.split(' ');
    const rootSelector = parts.shift() ?? '';
    const rootElement = elements.get(rootSelector);
    if (!rootElement) {
      return [];
    }

    return queryAllWithin(rootElement, parts);
  }

  function queryAllWithin(
    element: FakeElement,
    selectors: string[],
  ): FakeElement[] {
    if (selectors.length === 0) {
      return [element];
    }

    const [selector, ...rest] = selectors;
    const matcher = selector.replace(':last-of-type', '');
    const matches: FakeElement[] = [];
    walk(element, (child) => {
      if (child.tagName?.toLowerCase() === matcher) {
        matches.push(child);
      }
    });

    const filtered = selector.endsWith(':last-of-type')
      ? matches.slice(-1)
      : matches;

    return rest.length === 0
      ? filtered
      : filtered.flatMap((child) => queryAllWithin(child, rest));
  }

  function walk(element: FakeElement, visit: (child: FakeElement) => void) {
    for (const child of element.children) {
      visit(child);
      walk(child, visit);
    }
  }

  function syncText(element: FakeElement) {
    element.textContent = [
      ...element.children.map((child) => child.textContent).filter(Boolean),
    ].join('\n');
  }
}

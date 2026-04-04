import { beforeEach, describe, expect, it } from 'vitest';

type FakeNode = FakeElement;

type FakeElement = {
  id: string;
  tagName: string;
  hidden: boolean;
  textContent: string;
  innerHTML: string;
  className: string;
  value: string;
  children: FakeNode[];
  append: (...nodes: FakeNode[]) => void;
  appendChild: (node: FakeNode) => FakeNode;
  replaceChildren: (...nodes: FakeNode[]) => void;
};

type FakeRenderRoot = {
  createElement: (tagName: string) => FakeElement;
  querySelector: (selector: string) => FakeElement | null;
  querySelectorAll: (selector: string) => FakeElement[];
};

const sampleSetupState = {
  currentOrigin: 'https://docs.example.com',
  currentRpId: 'docs.example.com',
  suggestedOrigin: 'https://docs.example.com',
  suggestedRpId: 'auth.example.com',
  sdkOrigin: 'https://auth.example.com',
  sdkScriptUrl: 'https://auth.example.com/sdk/singleton-iife.js',
  issuer: 'https://auth.example.com',
  jwksUrl: 'https://auth.example.com/jwks',
  configError: '',
  webauthnReady: false,
  corsWarning:
    'Start mini-auth with --origin set to this page origin so the browser can call the auth server cross-origin.',
  passkeyWarning:
    'Open this page on localhost or an HTTPS domain for passkeys.',
  startupCommand:
    'mini-auth start ./mini-auth.sqlite --issuer https://auth.example.com --origin https://docs.example.com --rp-id auth.example.com',
};

describe('demo render helpers', () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'document');
  });

  it('renders config-dependent snippets into the page', async () => {
    const { buildDemoContent } = await import('../../demo/content.js');
    const { renderContentState } = await import('../../demo/main.js');
    const root = createRenderRoot();
    const content = buildDemoContent(sampleSetupState);

    renderContentState(root, sampleSetupState, content);

    expect(root.querySelector('#origin-command')?.textContent).toContain(
      '--origin https://docs.example.com',
    );
    expect(root.querySelector('#sdk-script-snippet')?.textContent).toContain(
      'https://auth.example.com/sdk/singleton-iife.js',
    );
    expect(root.querySelector('#jose-snippet')?.textContent).toContain(
      "const issuer = 'https://auth.example.com'",
    );
    expect(root.querySelector('#config-error')?.hidden).toBe(true);
  });

  it('renders api reference entries into the page', async () => {
    const { buildDemoContent } = await import('../../demo/content.js');
    const { renderApiReference } = await import('../../demo/main.js');
    const root = createRenderRoot();
    const content = buildDemoContent(sampleSetupState);

    renderApiReference(root, content.apiReference);

    expect(
      root.querySelector('#api-reference-list article h3')?.textContent,
    ).toContain('/email/start');
    expect(root.querySelector('#api-reference-list article')?.className).toBe(
      'panel inset-panel doc-code-card',
    );
    expect(
      root.querySelector('#api-reference-list article p:last-of-type')
        ?.className,
    ).toBe('card-copy');
    expect(
      root.querySelector('#api-reference-list article details summary')
        ?.textContent,
    ).toContain('Show request and response');
    expect(
      root.querySelector('#api-reference-list article details')?.className,
    ).toBe('doc-details');
    expect(
      root.querySelector('#api-reference-list article details pre')
        ?.textContent,
    ).toContain('https://auth.example.com/email/start');
    expect(
      root.querySelector('#api-reference-list article details pre:last-of-type')
        ?.textContent,
    ).toContain('{');
    expect(
      root.querySelectorAll('#api-reference-list article').length,
    ).toBeGreaterThan(1);
    expect(
      root.querySelector('#api-reference-list article:last-of-type h3')
        ?.textContent,
    ).toContain('/jwks');
  });

  it('renders list sections as real list items', async () => {
    const { buildDemoContent } = await import('../../demo/content.js');
    const { renderContentState } = await import('../../demo/main.js');
    const root = createRenderRoot();
    const content = buildDemoContent(sampleSetupState);

    renderContentState(root, sampleSetupState, content);

    expect(root.querySelector('#hero-capabilities li')?.textContent).toContain(
      'email OTP',
    );
    expect(root.querySelector('#how-it-works-list li')?.textContent).toContain(
      'page origin',
    );
    expect(root.querySelector('#backend-notes-list li')?.textContent).toContain(
      'Validate iss',
    );
    expect(
      root.querySelector('#deployment-notes-list li')?.textContent,
    ).toContain('GitHub Pages');
    expect(root.querySelector('#known-issues-list li')?.textContent).toContain(
      'Passkeys',
    );
  });

  it('renders hero and how-it-works content for the landing-page view', async () => {
    const { buildDemoContent } = await import('../../demo/content.js');
    const { renderContentState } = await import('../../demo/main.js');
    const root = createRenderRoot();
    const content = buildDemoContent(sampleSetupState);

    renderContentState(root, sampleSetupState, content);

    expect(root.querySelector('#hero-title')?.textContent).toContain(
      'mini-auth',
    );
    expect(root.querySelector('#how-it-works-list')?.textContent).toContain(
      'script origin',
    );
  });

  it('renders progressive disclosure containers for secondary details', async () => {
    const { buildDemoContent } = await import('../../demo/content.js');
    const { renderApiReference, renderContentState } =
      await import('../../demo/main.js');
    const root = createRenderRoot();
    const content = buildDemoContent(sampleSetupState);

    renderContentState(root, sampleSetupState, content);
    renderApiReference(root, content.apiReference);

    expect(
      root.querySelector('#backend-notes-disclosure summary')?.textContent,
    ).toContain('More');
    expect(
      root.querySelector('#backend-notes-disclosure')?.children[0]?.textContent,
    ).toContain('More');
    expect(
      root.querySelector('#backend-notes-disclosure summary')?.tagName,
    ).toBe('SUMMARY');
    expect(
      root.querySelector('#api-reference-list article details summary')
        ?.textContent,
    ).toContain('Show request and response');
    expect(root.querySelector('#backend-notes-list li')?.tagName).toBe('LI');
  });

  it('renders explicit failure reasons for cors and webauthn guidance', async () => {
    const { buildDemoContent } = await import('../../demo/content.js');
    const { renderContentState } = await import('../../demo/main.js');
    const root = createRenderRoot();
    const content = buildDemoContent(sampleSetupState);

    renderContentState(root, sampleSetupState, content);

    expect(root.querySelector('#setup-warning')?.textContent).toContain(
      '--origin',
    );
    expect(root.querySelector('#register-output')?.textContent).toContain(
      'localhost or an HTTPS domain',
    );
    expect(root.querySelector('#authenticate-output')?.textContent).toContain(
      'localhost or an HTTPS domain',
    );
  });

  it('hydrates the visible sdk origin input from resolved setup state', async () => {
    const { createDemoRuntime } = await import('../../demo/main.js');
    const root = createRenderRoot();
    const runtime = createDemoRuntime({
      root,
      setupState: sampleSetupState,
      history: { replaceState() {} },
      localStorage: createStorage(),
      location: new URL('https://docs.example.com/demo/'),
      windowObject: {
        location: { reload() {} },
        PublicKeyCredential: undefined,
      },
    });

    runtime.hydrateState();

    expect(root.querySelector('#sdk-origin-input')?.value).toBe(
      'https://auth.example.com',
    );
  });
});

function createRenderRoot(): FakeRenderRoot {
  const elements = new Map<string, FakeElement>();
  const makeElement = (id: string) => {
    const tagName =
      id.includes('list') || id === 'hero-capabilities' ? 'ul' : 'div';
    const element = createElement(tagName, id);
    elements.set(`#${id}`, element);
    return element;
  };

  makeElement('hero-title');
  makeElement('hero-value-prop');
  makeElement('hero-audience');
  makeElement('hero-capabilities');
  makeElement('sdk-origin-input');
  makeElement('base-url');
  makeElement('email');
  makeElement('otp-code');
  makeElement('access-token');
  makeElement('refresh-token');
  makeElement('request-id');
  makeElement('latest-request');
  makeElement('latest-response');
  makeElement('origin-command');
  makeElement('sdk-script-snippet');
  makeElement('jose-snippet');
  makeElement('config-error');
  makeElement('setup-warning');
  makeElement('page-origin');
  makeElement('page-rp-id');
  makeElement('how-it-works-list');
  makeElement('api-reference-list');
  makeElement('backend-notes-list');
  const backendNotesDisclosure = createElement(
    'details',
    'backend-notes-disclosure',
  );
  const backendNotesSummary = createElement('summary');
  backendNotesDisclosure.appendChild(backendNotesSummary);
  elements.set('#backend-notes-disclosure', backendNotesDisclosure);
  makeElement('deployment-notes-list');
  makeElement('known-issues-list');
  makeElement('register-output');
  makeElement('authenticate-output');
  makeElement('email-start-button');
  makeElement('email-verify-button');
  makeElement('register-button');
  makeElement('authenticate-button');
  makeElement('clear-state-button');
  makeElement('status-config');
  makeElement('status-email-start');
  makeElement('status-email-verify');
  makeElement('status-register');
  makeElement('status-authenticate');

  return {
    createElement,
    querySelector(selector: string) {
      if (elements.has(selector)) {
        return elements.get(selector) ?? null;
      }

      const parts = selector.split(' ');
      const rootSelector = parts.shift() ?? '';
      const rootElement = elements.get(rootSelector);
      if (!rootElement) {
        return null;
      }

      return queryWithin(rootElement, parts);
    },
    querySelectorAll(selector: string) {
      const parts = selector.split(' ');
      const rootSelector = parts.shift() ?? '';
      const rootElement = elements.get(rootSelector);
      if (!rootElement) {
        return [];
      }

      return queryAllWithin(rootElement, parts);
    },
  };

  function createElement(tagName: string, id = ''): FakeElement {
    return {
      id,
      tagName: tagName.toUpperCase(),
      hidden: false,
      textContent: '',
      innerHTML: '',
      className: '',
      value: '',
      children: [],
      append(...nodes: FakeNode[]) {
        this.children.push(...nodes);
        syncText(this);
      },
      appendChild(node: FakeNode) {
        this.children.push(node);
        syncText(this);
        return node;
      },
      replaceChildren(...nodes: FakeNode[]) {
        this.children = [...nodes];
        syncText(this);
      },
    };
  }

  function queryWithin(
    element: FakeElement,
    selectors: string[],
  ): FakeElement | null {
    return queryAllWithin(element, selectors)[0] ?? null;
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

  function walk(element: FakeElement, visit: (element: FakeElement) => void) {
    for (const child of element.children) {
      visit(child);
      walk(child, visit);
    }
  }

  function syncText(element: FakeElement) {
    element.textContent = [
      element.innerHTML,
      ...element.children.map((child) => child.textContent),
    ]
      .filter(Boolean)
      .join('\n');
  }
}

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

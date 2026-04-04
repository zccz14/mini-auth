import { beforeEach, describe, expect, it } from 'vitest';

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
    delete globalThis.window;
    delete globalThis.document;
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
    expect(
      root.querySelector('#api-reference-list article details summary')
        ?.textContent,
    ).toContain('Show request and response');
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
});

function createRenderRoot() {
  const elements = new Map();
  const makeElement = (id) => {
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

  return {
    createElement,
    querySelector(selector) {
      if (elements.has(selector)) {
        return elements.get(selector) ?? null;
      }

      const parts = selector.split(' ');
      const rootSelector = parts.shift();
      const rootElement = elements.get(rootSelector);
      if (!rootElement) {
        return null;
      }

      return queryWithin(rootElement, parts);
    },
    querySelectorAll(selector) {
      const parts = selector.split(' ');
      const rootSelector = parts.shift();
      const rootElement = elements.get(rootSelector);
      if (!rootElement) {
        return [];
      }

      return queryAllWithin(rootElement, parts);
    },
  };

  function createElement(tagName, id = '') {
    return {
      id,
      tagName: tagName.toUpperCase(),
      hidden: false,
      textContent: '',
      innerHTML: '',
      children: [],
      append(...nodes) {
        this.children.push(...nodes);
        syncText(this);
      },
      appendChild(node) {
        this.children.push(node);
        syncText(this);
        return node;
      },
      replaceChildren(...nodes) {
        this.children = [...nodes];
        syncText(this);
      },
    };
  }

  function queryWithin(element, selectors) {
    return queryAllWithin(element, selectors)[0] ?? null;
  }

  function queryAllWithin(element, selectors) {
    if (selectors.length === 0) {
      return [element];
    }

    const [selector, ...rest] = selectors;
    const matcher = selector.replace(':last-of-type', '');
    const matches = [];
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

  function walk(element, visit) {
    for (const child of element.children) {
      visit(child);
      walk(child, visit);
    }
  }

  function syncText(element) {
    element.textContent = [
      element.innerHTML,
      ...element.children.map((child) => child.textContent),
    ]
      .filter(Boolean)
      .join('\n');
  }
}

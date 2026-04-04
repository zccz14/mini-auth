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

    expect(root.querySelector('#api-reference-list')?.textContent).toContain(
      '/email/start',
    );
    expect(root.querySelector('#api-reference-list')?.textContent).toContain(
      '/jwks',
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
      root.querySelector('#backend-notes-disclosure-summary')?.textContent,
    ).toContain('More');
    expect(root.querySelector('#api-reference-list')?.textContent).toContain(
      'Show request and response',
    );
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
    const element = {
      id,
      hidden: false,
      textContent: '',
      innerHTML: '',
    };
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
  makeElement('backend-notes-disclosure-summary');
  makeElement('deployment-notes-list');
  makeElement('known-issues-list');
  makeElement('register-output');
  makeElement('authenticate-output');

  return {
    querySelector(selector) {
      return elements.get(selector) ?? null;
    },
  };
}

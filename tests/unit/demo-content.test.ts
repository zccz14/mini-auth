import { describe, expect, it } from 'vitest';
import { buildDemoContent } from '../../demo/content.js';

const sampleState = {
  currentOrigin: 'https://docs.example.com',
  sdkOrigin: 'https://auth.example.com',
  sdkScriptUrl: 'https://auth.example.com/sdk/singleton-iife.js',
  issuer: 'https://auth.example.com',
  jwksUrl: 'https://auth.example.com/jwks',
  suggestedOrigin: 'https://docs.example.com',
  suggestedRpId: 'auth.example.com',
  startupCommand:
    'mini-auth start ./mini-auth.sqlite --issuer https://auth.example.com --origin https://docs.example.com --rp-id auth.example.com',
};

describe('demo content builders', () => {
  it('builds sdk script and jose snippets from the shared setup state', () => {
    const content = buildDemoContent(sampleState);

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
      'DELETE /webauthn/credentials/cred_123',
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
          detailsLabel: expect.any(String),
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

  it('includes github pages and custom domain deployment notes', () => {
    const content = buildDemoContent(sampleState);

    expect(content.deploymentNotes.join('\n')).toContain('GitHub Pages');
    expect(content.deploymentNotes.join('\n')).toContain('CNAME');
    expect(content.deploymentNotes.join('\n')).toContain('--origin');
  });

  it('keeps api examples aligned with the server auth contracts', () => {
    const content = buildDemoContent(sampleState);
    const byPath = new Map(
      content.apiReference.map((entry) => [entry.path, entry]),
    );

    expect(byPath.get('/me')?.request).toContain('authorization');
    expect(byPath.get('/me')?.response).toContain('user_id');
    expect(byPath.get('/me')?.response).toContain('webauthn_credentials');
    expect(byPath.get('/me')?.response).toContain('active_sessions');
    expect(byPath.get('/email/verify')?.response).toContain('access_token');
    expect(byPath.get('/email/verify')?.response).toContain('refresh_token');
    expect(byPath.get('/session/refresh')?.request).toContain('refresh_token');
    expect(byPath.get('/session/logout')?.request).toContain('authorization');
    expect(byPath.get('/session/logout')?.request).not.toContain(
      'refreshToken',
    );
    expect(byPath.get('/webauthn/register/options')?.request).toContain(
      'authorization',
    );
    expect(byPath.get('/webauthn/register/options')?.request).not.toContain(
      'user@example.com',
    );
    expect(byPath.get('/webauthn/register/options')?.response).toContain(
      'request_id',
    );
    expect(byPath.get('/webauthn/register/options')?.response).toContain(
      'publicKey',
    );
    expect(byPath.get('/webauthn/register/options')?.response).toContain(
      'authenticatorSelection',
    );
    expect(byPath.get('/webauthn/register/verify')?.request).toContain(
      'request_id',
    );
    expect(byPath.get('/webauthn/register/verify')?.request).toContain(
      'authorization',
    );
    expect(byPath.get('/webauthn/register/verify')?.request).toContain(
      'credential',
    );
    expect(byPath.get('/webauthn/authenticate/options')?.response).toContain(
      'request_id',
    );
    expect(byPath.get('/webauthn/authenticate/options')?.response).toContain(
      'publicKey',
    );
    expect(byPath.get('/webauthn/authenticate/options')?.response).toContain(
      'rpId',
    );
    expect(
      byPath.get('/webauthn/authenticate/options')?.response,
    ).not.toContain('allowCredentials');
    expect(byPath.get('/webauthn/authenticate/verify')?.request).toContain(
      'request_id',
    );
    expect(byPath.get('/webauthn/authenticate/verify')?.request).toContain(
      'credential',
    );
    expect(byPath.get('/webauthn/credentials/cred_123')?.request).toContain(
      'authorization',
    );
    expect(byPath.get('/webauthn/credentials/cred_123')?.response).toContain(
      'ok',
    );
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

    expect(content.apiReference.every((entry) => entry.detailsLabel)).toBe(
      true,
    );
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
});

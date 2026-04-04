import { describe, expect, it } from 'vitest';
import { getDemoSetupState as getDemoSetupStateUntyped } from '../../demo/setup.js';

const getDemoSetupState = getDemoSetupStateUntyped as (locationLike: {
  origin: string;
  protocol: string;
  hostname: string;
  sdkOriginInput?: string;
  sdkUrl?: string;
}) => {
  currentOrigin: string;
  suggestedOrigin: string;
  sdkOrigin: string;
  sdkScriptUrl: string;
  issuer: string;
  jwksUrl: string;
  configStatus: string;
  configError: string;
  corsWarning: string;
  startupCommand: string;
};

describe('demo WebAuthn setup guidance', () => {
  it('derives page origin and sdk endpoints from allowed inputs without passkey precheck fields', () => {
    const state = getDemoSetupState({
      origin: 'https://docs.example.com',
      protocol: 'https:',
      hostname: 'docs.example.com',
      sdkOriginInput: 'https://auth.example.com',
    });

    expect(state).toEqual(
      expect.objectContaining({
        currentOrigin: 'https://docs.example.com',
        suggestedOrigin: 'https://docs.example.com',
        sdkOrigin: 'https://auth.example.com',
        sdkScriptUrl: 'https://auth.example.com/sdk/singleton-iife.js',
        issuer: 'https://auth.example.com',
        jwksUrl: 'https://auth.example.com/jwks',
        startupCommand:
          'auth-mini start ./auth-mini.sqlite --issuer https://auth.example.com --origin https://docs.example.com',
      }),
    );
    expect(state).not.toHaveProperty('currentRpId');
    expect(state).not.toHaveProperty('suggestedRpId');
    expect(state).not.toHaveProperty('webauthnReady');
    expect(state).not.toHaveProperty('passkeyWarning');
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

  it('rejects sdk-origin values with credentials', () => {
    expect(
      getDemoSetupState({
        origin: 'https://docs.example.com',
        protocol: 'https:',
        hostname: 'docs.example.com',
        sdkOriginInput: 'https://user:secret@auth.example.com',
      }),
    ).toEqual(
      expect.objectContaining({
        configError: expect.stringContaining('sdk-origin must be an origin'),
        sdkOrigin: '',
        startupCommand: '',
      }),
    );
  });

  it('rejects sdk-origin values with unsupported schemes', () => {
    expect(
      getDemoSetupState({
        origin: 'https://docs.example.com',
        protocol: 'https:',
        hostname: 'docs.example.com',
        sdkOriginInput: 'ftp://auth.example.com',
      }),
    ).toEqual(
      expect.objectContaining({
        configError: expect.stringContaining('sdk-origin must be an origin'),
        sdkOrigin: '',
        startupCommand: '',
      }),
    );
  });

  it('blocks runtime when sdk-origin is explicitly present but empty', () => {
    expect(
      getDemoSetupState({
        origin: 'https://docs.example.com',
        protocol: 'https:',
        hostname: 'docs.example.com',
        sdkOriginInput: '',
      }),
    ).toEqual(
      expect.objectContaining({
        configError: expect.stringContaining('sdk-origin must be an origin'),
        startupCommand: '',
        sdkOrigin: '',
      }),
    );
  });

  it('keeps ?sdk-origin as the only supported external config input', () => {
    const state = getDemoSetupState({
      origin: 'https://auth-mini.example.com',
      protocol: 'https:',
      hostname: 'auth-mini.example.com',
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

  it('derives the auth server origin recommendation from window.location.origin', () => {
    expect(
      getDemoSetupState({
        origin: 'http://localhost:8080',
        protocol: 'http:',
        hostname: 'localhost',
      }),
    ).toEqual(
      expect.objectContaining({
        currentOrigin: 'http://localhost:8080',
        suggestedOrigin: 'http://localhost:8080',
        corsWarning:
          'Start auth-mini with --origin set to this page origin so the browser can call the auth server cross-origin.',
      }),
    );
    expect(
      getDemoSetupState({
        origin: 'http://localhost:8080',
        protocol: 'http:',
        hostname: 'localhost',
      }),
    ).not.toHaveProperty('currentRpId');
  });

  it('includes the resolved auth server origin in the startup command without rp id', () => {
    expect(
      getDemoSetupState({
        origin: 'http://localhost:8080',
        protocol: 'http:',
        hostname: 'localhost',
        sdkUrl: 'http://127.0.0.1:7777/sdk/singleton-iife.js',
      }),
    ).toEqual(
      expect.objectContaining({
        startupCommand:
          'auth-mini start ./auth-mini.sqlite --issuer http://127.0.0.1:7777 --origin http://localhost:8080',
      }),
    );
  });

  it('blocks runtime when sdk url derivation fails', () => {
    expect(
      getDemoSetupState({
        origin: 'http://localhost:8080',
        protocol: 'http:',
        hostname: 'localhost',
        sdkUrl: 'not-a-valid-url',
      }),
    ).toEqual(
      expect.objectContaining({
        configError: expect.stringContaining('sdk-origin must be an origin'),
        startupCommand: '',
      }),
    );
  });

  it('blocks runtime when sdk config is missing and cannot be derived', () => {
    expect(
      getDemoSetupState({
        origin: 'http://localhost:8080',
        protocol: 'http:',
        hostname: 'localhost',
      }),
    ).toEqual(
      expect.objectContaining({
        configStatus: 'waiting',
        configError: expect.stringContaining('Add ?sdk-origin='),
        startupCommand: '',
      }),
    );
  });

  it('does not return a proxy command anymore', () => {
    expect(
      getDemoSetupState({
        origin: 'http://localhost:8080',
        protocol: 'http:',
        hostname: 'localhost',
      }),
    ).not.toHaveProperty('proxyCommand');
  });

  it('keeps ip-address hosts on the smaller setup contract', () => {
    expect(
      getDemoSetupState({
        origin: 'http://127.0.0.1:8080',
        protocol: 'http:',
        hostname: '127.0.0.1',
      }),
    ).toEqual(
      expect.objectContaining({
        suggestedOrigin: 'http://127.0.0.1:8080',
        configStatus: 'waiting',
        configError: expect.stringContaining('Add ?sdk-origin='),
        corsWarning:
          'Start auth-mini with --origin set to this page origin so the browser can call the auth server cross-origin.',
      }),
    );
  });
});

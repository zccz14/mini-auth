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
  currentRpId: string;
  suggestedOrigin: string;
  suggestedRpId: string;
  sdkOrigin: string;
  sdkScriptUrl: string;
  issuer: string;
  jwksUrl: string;
  configError: string;
  webauthnReady: boolean;
  corsWarning: string;
  passkeyWarning: string;
  startupCommand: string;
};

describe('demo WebAuthn setup guidance', () => {
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
        webauthnReady: false,
      }),
    );
  });

  it('warns when page origin is incompatible with the derived rp id', () => {
    expect(
      getDemoSetupState({
        origin: 'https://docs.example.com',
        protocol: 'https:',
        hostname: 'docs.example.com',
        sdkOriginInput: 'https://auth.example.com',
      }),
    ).toEqual(
      expect.objectContaining({
        webauthnReady: false,
        passkeyWarning:
          'This page origin is not compatible with the suggested RP ID auth.example.com. Open the demo on that domain or a subdomain of it before passkeys will work.',
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
          'Start mini-auth with --origin set to this page origin so the browser can call the auth server cross-origin.',
      }),
    );
  });

  it('includes the resolved auth server origin and derived rp id in the startup command', () => {
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
          'mini-auth start ./mini-auth.sqlite --issuer http://127.0.0.1:7777 --origin http://localhost:8080 --rp-id 127.0.0.1',
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
        suggestedRpId: '',
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
        configError: expect.stringContaining('sdk-origin must be an origin'),
        suggestedRpId: '',
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

  it('rejects IP-address hosts for passkey setup', () => {
    expect(
      getDemoSetupState({
        origin: 'http://127.0.0.1:8080',
        protocol: 'http:',
        hostname: '127.0.0.1',
      }),
    ).toEqual(
      expect.objectContaining({
        webauthnReady: false,
        suggestedOrigin: 'http://127.0.0.1:8080',
        suggestedRpId: '',
        configError: expect.stringContaining('sdk-origin must be an origin'),
        corsWarning:
          'Start mini-auth with --origin set to this page origin so the browser can call the auth server cross-origin.',
        passkeyWarning: '',
      }),
    );
  });

  it('blocks passkey-ready guidance when sdk-origin resolves to an ip host', () => {
    expect(
      getDemoSetupState({
        origin: 'https://docs.example.com',
        protocol: 'https:',
        hostname: 'docs.example.com',
        sdkOriginInput: 'https://127.0.0.1:7777',
      }),
    ).toEqual(
      expect.objectContaining({
        webauthnReady: false,
        suggestedRpId: '127.0.0.1',
        passkeyWarning:
          'This demo is configured against an IP-address auth server. Passkeys require a domain RP ID, so use a localhost or HTTPS domain sdk-origin instead.',
      }),
    );
  });

  it('rejects https ipv4 hosts for passkey setup and falls back to localhost guidance', () => {
    expect(
      getDemoSetupState({
        origin: 'https://127.0.0.1:8443',
        protocol: 'https:',
        hostname: '127.0.0.1',
      }),
    ).toEqual(
      expect.objectContaining({
        webauthnReady: false,
        suggestedOrigin: 'https://127.0.0.1:8443',
        suggestedRpId: '',
        configError: expect.stringContaining('sdk-origin must be an origin'),
        passkeyWarning: '',
      }),
    );
  });

  it('rejects bracketed https ipv6 hosts for passkey setup and falls back to localhost guidance', () => {
    expect(
      getDemoSetupState({
        origin: 'https://[::1]:8443',
        protocol: 'https:',
        hostname: '[::1]',
      }),
    ).toEqual(
      expect.objectContaining({
        webauthnReady: false,
        suggestedOrigin: 'https://[::1]:8443',
        suggestedRpId: '',
        configError: expect.stringContaining('sdk-origin must be an origin'),
        passkeyWarning: '',
      }),
    );
  });

  it('accepts localhost for local passkey testing when rp id matches', () => {
    expect(
      getDemoSetupState({
        origin: 'http://localhost:8080',
        protocol: 'http:',
        hostname: 'localhost',
        sdkOriginInput: 'http://localhost:7777',
      }),
    ).toEqual(
      expect.objectContaining({
        webauthnReady: true,
        suggestedOrigin: 'http://localhost:8080',
        suggestedRpId: 'localhost',
        passkeyWarning: '',
      }),
    );
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  countLogoutCalls,
  countRefreshCalls,
  createMiniAuthForTest,
  fakeAlmostExpiredStorage,
  fakeAuthenticatedStorage,
  fakeAuthenticatedStorageWithMe,
  jsonResponse,
} from '../helpers/sdk.js';

describe('sdk session flows', () => {
  it('starts in recovering and settles authenticated after boot recovery', async () => {
    const sdk = createMiniAuthForTest({
      autoRecover: true,
      storage: fakeAuthenticatedStorage({
        accessToken: null,
      }),
      fetch: vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            access_token: 'a2',
            refresh_token: 'r2',
            expires_in: 900,
            token_type: 'Bearer',
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            user_id: 'u1',
            email: 'u@example.com',
            webauthn_credentials: [],
            active_sessions: [],
          }),
        ),
    });

    expect(sdk.session.getState().status).toBe('recovering');
    await sdk.ready;
    expect(sdk.session.getState().status).toBe('authenticated');
  });

  it('shares one in-flight refresh across concurrent authenticated calls', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'a2',
          refresh_token: 'r2',
          expires_in: 900,
          token_type: 'Bearer',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          user_id: 'u1',
          email: 'u@example.com',
          webauthn_credentials: [],
          active_sessions: [],
        }),
      );
    const sdk = createMiniAuthForTest({
      fetch,
      now: () => Date.parse('2026-04-03T00:02:00.000Z'),
      storage: fakeAuthenticatedStorage({
        receivedAt: '2026-04-03T00:00:00.000Z',
        expiresAt: '2026-04-03T00:03:00.000Z',
      }),
    });

    await Promise.all([sdk.me.reload(), sdk.me.reload()]);
    expect(countRefreshCalls(fetch)).toBe(1);
  });

  it('refresh success also reloads me', async () => {
    const sdk = createMiniAuthForTest({
      storage: fakeAuthenticatedStorage(),
      fetch: vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            access_token: 'a2',
            refresh_token: 'r2',
            expires_in: 900,
            token_type: 'Bearer',
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            user_id: 'u1',
            email: 'u@example.com',
            webauthn_credentials: [],
            active_sessions: [],
          }),
        ),
    });

    await sdk.session.refresh();
    expect(sdk.me.get()?.email).toBe('u@example.com');
  });

  it('preserves authenticated state when refresh fails with a transient 5xx error', async () => {
    const sdk = createMiniAuthForTest({
      storage: fakeAuthenticatedStorageWithMe(),
      fetch: vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ error: 'internal_error' }, 500)),
    });

    await expect(sdk.session.refresh()).rejects.toMatchObject({
      error: 'internal_error',
    });
    expect(sdk.session.getState()).toMatchObject({
      status: 'recovering',
      refreshToken: 'refresh-token',
      accessToken: 'access-token',
    });
    expect(sdk.me.get()?.email).toBe('u@example.com');
  });

  it('me.get returns cached state synchronously', () => {
    const sdk = createMiniAuthForTest({
      storage: fakeAuthenticatedStorageWithMe(),
    });

    expect(sdk.me.get()?.email).toBe('u@example.com');
  });

  it('me.reload fetches and updates cached me', async () => {
    const sdk = createMiniAuthForTest({
      storage: fakeAuthenticatedStorageWithMe(),
      fetch: vi.fn().mockResolvedValueOnce(
        jsonResponse({
          user_id: 'u1',
          email: 'updated@example.com',
          webauthn_credentials: [],
          active_sessions: [],
        }),
      ),
    });

    const me = await sdk.me.reload();
    expect(me.email).toBe('updated@example.com');
    expect(sdk.me.get()?.email).toBe('updated@example.com');
  });

  it('preserves recoverable state when refresh succeeds but me reload fails transiently', async () => {
    const sdk = createMiniAuthForTest({
      storage: fakeAuthenticatedStorage(),
      fetch: vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            access_token: 'a2',
            refresh_token: 'r2',
            expires_in: 900,
            token_type: 'Bearer',
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ error: 'internal_error' }, 500)),
    });

    await expect(sdk.session.refresh()).rejects.toMatchObject({
      error: 'internal_error',
    });
    expect(sdk.session.getState()).toMatchObject({
      status: 'recovering',
      accessToken: 'a2',
      refreshToken: 'r2',
    });
  });

  it('clears state and emits anonymous when refresh token is rejected', async () => {
    const sdk = createMiniAuthForTest({
      storage: fakeAuthenticatedStorage(),
      fetch: vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ error: 'invalid_refresh_token' }, 401),
        ),
    });
    const listener = vi.fn();

    sdk.session.onChange(listener);
    await expect(sdk.session.refresh()).rejects.toMatchObject({
      error: 'invalid_refresh_token',
    });
    expect(sdk.session.getState().status).toBe('anonymous');
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'anonymous' }),
    );
  });

  it('preserves recoverable state when boot me reload fails transiently', async () => {
    const sdk = createMiniAuthForTest({
      autoRecover: true,
      storage: fakeAuthenticatedStorageWithMe(),
      fetch: vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ error: 'internal_error' }, 500)),
    });

    await expect(sdk.ready).resolves.toBeUndefined();
    expect(sdk.session.getState()).toMatchObject({
      status: 'recovering',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    expect(sdk.me.get()?.email).toBe('u@example.com');
  });

  it('treats invalid persisted timestamps as needing refresh during recovery', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'a2',
          refresh_token: 'r2',
          expires_in: 900,
          token_type: 'Bearer',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          user_id: 'u1',
          email: 'u@example.com',
          webauthn_credentials: [],
          active_sessions: [],
        }),
      );
    const sdk = createMiniAuthForTest({
      autoRecover: true,
      fetch,
      storage: fakeAuthenticatedStorageWithMe(undefined, {
        receivedAt: 'not-a-date',
        expiresAt: 'still-not-a-date',
      }),
    });

    await sdk.ready;
    expect(countRefreshCalls(fetch)).toBe(1);
    expect(sdk.session.getState()).toMatchObject({
      status: 'authenticated',
      accessToken: 'a2',
      refreshToken: 'r2',
    });
  });

  it('logout clears local state even when remote logout fails', async () => {
    const sdk = createMiniAuthForTest({
      storage: fakeAuthenticatedStorage(),
      fetch: vi.fn().mockRejectedValueOnce(new Error('network down')),
    });

    await expect(sdk.session.logout()).resolves.toBeUndefined();
    expect(sdk.session.getState().status).toBe('anonymous');
  });

  it('logout refreshes first when access token is near expiry', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'a2',
          refresh_token: 'r2',
          expires_in: 900,
          token_type: 'Bearer',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          user_id: 'u1',
          email: 'u@example.com',
          webauthn_credentials: [],
          active_sessions: [],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const sdk = createMiniAuthForTest({
      storage: fakeAlmostExpiredStorage(),
      fetch,
      now: () => Date.parse('2026-04-03T00:02:00.000Z'),
    });

    await sdk.session.logout();
    expect(countRefreshCalls(fetch)).toBe(1);
    expect(countLogoutCalls(fetch)).toBe(1);
  });
});

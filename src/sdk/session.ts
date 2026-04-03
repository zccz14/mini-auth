import { createSdkError } from './errors.js';
import type { HttpClient } from './http.js';
import type { SessionSnapshot, SessionResult, SessionTokens } from './types.js';

type StateStore = {
  getState(): SessionSnapshot;
  onChange(listener: (state: SessionSnapshot) => void): () => void;
  setAuthenticated(next: SessionResult): void;
  setRecovering(next: {
    accessToken: string | null;
    refreshToken: string;
    receivedAt: string;
    expiresAt: string;
    me: SessionSnapshot['me'];
  }): void;
  setAnonymous(): void;
};

export function createSessionController(input: {
  http: HttpClient;
  now: () => number;
  state: StateStore;
}) {
  let refreshPromise: Promise<SessionResult> | null = null;

  return {
    getState: () => input.state.getState(),
    onChange: (listener: (state: SessionSnapshot) => void) =>
      input.state.onChange(listener),
    async acceptSessionResponse(
      response: unknown,
      options: {
        clearOnMeFailure?: 'always' | 'auth-invalidating';
      } = {},
    ): Promise<SessionResult> {
      const session = normalizeTokenResponse(response, input.now);

      input.state.setRecovering({
        ...session,
        me: input.state.getState().me,
      });

      try {
        const me = await fetchMe(session.accessToken);
        const result = { ...session, me };

        input.state.setAuthenticated(result);
        return result;
      } catch (error) {
        if (
          options.clearOnMeFailure !== 'auth-invalidating' ||
          isAuthInvalidatingError(error)
        ) {
          input.state.setAnonymous();
        }
        throw error;
      }
    },
    async refresh(): Promise<SessionResult> {
      if (refreshPromise) {
        return refreshPromise;
      }

      const snapshot = input.state.getState();

      if (!snapshot.refreshToken) {
        throw createSdkError('missing_session', 'Missing refresh token');
      }

      refreshPromise = (async () => {
        try {
          const response = await input.http.postJson<unknown>(
            '/session/refresh',
            {
              refresh_token: snapshot.refreshToken,
            },
          );

          return await this.acceptSessionResponse(response, {
            clearOnMeFailure: 'auth-invalidating',
          });
        } catch (error) {
          if (isAuthInvalidatingError(error)) {
            input.state.setAnonymous();
          }
          throw error;
        } finally {
          refreshPromise = null;
        }
      })();

      return refreshPromise;
    },
    async recover(): Promise<void> {
      const snapshot = input.state.getState();

      if (!snapshot.refreshToken) {
        input.state.setAnonymous();
        return;
      }

      try {
        if (!snapshot.accessToken || needsRefresh(snapshot, input.now())) {
          await this.refresh();
          return;
        }

        const me = await fetchMe(snapshot.accessToken);
        input.state.setAuthenticated({
          accessToken: snapshot.accessToken,
          refreshToken: snapshot.refreshToken,
          receivedAt:
            snapshot.receivedAt ?? new Date(input.now()).toISOString(),
          expiresAt: snapshot.expiresAt ?? new Date(input.now()).toISOString(),
          me,
        });
      } catch (error) {
        if (isAuthInvalidatingError(error)) {
          input.state.setAnonymous();
        }
      }
    },
    async reloadMe(): Promise<SessionSnapshot['me']> {
      const snapshot = input.state.getState();

      if (!snapshot.refreshToken) {
        throw createSdkError('missing_session', 'Missing refresh token');
      }

      if (!snapshot.accessToken || needsRefresh(snapshot, input.now())) {
        return (await this.refresh()).me;
      }

      const me = await fetchMe(snapshot.accessToken);

      input.state.setAuthenticated({
        accessToken: snapshot.accessToken,
        refreshToken: snapshot.refreshToken,
        receivedAt: snapshot.receivedAt ?? new Date(input.now()).toISOString(),
        expiresAt: snapshot.expiresAt ?? new Date(input.now()).toISOString(),
        me,
      });

      return me;
    },
    async logout(): Promise<void> {
      const snapshot = input.state.getState();

      if (!snapshot.refreshToken && !snapshot.accessToken) {
        input.state.setAnonymous();
        return;
      }

      try {
        let accessToken = snapshot.accessToken;

        if (
          snapshot.refreshToken &&
          (!accessToken || needsRefresh(snapshot, input.now()))
        ) {
          try {
            accessToken = (await this.refresh()).accessToken;
          } catch {
            accessToken = null;
          }
        }

        if (accessToken) {
          await input.http.postJson('/session/logout', undefined, {
            accessToken,
          });
        }
      } catch {
        // Deterministic local sign-out hides remote failures.
      } finally {
        input.state.setAnonymous();
      }
    },
  };

  async function fetchMe(accessToken: string | null) {
    if (!accessToken) {
      throw createSdkError('missing_session', 'Missing access token');
    }

    return await input.http.getJson<SessionResult['me']>('/me', {
      accessToken,
    });
  }
}

export function normalizeTokenResponse(
  value: unknown,
  now: () => number,
): SessionTokens {
  if (!value || typeof value !== 'object') {
    throw createSdkError('request_failed', 'Invalid session payload');
  }

  const payload = value as Record<string, unknown>;

  if (
    typeof payload.access_token !== 'string' ||
    typeof payload.refresh_token !== 'string' ||
    typeof payload.expires_in !== 'number'
  ) {
    throw createSdkError('request_failed', 'Invalid session payload');
  }

  const receivedAtMs = now();

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    receivedAt: new Date(receivedAtMs).toISOString(),
    expiresAt: new Date(receivedAtMs + payload.expires_in * 1000).toISOString(),
  };
}

export function needsRefresh(snapshot: SessionSnapshot, now: number): boolean {
  if (!snapshot.expiresAt || !snapshot.receivedAt) {
    return true;
  }

  const expiresAt = Date.parse(snapshot.expiresAt);
  const receivedAt = Date.parse(snapshot.receivedAt);

  if (!Number.isFinite(expiresAt) || !Number.isFinite(receivedAt)) {
    return true;
  }

  return shouldRefresh(now, expiresAt, receivedAt);
}

export function shouldRefresh(
  now: number,
  expiresAt: number,
  receivedAt: number,
): boolean {
  const lifetimeMs = expiresAt - receivedAt;
  const thresholdMs = lifetimeMs < 10 * 60_000 ? lifetimeMs / 2 : 5 * 60_000;

  return now >= expiresAt - thresholdMs;
}

function isAuthInvalidatingError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    error?: unknown;
    message?: unknown;
    status?: unknown;
  };

  return (
    candidate.status === 401 ||
    candidate.error === 'invalid_refresh_token' ||
    (candidate.code === 'request_failed' &&
      candidate.message === 'request_failed: Invalid session payload')
  );
}

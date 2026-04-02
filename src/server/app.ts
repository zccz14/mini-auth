import { Hono } from 'hono';
import type { ZodType } from 'zod';
import type { DatabaseClient } from '../infra/db/client.js';
import { listPublicKeys } from '../modules/jwks/service.js';
import {
  InvalidEmailOtpError,
  SmtpDeliveryError,
  SmtpNotConfiguredError,
  startEmailAuth,
  verifyEmailAuth,
} from '../modules/email-auth/service.js';
import {
  InvalidRefreshTokenError,
  logoutSession,
  refreshSessionTokens,
} from '../modules/session/service.js';
import {
  deleteCredential,
  DuplicateCredentialError,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  InvalidWebauthnAuthenticationError,
  InvalidWebauthnRegistrationError,
  verifyAuthentication,
  verifyRegistration,
  WebauthnCredentialNotFoundError,
} from '../modules/webauthn/service.js';
import {
  getUserById,
  listActiveUserSessions,
  listUserWebauthnCredentials,
} from '../modules/users/repo.js';
import {
  emailStartSchema,
  emailVerifySchema,
  refreshSchema,
  webauthnAuthenticateVerifySchema,
  webauthnRegisterVerifySchema,
} from '../shared/http-schemas.js';
import {
  createRequestId,
  type AppLogger,
  withErrorFields,
} from '../shared/logger.js';
import { requireAccessToken, type AuthVariables } from './auth.js';
import {
  credentialNotFoundError,
  duplicateCredentialError,
  HttpError,
  invalidEmailOtpError,
  invalidRefreshTokenError,
  invalidRequestError,
  invalidWebauthnAuthenticationError,
  invalidWebauthnRegistrationError,
  smtpNotConfiguredError,
  smtpTemporarilyUnavailableError,
} from './errors.js';

type AppVariables = AuthVariables & {
  clientIp: string | null;
  db: DatabaseClient;
  issuer: string;
  logger: AppLogger;
  origins: string[];
  requestId: string;
  rpId: string;
};

export function createApp(input: {
  db: DatabaseClient;
  getClientIp?: (request: Request) => string | null;
  issuer: string;
  logger: AppLogger;
  origins: string[];
  rpId: string;
}) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use(async (c, next) => {
    const requestId = createRequestId();

    c.set('db', input.db);
    c.set('issuer', input.issuer);
    c.set('logger', input.logger.child({ request_id: requestId }));
    c.set('origins', input.origins);
    c.set('requestId', requestId);
    c.set('rpId', input.rpId);
    c.set('clientIp', input.getClientIp?.(c.req.raw) ?? null);

    await next();
  });

  app.use(async (c, next) => {
    const startedAt = Date.now();

    c.var.logger.info(
      requestLogFields(c, {
        event: 'http.request.started',
      }),
      'Request started',
    );

    try {
      await next();
    } catch (error) {
      const httpError = toHttpError(error);

      if (httpError.status === 500) {
        c.var.logger.error(
          {
            event: 'http.request.error',
            ...withErrorFields(error),
          },
          'Unhandled request error',
        );
      }

      c.res = c.json(
        { error: httpError.code },
        httpError.status as 400 | 401 | 404 | 409 | 500 | 503,
      );
    }

    c.var.logger.info(
      requestLogFields(c, {
        duration_ms: Date.now() - startedAt,
        event: 'http.request.completed',
        status_code: c.res.status,
      }),
      'Request completed',
    );
  });

  app.onError((error, c) => {
    if ('logger' in c.var) {
      const httpError = toHttpError(error);

      if (httpError.status === 500) {
        c.var.logger.error(
          {
            event: 'http.request.error',
            ...withErrorFields(error),
          },
          'Unhandled request error',
        );
      }
    }

    const httpError = toHttpError(error);
    return c.json(
      { error: httpError.code },
      httpError.status as 400 | 401 | 404 | 409 | 500 | 503,
    );
  });

  app.post('/email/start', async (c) => {
    const body = await parseJson(c.req.raw, emailStartSchema);
    const result = await startEmailAuth(c.var.db, {
      email: body.email,
      logger: c.var.logger,
      ip: c.var.clientIp,
    });

    return c.json(result);
  });

  app.post('/email/verify', async (c) => {
    const body = await parseJson(c.req.raw, emailVerifySchema);
    const result = await verifyEmailAuth(c.var.db, {
      email: body.email,
      code: body.code,
      issuer: c.var.issuer,
      logger: c.var.logger,
    });

    return c.json(result);
  });

  app.get('/me', requireAccessToken, async (c) => {
    const auth = c.var.auth;
    const user = getUserById(c.var.db, auth.sub);

    if (!user) {
      throw new HttpError(401, 'invalid_access_token');
    }

    return c.json({
      user_id: user.id,
      email: user.email,
      webauthn_credentials: listUserWebauthnCredentials(c.var.db, user.id),
      active_sessions: listActiveUserSessions(
        c.var.db,
        user.id,
        new Date().toISOString(),
      ),
    });
  });

  app.post('/session/refresh', async (c) => {
    const body = await parseJson(c.req.raw, refreshSchema);
    const result = await refreshSessionTokens(c.var.db, {
      refreshToken: body.refresh_token,
      issuer: c.var.issuer,
      logger: c.var.logger,
    });

    return c.json({
      access_token: result.access_token,
      token_type: result.token_type,
      expires_in: result.expires_in,
      refresh_token: result.refresh_token,
    });
  });

  app.post('/session/logout', requireAccessToken, async (c) => {
    logoutSession(c.var.db, {
      sessionId: c.var.auth.sid,
      userId: c.var.auth.sub,
      logger: c.var.logger,
    });
    return c.json({ ok: true });
  });

  app.post('/webauthn/register/options', requireAccessToken, async (c) => {
    const user = getUserById(c.var.db, c.var.auth.sub);

    if (!user) {
      throw new HttpError(401, 'invalid_access_token');
    }

    return c.json(
      await generateRegistrationOptions(c.var.db, {
        userId: user.id,
        email: user.email,
        rpId: c.var.rpId,
        logger: c.var.logger,
      }),
    );
  });

  app.post('/webauthn/register/verify', requireAccessToken, async (c) => {
    const body = await parseJson(c.req.raw, webauthnRegisterVerifySchema);

    return c.json(
      await verifyRegistration(c.var.db, {
        userId: c.var.auth.sub,
        requestId: body.request_id,
        credential: body.credential,
        rpId: c.var.rpId,
        origins: c.var.origins,
        logger: c.var.logger,
      }),
    );
  });

  app.post('/webauthn/authenticate/options', async (c) => {
    return c.json(
      await generateAuthenticationOptions(c.var.db, {
        rpId: c.var.rpId,
        logger: c.var.logger,
      }),
    );
  });

  app.post('/webauthn/authenticate/verify', async (c) => {
    const body = await parseJson(c.req.raw, webauthnAuthenticateVerifySchema);
    const result = await verifyAuthentication(c.var.db, {
      requestId: body.request_id,
      credential: body.credential,
      rpId: c.var.rpId,
      origins: c.var.origins,
      issuer: c.var.issuer,
      logger: c.var.logger,
    });

    return c.json({
      access_token: result.access_token,
      token_type: result.token_type,
      expires_in: result.expires_in,
      refresh_token: result.refresh_token,
    });
  });

  app.delete('/webauthn/credentials/:id', requireAccessToken, async (c) => {
    return c.json(
      deleteCredential(c.var.db, {
        credentialId: c.req.param('id'),
        userId: c.var.auth.sub,
      }),
    );
  });

  app.get('/jwks', async (c) => {
    const keys = await listPublicKeys(c.var.db, { logger: c.var.logger });
    return c.json({ keys });
  });

  return app;
}

async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw invalidRequestError();
  }

  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    throw invalidRequestError();
  }

  return parsed.data;
}

function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }

  if (error instanceof SmtpNotConfiguredError) {
    return smtpNotConfiguredError();
  }

  if (error instanceof SmtpDeliveryError) {
    return smtpTemporarilyUnavailableError();
  }

  if (error instanceof InvalidEmailOtpError) {
    return invalidEmailOtpError();
  }

  if (error instanceof InvalidRefreshTokenError) {
    return invalidRefreshTokenError();
  }

  if (error instanceof InvalidWebauthnRegistrationError) {
    return invalidWebauthnRegistrationError();
  }

  if (error instanceof InvalidWebauthnAuthenticationError) {
    return invalidWebauthnAuthenticationError();
  }

  if (error instanceof DuplicateCredentialError) {
    return duplicateCredentialError();
  }

  if (error instanceof WebauthnCredentialNotFoundError) {
    return credentialNotFoundError();
  }

  return new HttpError(500, 'internal_error');
}

function requestLogFields(
  c: {
    req: { method: string; path: string; routePath: string };
    var: AppVariables;
  },
  fields: {
    event: 'http.request.started' | 'http.request.completed';
    status_code?: number;
    duration_ms?: number;
  },
): Record<string, unknown> {
  const route = toRouteField(c.req.routePath);

  return {
    event: fields.event,
    method: c.req.method,
    path: c.req.path,
    ...(route ? { route } : {}),
    ...(fields.status_code !== undefined
      ? { status_code: fields.status_code }
      : {}),
    ...(fields.duration_ms !== undefined
      ? { duration_ms: fields.duration_ms }
      : {}),
    ...(c.var.clientIp ? { ip: c.var.clientIp } : {}),
  };
}

function toRouteField(routePath: string): string | undefined {
  if (!routePath || routePath === '*' || routePath === '/*') {
    return undefined;
  }

  return routePath;
}

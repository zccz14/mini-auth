import {
  generateAuthenticationOptions as generateSimpleWebAuthnAuthenticationOptions,
  generateRegistrationOptions as generateSimpleWebAuthnRegistrationOptions,
  verifyAuthenticationResponse as verifySimpleWebAuthnAuthenticationResponse,
  verifyRegistrationResponse as verifySimpleWebAuthnRegistrationResponse,
} from '@simplewebauthn/server';
import type { DatabaseClient } from '../../infra/db/client.js';
import { decodeBase64Url, encodeBase64Url } from '../../shared/crypto.js';
import type { AppLogger } from '../../shared/logger.js';
import { TTLS } from '../../shared/time.js';
import { mintSessionTokens } from '../session/service.js';
import {
  consumeChallengeAndUpdateCredentialCounter,
  consumeChallenge,
  consumeUnusedRegistrationChallengesForUser,
  createChallenge,
  createCredential,
  deleteCredentialById,
  getChallengeByRequestId,
  getCredentialByCredentialId,
} from './repo.js';

type ParsedCredential = {
  id: string;
  rawId: string;
  type: 'public-key';
};

type RegistrationCredential = ParsedCredential & {
  clientExtensionResults: Record<string, unknown>;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
  };
};

type AuthenticationCredential = ParsedCredential & {
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string | null;
  };
};

export class InvalidWebauthnRegistrationError extends Error {
  constructor() {
    super('invalid_webauthn_registration');
  }
}

export class InvalidWebauthnAuthenticationError extends Error {
  constructor() {
    super('invalid_webauthn_authentication');
  }
}

export class DuplicateCredentialError extends Error {
  constructor() {
    super('duplicate_credential');
  }
}

export class WebauthnCredentialNotFoundError extends Error {
  constructor() {
    super('credential_not_found');
  }
}

export async function generateRegistrationOptions(
  db: DatabaseClient,
  input: { userId: string; email: string; rpId: string; logger?: AppLogger },
): Promise<{
  request_id: string;
  publicKey: {
    challenge: string;
    rp: { name: 'mini-auth'; id: string };
    user: { id: string; name: string; displayName: string };
    pubKeyCredParams: Array<{ type: 'public-key'; alg: -7 | -257 }>;
    timeout: number;
    authenticatorSelection: {
      residentKey: 'required';
      userVerification: 'preferred';
    };
  };
}> {
  const options = await generateSimpleWebAuthnRegistrationOptions({
    rpName: 'mini-auth',
    rpID: input.rpId,
    userName: input.email,
    userID: Buffer.from(input.userId, 'utf8'),
    userDisplayName: input.email,
    timeout: 300000,
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'preferred',
    },
    supportedAlgorithmIDs: [-7, -257],
  });

  consumeUnusedRegistrationChallengesForUser(
    db,
    input.userId,
    new Date().toISOString(),
  );
  const expiresAt = new Date(
    Date.now() + TTLS.webauthnChallengeSeconds * 1000,
  ).toISOString();
  const record = createChallenge(db, {
    type: 'register',
    challenge: options.challenge,
    userId: input.userId,
    expiresAt,
  });

  const response: {
    request_id: string;
    publicKey: {
      challenge: string;
      rp: { name: 'mini-auth'; id: string };
      user: { id: string; name: string; displayName: string };
      pubKeyCredParams: Array<{ type: 'public-key'; alg: -7 | -257 }>;
      timeout: number;
      authenticatorSelection: {
        residentKey: 'required';
        userVerification: 'preferred';
      };
    };
  } = {
    request_id: record.requestId,
    publicKey: {
      challenge: options.challenge,
      rp: {
        name: 'mini-auth',
        id: input.rpId,
      },
      user: {
        id: options.user.id,
        name: input.email,
        displayName: input.email,
      },
      pubKeyCredParams: options.pubKeyCredParams as Array<{
        type: 'public-key';
        alg: -7 | -257;
      }>,
      timeout: 300000,
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'preferred',
      },
    },
  };

  input.logger?.info(
    {
      event: 'webauthn.register.options.created',
      request_id: record.requestId,
      user_id: input.userId,
    },
    'WebAuthn registration options created',
  );

  return response;
}

export async function verifyRegistration(
  db: DatabaseClient,
  input: {
    userId: string;
    requestId: string;
    credential: RegistrationCredential;
    rpId: string;
    origins: string[];
    logger?: AppLogger;
  },
): Promise<{ ok: true }> {
  try {
    const challenge = getValidChallenge(db, input.requestId, 'register');

    if (challenge.userId !== input.userId) {
      throw new InvalidWebauthnRegistrationError();
    }

    const verification = await verifySimpleWebAuthnRegistrationResponse({
      response: input.credential as Parameters<
        typeof verifySimpleWebAuthnRegistrationResponse
      >[0]['response'],
      expectedChallenge: challenge.challenge,
      expectedOrigin: input.origins,
      expectedRPID: input.rpId,
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new InvalidWebauthnRegistrationError();
    }

    const { credential } = verification.registrationInfo;

    const now = new Date().toISOString();

    if (!consumeChallenge(db, challenge.requestId, now)) {
      throw new InvalidWebauthnRegistrationError();
    }

    createCredential(db, {
      userId: input.userId,
      credentialId: credential.id,
      publicKey: encodeBase64Url(Buffer.from(credential.publicKey)),
      counter: credential.counter,
      transports: credential.transports ?? [],
    });
    input.logger?.info(
      {
        event: 'webauthn.register.verify.succeeded',
        request_id: input.requestId,
        user_id: input.userId,
        credential_id: credential.id,
      },
      'WebAuthn registration verified',
    );
  } catch (error) {
    input.logger?.warn(
      {
        event: 'webauthn.register.verify.failed',
        request_id: input.requestId,
        user_id: input.userId,
      },
      'WebAuthn registration failed',
    );
    if (isSqliteUniqueConstraint(error)) {
      throw new DuplicateCredentialError();
    }

    if (error instanceof InvalidWebauthnRegistrationError) {
      throw error;
    }

    throw new InvalidWebauthnRegistrationError();
  }

  return { ok: true };
}

export async function generateAuthenticationOptions(
  db: DatabaseClient,
  input: { rpId: string; logger?: AppLogger },
): Promise<{
  request_id: string;
  publicKey: {
    challenge: string;
    rpId: string;
    timeout: number;
    userVerification: 'preferred';
  };
}> {
  const options = await generateSimpleWebAuthnAuthenticationOptions({
    rpID: input.rpId,
    timeout: 300000,
    userVerification: 'preferred',
  });

  const expiresAt = new Date(
    Date.now() + TTLS.webauthnChallengeSeconds * 1000,
  ).toISOString();
  const record = createChallenge(db, {
    type: 'authenticate',
    challenge: options.challenge,
    userId: null,
    expiresAt,
  });

  const response: {
    request_id: string;
    publicKey: {
      challenge: string;
      rpId: string;
      timeout: number;
      userVerification: 'preferred';
    };
  } = {
    request_id: record.requestId,
    publicKey: {
      challenge: options.challenge,
      rpId: input.rpId,
      timeout: 300000,
      userVerification: 'preferred',
    },
  };

  input.logger?.info(
    {
      event: 'webauthn.authenticate.options.created',
      request_id: record.requestId,
    },
    'WebAuthn authentication options created',
  );

  return response;
}

export async function verifyAuthentication(
  db: DatabaseClient,
  input: {
    requestId: string;
    credential: AuthenticationCredential;
    rpId: string;
    origins: string[];
    issuer: string;
    logger?: AppLogger;
  },
) {
  try {
    const challenge = getValidChallenge(db, input.requestId, 'authenticate');
    const storedCredential = getCredentialByCredentialId(
      db,
      input.credential.id,
    );

    if (!storedCredential) {
      throw new InvalidWebauthnAuthenticationError();
    }

    const verification = await verifySimpleWebAuthnAuthenticationResponse({
      response: {
        ...input.credential,
        response: {
          ...input.credential.response,
          userHandle: input.credential.response.userHandle ?? undefined,
        },
        clientExtensionResults: {},
      } as Parameters<
        typeof verifySimpleWebAuthnAuthenticationResponse
      >[0]['response'],
      expectedChallenge: challenge.challenge,
      expectedOrigin: input.origins,
      expectedRPID: input.rpId,
      credential: {
        id: storedCredential.credentialId,
        publicKey: Uint8Array.from(decodeBase64Url(storedCredential.publicKey)),
        counter: storedCredential.counter,
        transports: storedCredential.transports as Parameters<
          typeof verifySimpleWebAuthnAuthenticationResponse
        >[0]['credential']['transports'],
      },
      requireUserVerification: false,
    });

    if (!verification.verified) {
      throw new InvalidWebauthnAuthenticationError();
    }

    if (
      !consumeChallengeAndUpdateCredentialCounter(db, {
        requestId: challenge.requestId,
        credentialId: storedCredential.id,
        expectedCounter: storedCredential.counter,
        nextCounter: verification.authenticationInfo.newCounter,
        now: new Date().toISOString(),
      })
    ) {
      throw new InvalidWebauthnAuthenticationError();
    }

    const tokens = await mintSessionTokens(db, {
      userId: storedCredential.userId,
      issuer: input.issuer,
      logger: input.logger,
    });

    input.logger?.info(
      {
        event: 'webauthn.authenticate.verify.succeeded',
        request_id: input.requestId,
        user_id: storedCredential.userId,
        credential_id: storedCredential.credentialId,
        session_id: tokens.session.id,
      },
      'WebAuthn authentication verified',
    );

    return tokens;
  } catch (error) {
    input.logger?.warn(
      {
        event: 'webauthn.authenticate.verify.failed',
        request_id: input.requestId,
        credential_id: input.credential.id,
      },
      'WebAuthn authentication failed',
    );

    if (error instanceof InvalidWebauthnAuthenticationError) {
      throw error;
    }

    throw new InvalidWebauthnAuthenticationError();
  }
}

export function deleteCredential(
  db: DatabaseClient,
  input: { credentialId: string; userId: string },
): { ok: true } {
  if (!deleteCredentialById(db, input.credentialId, input.userId)) {
    throw new WebauthnCredentialNotFoundError();
  }

  return { ok: true };
}

function getValidChallenge(
  db: DatabaseClient,
  requestId: string,
  type: 'register' | 'authenticate',
) {
  const challenge = getChallengeByRequestId(db, requestId);
  const now = new Date().toISOString();

  if (
    !challenge ||
    challenge.type !== type ||
    challenge.consumedAt ||
    challenge.expiresAt <= now
  ) {
    if (type === 'register') {
      throw new InvalidWebauthnRegistrationError();
    }

    throw new InvalidWebauthnAuthenticationError();
  }

  return challenge;
}

function isSqliteUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(
      'UNIQUE constraint failed: webauthn_credentials.credential_id',
    )
  );
}

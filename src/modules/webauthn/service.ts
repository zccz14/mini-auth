import {
  generateAuthenticationOptions as generateSimpleWebAuthnAuthenticationOptions,
  generateRegistrationOptions as generateSimpleWebAuthnRegistrationOptions,
  verifyRegistrationResponse as verifySimpleWebAuthnRegistrationResponse,
} from '@simplewebauthn/server';
import {
  createHash,
  createPublicKey,
  verify,
  type JsonWebKey,
} from 'node:crypto';
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

type JsonWebKeyWithCurve = JsonWebKey & {
  crv: 'P-256';
  kty: 'EC';
  x: string;
  y: string;
};

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

type ParsedAuthenticatorData = {
  rpIdHash: Buffer;
  flags: number;
  counter: number;
  credentialId?: Buffer;
  credentialPublicKey?: Buffer;
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

    const nextCounter = verifyAuthenticationResponse(
      input.credential,
      challenge.challenge,
      input.rpId,
      input.origins,
      JSON.parse(storedCredential.publicKey) as JsonWebKeyWithCurve,
      storedCredential.counter,
    );

    if (
      !consumeChallengeAndUpdateCredentialCounter(db, {
        requestId: challenge.requestId,
        credentialId: storedCredential.id,
        expectedCounter: storedCredential.counter,
        nextCounter,
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
    throw error;
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

function verifyAuthenticationResponse(
  credential: AuthenticationCredential,
  expectedChallenge: string,
  expectedRpId: string,
  expectedOrigins: string[],
  publicKey: JsonWebKeyWithCurve,
  storedCounter: number,
): number {
  try {
    validateCredentialEnvelope(credential, InvalidWebauthnAuthenticationError);

    if (credential.id !== encodeBase64Url(decodeBase64Url(credential.rawId))) {
      throw new InvalidWebauthnAuthenticationError();
    }

    const clientDataJSON = decodeBase64Url(credential.response.clientDataJSON);
    validateClientData(
      clientDataJSON,
      'webauthn.get',
      expectedChallenge,
      expectedOrigins,
      InvalidWebauthnAuthenticationError,
    );
    const authenticatorData = decodeBase64Url(
      credential.response.authenticatorData,
    );
    const parsedAuthData = parseAuthenticatorData(authenticatorData, false);

    validateRpIdHash(
      parsedAuthData.rpIdHash,
      expectedRpId,
      InvalidWebauthnAuthenticationError,
    );
    ensureFlag(parsedAuthData.flags, 0x01, InvalidWebauthnAuthenticationError);

    if (storedCounter > 0 && parsedAuthData.counter <= storedCounter) {
      throw new InvalidWebauthnAuthenticationError();
    }

    const verified = verify(
      'sha256',
      Buffer.concat([authenticatorData, sha256(clientDataJSON)]),
      createPublicKey({ format: 'jwk', key: publicKey as JsonWebKey }),
      decodeBase64Url(credential.response.signature),
    );

    if (!verified) {
      throw new InvalidWebauthnAuthenticationError();
    }

    return parsedAuthData.counter;
  } catch (error) {
    if (error instanceof InvalidWebauthnAuthenticationError) {
      throw error;
    }

    throw new InvalidWebauthnAuthenticationError();
  }
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

function validateCredentialEnvelope(
  credential: ParsedCredential,
  ErrorType:
    | typeof InvalidWebauthnRegistrationError
    | typeof InvalidWebauthnAuthenticationError,
) {
  if (credential.type !== 'public-key' || !credential.id || !credential.rawId) {
    throw new ErrorType();
  }
}

function validateClientData(
  clientDataJSON: Buffer,
  expectedType: 'webauthn.create' | 'webauthn.get',
  expectedChallenge: string,
  expectedOrigins: string[],
  ErrorType:
    | typeof InvalidWebauthnRegistrationError
    | typeof InvalidWebauthnAuthenticationError,
) {
  const clientData = JSON.parse(clientDataJSON.toString('utf8')) as {
    type?: string;
    challenge?: string;
    origin?: string;
    crossOrigin?: boolean;
  };

  if (
    clientData.type !== expectedType ||
    clientData.challenge !== expectedChallenge ||
    !clientData.origin ||
    !expectedOrigins.includes(clientData.origin) ||
    clientData.crossOrigin === true
  ) {
    throw new ErrorType();
  }
}

function parseAuthenticatorData(
  authData: Buffer,
  includeAttestedCredentialData: boolean,
): ParsedAuthenticatorData {
  if (authData.length < 37) {
    throw new Error('invalid auth data length');
  }

  const parsed: ParsedAuthenticatorData = {
    rpIdHash: authData.subarray(0, 32),
    flags: authData[32] ?? 0,
    counter: authData.readUInt32BE(33),
  };

  if (!includeAttestedCredentialData) {
    return parsed;
  }

  if (authData.length < 55) {
    throw new Error('invalid attested auth data length');
  }

  const credentialIdLength = authData.readUInt16BE(53);
  const credentialIdStart = 55;
  const credentialIdEnd = credentialIdStart + credentialIdLength;

  parsed.credentialId = authData.subarray(credentialIdStart, credentialIdEnd);
  parsed.credentialPublicKey = authData.subarray(credentialIdEnd);

  if (
    parsed.credentialId.length !== credentialIdLength ||
    parsed.credentialPublicKey.length === 0
  ) {
    throw new Error('invalid credential data');
  }

  return parsed;
}

function validateRpIdHash(
  actualRpIdHash: Buffer,
  expectedRpId: string,
  ErrorType:
    | typeof InvalidWebauthnRegistrationError
    | typeof InvalidWebauthnAuthenticationError,
) {
  if (!actualRpIdHash.equals(sha256(expectedRpId))) {
    throw new ErrorType();
  }
}

function ensureFlag(
  flags: number,
  mask: number,
  ErrorType:
    | typeof InvalidWebauthnRegistrationError
    | typeof InvalidWebauthnAuthenticationError,
) {
  if ((flags & mask) === 0) {
    throw new ErrorType();
  }
}

function isSqliteUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(
      'UNIQUE constraint failed: webauthn_credentials.credential_id',
    )
  );
}

function sha256(value: string | Buffer): Buffer {
  return createHash('sha256').update(value).digest();
}

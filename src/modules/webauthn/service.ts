import {
  createHash,
  createPublicKey,
  randomBytes,
  verify,
  type JsonWebKey
} from 'node:crypto'
import { Decoder } from 'cbor-x'
import type { DatabaseClient } from '../../infra/db/client.js'
import { decodeBase64Url, encodeBase64Url } from '../../shared/crypto.js'
import { TTLS } from '../../shared/time.js'
import { mintSessionTokens } from '../session/service.js'
import {
  consumeChallengeAndUpdateCredentialCounter,
  consumeChallenge,
  consumeUnusedRegistrationChallengesForUser,
  createChallenge,
  createCredential,
  deleteCredentialById,
  getChallengeByRequestId,
  getCredentialByCredentialId
} from './repo.js'

const decoder = new Decoder()

type JsonWebKeyWithCurve = JsonWebKey & {
  crv: 'P-256'
  kty: 'EC'
  x: string
  y: string
}

type ParsedCredential = {
  id: string
  rawId: string
  type: 'public-key'
}

type RegistrationCredential = ParsedCredential & {
  response: {
    clientDataJSON: string
    attestationObject: string
    transports?: string[]
  }
}

type AuthenticationCredential = ParsedCredential & {
  response: {
    clientDataJSON: string
    authenticatorData: string
    signature: string
    userHandle?: string | null
  }
}

type ParsedAuthenticatorData = {
  rpIdHash: Buffer
  flags: number
  counter: number
  credentialId?: Buffer
  credentialPublicKey?: Buffer
}

export class InvalidWebauthnRegistrationError extends Error {
  constructor() {
    super('invalid_webauthn_registration')
  }
}

export class InvalidWebauthnAuthenticationError extends Error {
  constructor() {
    super('invalid_webauthn_authentication')
  }
}

export class DuplicateCredentialError extends Error {
  constructor() {
    super('duplicate_credential')
  }
}

export class WebauthnCredentialNotFoundError extends Error {
  constructor() {
    super('credential_not_found')
  }
}

export function generateRegistrationOptions(
  db: DatabaseClient,
  input: { userId: string; email: string; rpId: string }
): {
  request_id: string
  publicKey: {
    challenge: string
    rp: { name: 'mini-auth'; id: string }
    user: { id: string; name: string; displayName: string }
    pubKeyCredParams: Array<{ type: 'public-key'; alg: -7 }>
    timeout: number
    authenticatorSelection: {
      residentKey: 'required'
      userVerification: 'preferred'
    }
  }
} {
  const challenge = encodeBase64Url(randomBytes(32))
  consumeUnusedRegistrationChallengesForUser(
    db,
    input.userId,
    new Date().toISOString()
  )
  const expiresAt = new Date(
    Date.now() + TTLS.webauthnChallengeSeconds * 1000
  ).toISOString()
  const record = createChallenge(db, {
    type: 'register',
    challenge,
    userId: input.userId,
    expiresAt
  })

  return {
    request_id: record.requestId,
    publicKey: {
      challenge,
      rp: {
        name: 'mini-auth',
        id: input.rpId
      },
      user: {
        id: encodeBase64Url(Buffer.from(input.userId, 'utf8')),
        name: input.email,
        displayName: input.email
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      timeout: TTLS.webauthnChallengeSeconds * 1000,
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'preferred'
      }
    }
  }
}

export function verifyRegistration(
  db: DatabaseClient,
  input: {
    userId: string
    requestId: string
    credential: RegistrationCredential
    rpId: string
    origins: string[]
  }
): { ok: true } {
  const challenge = getValidChallenge(db, input.requestId, 'register')

  if (challenge.userId !== input.userId) {
    throw new InvalidWebauthnRegistrationError()
  }

  const verified = verifyRegistrationResponse(
    input.credential,
    challenge.challenge,
    input.rpId,
    input.origins
  )

  const now = new Date().toISOString()

  if (!consumeChallenge(db, challenge.requestId, now)) {
    throw new InvalidWebauthnRegistrationError()
  }

  try {
    createCredential(db, {
      userId: input.userId,
      credentialId: verified.credentialId,
      publicKey: JSON.stringify(verified.publicKey),
      counter: verified.counter,
      transports: verified.transports
    })
  } catch (error) {
    if (isSqliteUniqueConstraint(error)) {
      throw new DuplicateCredentialError()
    }

    throw error
  }

  return { ok: true }
}

export function generateAuthenticationOptions(
  db: DatabaseClient,
  input: { rpId: string }
): {
  request_id: string
  publicKey: {
    challenge: string
    rpId: string
    timeout: number
    userVerification: 'preferred'
  }
} {
  const challenge = encodeBase64Url(randomBytes(32))
  const expiresAt = new Date(
    Date.now() + TTLS.webauthnChallengeSeconds * 1000
  ).toISOString()
  const record = createChallenge(db, {
    type: 'authenticate',
    challenge,
    userId: null,
    expiresAt
  })

  return {
    request_id: record.requestId,
    publicKey: {
      challenge,
      rpId: input.rpId,
      timeout: TTLS.webauthnChallengeSeconds * 1000,
      userVerification: 'preferred'
    }
  }
}

export async function verifyAuthentication(
  db: DatabaseClient,
  input: {
    requestId: string
    credential: AuthenticationCredential
    rpId: string
    origins: string[]
    issuer: string
  }
) {
  const challenge = getValidChallenge(db, input.requestId, 'authenticate')
  const storedCredential = getCredentialByCredentialId(db, input.credential.id)

  if (!storedCredential) {
    throw new InvalidWebauthnAuthenticationError()
  }

  const nextCounter = verifyAuthenticationResponse(
    input.credential,
    challenge.challenge,
    input.rpId,
    input.origins,
    JSON.parse(storedCredential.publicKey) as JsonWebKeyWithCurve,
    storedCredential.counter
  )

  if (
    !consumeChallengeAndUpdateCredentialCounter(db, {
      requestId: challenge.requestId,
      credentialId: storedCredential.id,
      expectedCounter: storedCredential.counter,
      nextCounter,
      now: new Date().toISOString()
    })
  ) {
    throw new InvalidWebauthnAuthenticationError()
  }

  return mintSessionTokens(db, {
    userId: storedCredential.userId,
    issuer: input.issuer
  })
}

export function deleteCredential(
  db: DatabaseClient,
  input: { credentialId: string; userId: string }
): { ok: true } {
  if (!deleteCredentialById(db, input.credentialId, input.userId)) {
    throw new WebauthnCredentialNotFoundError()
  }

  return { ok: true }
}

function verifyRegistrationResponse(
  credential: RegistrationCredential,
  expectedChallenge: string,
  expectedRpId: string,
  expectedOrigins: string[]
): {
  credentialId: string
  publicKey: JsonWebKeyWithCurve
  counter: number
  transports: string[]
} {
  try {
    validateCredentialEnvelope(credential, InvalidWebauthnRegistrationError)

    const clientDataJSON = decodeBase64Url(credential.response.clientDataJSON)
    validateClientData(
      clientDataJSON,
      'webauthn.create',
      expectedChallenge,
      expectedOrigins,
      InvalidWebauthnRegistrationError
    )
    const attestationObject = decodeBase64Url(
      credential.response.attestationObject
    )
    const attestation = decoder.decode(attestationObject) as {
      fmt?: string
      attStmt?: { alg?: number; sig?: Uint8Array }
      authData?: Uint8Array
    }

    if (
      attestation.fmt !== 'packed' ||
      attestation.attStmt?.alg !== -7 ||
      !attestation.attStmt.sig ||
      !attestation.authData
    ) {
      throw new InvalidWebauthnRegistrationError()
    }

    const authData = Buffer.from(attestation.authData)
    const parsedAuthData = parseAuthenticatorData(authData, true)

    validateRpIdHash(
      parsedAuthData.rpIdHash,
      expectedRpId,
      InvalidWebauthnRegistrationError
    )
    ensureFlag(parsedAuthData.flags, 0x01, InvalidWebauthnRegistrationError)
    ensureFlag(parsedAuthData.flags, 0x40, InvalidWebauthnRegistrationError)

    if (!parsedAuthData.credentialId || !parsedAuthData.credentialPublicKey) {
      throw new InvalidWebauthnRegistrationError()
    }

    const publicKey = coseEc2ToJwk(parsedAuthData.credentialPublicKey)
    const rawId = decodeBase64Url(credential.rawId)

    if (
      credential.id !== encodeBase64Url(parsedAuthData.credentialId) ||
      !rawId.equals(parsedAuthData.credentialId)
    ) {
      throw new InvalidWebauthnRegistrationError()
    }

    const signaturePayload = Buffer.concat([authData, sha256(clientDataJSON)])
    const verified = verify(
      'sha256',
      signaturePayload,
      createPublicKey({ format: 'jwk', key: publicKey as JsonWebKey }),
      Buffer.from(attestation.attStmt.sig)
    )

    if (!verified) {
      throw new InvalidWebauthnRegistrationError()
    }

    return {
      credentialId: credential.id,
      publicKey,
      counter: parsedAuthData.counter,
      transports: credential.response.transports ?? []
    }
  } catch (error) {
    if (error instanceof InvalidWebauthnRegistrationError) {
      throw error
    }

    throw new InvalidWebauthnRegistrationError()
  }
}

function verifyAuthenticationResponse(
  credential: AuthenticationCredential,
  expectedChallenge: string,
  expectedRpId: string,
  expectedOrigins: string[],
  publicKey: JsonWebKeyWithCurve,
  storedCounter: number
): number {
  try {
    validateCredentialEnvelope(credential, InvalidWebauthnAuthenticationError)

    if (credential.id !== encodeBase64Url(decodeBase64Url(credential.rawId))) {
      throw new InvalidWebauthnAuthenticationError()
    }

    const clientDataJSON = decodeBase64Url(credential.response.clientDataJSON)
    validateClientData(
      clientDataJSON,
      'webauthn.get',
      expectedChallenge,
      expectedOrigins,
      InvalidWebauthnAuthenticationError
    )
    const authenticatorData = decodeBase64Url(
      credential.response.authenticatorData
    )
    const parsedAuthData = parseAuthenticatorData(authenticatorData, false)

    validateRpIdHash(
      parsedAuthData.rpIdHash,
      expectedRpId,
      InvalidWebauthnAuthenticationError
    )
    ensureFlag(parsedAuthData.flags, 0x01, InvalidWebauthnAuthenticationError)

    if (storedCounter > 0 && parsedAuthData.counter <= storedCounter) {
      throw new InvalidWebauthnAuthenticationError()
    }

    const verified = verify(
      'sha256',
      Buffer.concat([authenticatorData, sha256(clientDataJSON)]),
      createPublicKey({ format: 'jwk', key: publicKey as JsonWebKey }),
      decodeBase64Url(credential.response.signature)
    )

    if (!verified) {
      throw new InvalidWebauthnAuthenticationError()
    }

    return parsedAuthData.counter
  } catch (error) {
    if (error instanceof InvalidWebauthnAuthenticationError) {
      throw error
    }

    throw new InvalidWebauthnAuthenticationError()
  }
}

function getValidChallenge(
  db: DatabaseClient,
  requestId: string,
  type: 'register' | 'authenticate'
) {
  const challenge = getChallengeByRequestId(db, requestId)
  const now = new Date().toISOString()

  if (
    !challenge ||
    challenge.type !== type ||
    challenge.consumedAt ||
    challenge.expiresAt <= now
  ) {
    if (type === 'register') {
      throw new InvalidWebauthnRegistrationError()
    }

    throw new InvalidWebauthnAuthenticationError()
  }

  return challenge
}

function validateCredentialEnvelope(
  credential: ParsedCredential,
  ErrorType:
    | typeof InvalidWebauthnRegistrationError
    | typeof InvalidWebauthnAuthenticationError
) {
  if (credential.type !== 'public-key' || !credential.id || !credential.rawId) {
    throw new ErrorType()
  }
}

function validateClientData(
  clientDataJSON: Buffer,
  expectedType: 'webauthn.create' | 'webauthn.get',
  expectedChallenge: string,
  expectedOrigins: string[],
  ErrorType:
    | typeof InvalidWebauthnRegistrationError
    | typeof InvalidWebauthnAuthenticationError
) {
  const clientData = JSON.parse(clientDataJSON.toString('utf8')) as {
    type?: string
    challenge?: string
    origin?: string
    crossOrigin?: boolean
  }

  if (
    clientData.type !== expectedType ||
    clientData.challenge !== expectedChallenge ||
    !clientData.origin ||
    !expectedOrigins.includes(clientData.origin) ||
    clientData.crossOrigin === true
  ) {
    throw new ErrorType()
  }
}

function parseAuthenticatorData(
  authData: Buffer,
  includeAttestedCredentialData: boolean
): ParsedAuthenticatorData {
  if (authData.length < 37) {
    throw new Error('invalid auth data length')
  }

  const parsed: ParsedAuthenticatorData = {
    rpIdHash: authData.subarray(0, 32),
    flags: authData[32] ?? 0,
    counter: authData.readUInt32BE(33)
  }

  if (!includeAttestedCredentialData) {
    return parsed
  }

  if (authData.length < 55) {
    throw new Error('invalid attested auth data length')
  }

  const credentialIdLength = authData.readUInt16BE(53)
  const credentialIdStart = 55
  const credentialIdEnd = credentialIdStart + credentialIdLength

  parsed.credentialId = authData.subarray(credentialIdStart, credentialIdEnd)
  parsed.credentialPublicKey = authData.subarray(credentialIdEnd)

  if (
    parsed.credentialId.length !== credentialIdLength ||
    parsed.credentialPublicKey.length === 0
  ) {
    throw new Error('invalid credential data')
  }

  return parsed
}

function coseEc2ToJwk(cosePublicKeyBytes: Buffer): JsonWebKeyWithCurve {
  const cosePublicKey = decoder.decode(cosePublicKeyBytes) as Map<
    number,
    number | Uint8Array
  >
  const kty = cosePublicKey.get(1)
  const alg = cosePublicKey.get(3)
  const curve = cosePublicKey.get(-1)
  const x = cosePublicKey.get(-2)
  const y = cosePublicKey.get(-3)

  if (
    kty !== 2 ||
    alg !== -7 ||
    curve !== 1 ||
    !(x instanceof Uint8Array) ||
    !(y instanceof Uint8Array)
  ) {
    throw new InvalidWebauthnRegistrationError()
  }

  return {
    kty: 'EC',
    crv: 'P-256',
    x: Buffer.from(x).toString('base64url'),
    y: Buffer.from(y).toString('base64url')
  }
}

function validateRpIdHash(
  actualRpIdHash: Buffer,
  expectedRpId: string,
  ErrorType:
    | typeof InvalidWebauthnRegistrationError
    | typeof InvalidWebauthnAuthenticationError
) {
  if (!actualRpIdHash.equals(sha256(expectedRpId))) {
    throw new ErrorType()
  }
}

function ensureFlag(
  flags: number,
  mask: number,
  ErrorType:
    | typeof InvalidWebauthnRegistrationError
    | typeof InvalidWebauthnAuthenticationError
) {
  if ((flags & mask) === 0) {
    throw new ErrorType()
  }
}

function isSqliteUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(
      'UNIQUE constraint failed: webauthn_credentials.credential_id'
    )
  )
}

function sha256(value: string | Buffer): Buffer {
  return createHash('sha256').update(value).digest()
}

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
  type JsonWebKey,
  type KeyObject
} from 'node:crypto'

export type JwtPayload = Record<string, unknown>

export type PublicJwk = JsonWebKey & {
  alg: 'EdDSA'
  crv: 'Ed25519'
  kid: string
  kty: 'OKP'
  use: 'sig'
  x: string
}

export type PrivateJwk = PublicJwk & {
  d: string
}

export type KeyRecord = {
  id: string
  kid: string
  alg: 'EdDSA'
  publicJwk: PublicJwk
  privateJwk: PrivateJwk
}

type JwtHeader = {
  alg: 'EdDSA'
  kid: string
  typ: 'JWT'
}

export function encodeBase64Url(value: string | Buffer): string {
  const buffer = typeof value === 'string' ? Buffer.from(value, 'utf8') : value
  return buffer.toString('base64url')
}

export function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value, 'base64url')
}

export function generateEd25519KeyRecord(): KeyRecord {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const kid = randomUUID()
  const publicJwk = publicKey.export({ format: 'jwk' }) as PublicJwk
  const privateJwk = privateKey.export({ format: 'jwk' }) as PrivateJwk

  return {
    id: randomUUID(),
    kid,
    alg: 'EdDSA',
    publicJwk: {
      ...publicJwk,
      alg: 'EdDSA',
      kid,
      kty: 'OKP',
      crv: 'Ed25519',
      use: 'sig'
    },
    privateJwk: {
      ...privateJwk,
      alg: 'EdDSA',
      kid,
      kty: 'OKP',
      crv: 'Ed25519',
      use: 'sig'
    }
  }
}

export function toPublicJwk(privateJwk: PrivateJwk): PublicJwk {
  return {
    alg: privateJwk.alg,
    crv: privateJwk.crv,
    kid: privateJwk.kid,
    kty: privateJwk.kty,
    use: privateJwk.use,
    x: privateJwk.x
  }
}

export function signJwt(
  payload: JwtPayload,
  privateJwk: PrivateJwk,
  kid = privateJwk.kid
): string {
  const encodedHeader = encodeBase64Url(
    JSON.stringify({ alg: 'EdDSA', kid, typ: 'JWT' } satisfies JwtHeader)
  )
  const encodedPayload = encodeBase64Url(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = sign(
    null,
    Buffer.from(signingInput, 'utf8'),
    createPrivateJwkKey(privateJwk)
  )

  return `${signingInput}.${encodeBase64Url(signature)}`
}

export function verifyJwt(
  token: string,
  publicJwk: PublicJwk
): { header: JwtHeader; payload: JwtPayload } {
  const segments = token.split('.')

  if (segments.length !== 3) {
    throw new Error('Invalid JWT format')
  }

  const [encodedHeader, encodedPayload, encodedSignature] = segments
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = decodeBase64Url(encodedSignature)
  const verified = verify(
    null,
    Buffer.from(signingInput, 'utf8'),
    createPublicJwkKey(publicJwk),
    signature
  )

  if (!verified) {
    throw new Error('Invalid JWT signature')
  }

  const header = JSON.parse(
    decodeBase64Url(encodedHeader).toString('utf8')
  ) as JwtHeader
  const payload = JSON.parse(
    decodeBase64Url(encodedPayload).toString('utf8')
  ) as JwtPayload

  return { header, payload }
}

function createPrivateJwkKey(privateJwk: PrivateJwk): KeyObject {
  return createPrivateKey({ format: 'jwk', key: privateJwk })
}

function createPublicJwkKey(publicJwk: PublicJwk): KeyObject {
  return createPublicKey({ format: 'jwk', key: publicJwk })
}

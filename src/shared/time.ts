export const TTLS = {
  otpSeconds: 600,
  webauthnChallengeSeconds: 300,
  accessTokenSeconds: 900,
  refreshTokenSeconds: 604800
} as const

export function getUnixTimeSeconds(now = Date.now()): number {
  return Math.floor(now / 1000)
}

export function getExpiresAtUnixSeconds(
  issuedAtUnixSeconds: number,
  ttlSeconds: number
): number {
  return issuedAtUnixSeconds + ttlSeconds
}

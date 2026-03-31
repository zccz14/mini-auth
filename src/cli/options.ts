export function normalizeOriginOption(
  origin: string | string[] | undefined
): string[] | undefined {
  if (origin === undefined) {
    return undefined
  }

  return Array.isArray(origin) ? origin : [origin]
}

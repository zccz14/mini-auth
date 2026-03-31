import { describe, expect, it } from 'vitest'
import { normalizeOriginOption } from '../../src/cli/options.js'

describe('cli origin normalization', () => {
  it('wraps a single origin string in an array', () => {
    expect(normalizeOriginOption('http://localhost:5173')).toEqual([
      'http://localhost:5173'
    ])
  })

  it('keeps repeated origin values in order', () => {
    expect(
      normalizeOriginOption(['https://one.example', 'https://two.example'])
    ).toEqual(['https://one.example', 'https://two.example'])
  })

  it('preserves an omitted origin value', () => {
    expect(normalizeOriginOption(undefined)).toBeUndefined()
  })
})

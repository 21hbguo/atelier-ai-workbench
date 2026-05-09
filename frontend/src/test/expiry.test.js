import { describe, it, expect } from 'vitest'
import { parseExpiryTime, getExpiryInfo } from '../utils/expiry'

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

describe('parseExpiryTime', () => {
  it('returns null for null', () => {
    expect(parseExpiryTime(null)).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(parseExpiryTime(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseExpiryTime('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(parseExpiryTime('   ')).toBeNull()
  })

  it('returns null for invalid date string', () => {
    expect(parseExpiryTime('not-a-date')).toBeNull()
  })

  it('parses ISO string with timezone', () => {
    const ts = parseExpiryTime('2026-05-10T12:00:00+08:00')
    expect(ts).toBe(Date.parse('2026-05-10T12:00:00+08:00'))
  })

  it('parses ISO string with Z suffix', () => {
    const ts = parseExpiryTime('2026-05-10T12:00:00Z')
    expect(ts).toBe(Date.parse('2026-05-10T12:00:00Z'))
  })

  it('appends +08:00 to ISO string without timezone', () => {
    const ts = parseExpiryTime('2026-05-10T12:00:00')
    expect(ts).toBe(Date.parse('2026-05-10T12:00:00+08:00'))
  })

  it('converts space-separated datetime to ISO and appends +08:00', () => {
    const ts = parseExpiryTime('2026-05-10 12:00:00')
    expect(ts).toBe(Date.parse('2026-05-10T12:00:00+08:00'))
  })

  it('handles numeric input via string coercion', () => {
    const ts = parseExpiryTime(0)
    // String(0) = '0', which is not a valid date
    expect(ts).toBeNull()
  })
})

describe('getExpiryInfo', () => {
  const now = Date.parse('2026-05-09T12:00:00+08:00')

  describe('permanent items', () => {
    it('returns permanent info regardless of expiresAt', () => {
      const result = getExpiryInfo({ expiresAt: '2020-01-01T00:00:00+08:00', isPermanent: true, now })
      expect(result).toEqual({
        expired: false,
        text: '长久',
        detail: '已分享到广场，长久保存',
        msLeft: null,
      })
    })
  })

  describe('unparseable expiresAt (fallback)', () => {
    it('uses default 3 days when fallbackDaysLeft is not provided', () => {
      const result = getExpiryInfo({ expiresAt: null, now })
      expect(result.text).toBe('3天到期')
      expect(result.detail).toBe('3天后过期')
      expect(result.expired).toBe(false)
      expect(result.msLeft).toBeNull()
    })

    it('uses fallbackDaysLeft when provided', () => {
      const result = getExpiryInfo({ expiresAt: null, now, fallbackDaysLeft: 7 })
      expect(result.text).toBe('7天到期')
      expect(result.detail).toBe('7天后过期')
    })

    it('uses fallbackDaysLeft = 0', () => {
      const result = getExpiryInfo({ expiresAt: null, now, fallbackDaysLeft: 0 })
      expect(result.text).toBe('0天到期')
      expect(result.detail).toBe('0天后过期')
    })

    it('handles undefined expiresAt', () => {
      const result = getExpiryInfo({ now })
      expect(result.text).toBe('3天到期')
      expect(result.expired).toBe(false)
    })
  })

  describe('expired timestamp', () => {
    it('returns expired when msLeft <= 0', () => {
      const past = '2026-05-09T11:00:00+08:00'
      const result = getExpiryInfo({ expiresAt: past, now })
      expect(result.expired).toBe(true)
      expect(result.text).toBe('已过期')
      expect(result.msLeft).toBe(0)
      expect(result.detail).toContain('已过期')
    })

    it('returns expired at exact boundary (msLeft = 0)', () => {
      const exact = '2026-05-09T12:00:00+08:00'
      const result = getExpiryInfo({ expiresAt: exact, now })
      expect(result.expired).toBe(true)
      expect(result.msLeft).toBe(0)
    })
  })

  describe('minutes display (<= 60 min)', () => {
    it('shows minutes for 30 min left', () => {
      const future = '2026-05-09T12:30:00+08:00'
      const result = getExpiryInfo({ expiresAt: future, now })
      expect(result.expired).toBe(false)
      expect(result.text).toBe('30分钟到期')
      expect(result.detail).toBe('30分钟后过期')
      expect(result.msLeft).toBe(30 * MIN)
    })

    it('shows 1 minute for just under 1 min left', () => {
      const future = '2026-05-09T12:00:01+08:00'
      const result = getExpiryInfo({ expiresAt: future, now })
      expect(result.text).toBe('1分钟到期')
    })
  })

  describe('hours display (<= 48 hours)', () => {
    it('shows hours for 2 hours left', () => {
      const future = '2026-05-09T14:00:00+08:00'
      const result = getExpiryInfo({ expiresAt: future, now })
      expect(result.expired).toBe(false)
      expect(result.text).toBe('2小时到期')
      expect(result.detail).toBe('2小时后过期')
      expect(result.msLeft).toBe(2 * HOUR)
    })

    it('shows hours for 48 hours left (boundary)', () => {
      const future = '2026-05-11T12:00:00+08:00'
      const result = getExpiryInfo({ expiresAt: future, now })
      expect(result.text).toBe('48小时到期')
    })

    it('switches to days at 49 hours', () => {
      // 49 hours = 2.04 days, ceil = 3
      const future = '2026-05-11T13:00:00+08:00'
      const result = getExpiryInfo({ expiresAt: future, now })
      expect(result.text).toBe('3天到期')
    })
  })

  describe('days display (> 48 hours)', () => {
    it('shows days for 3 days left', () => {
      const future = '2026-05-12T12:00:00+08:00'
      const result = getExpiryInfo({ expiresAt: future, now })
      expect(result.expired).toBe(false)
      expect(result.text).toBe('3天到期')
      expect(result.detail).toBe('3天后过期')
      expect(result.msLeft).toBe(3 * DAY)
    })
  })

  describe('default now parameter', () => {
    it('uses Date.now() when now is not provided', () => {
      const soon = new Date(Date.now() + 30 * MIN).toISOString()
      const result = getExpiryInfo({ expiresAt: soon })
      expect(result.expired).toBe(false)
      expect(result.text).toContain('分钟到期')
    })
  })
})

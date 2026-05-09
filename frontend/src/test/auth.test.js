import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readUser, writeUser, clearUser } from '../auth'

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('readUser', () => {
  it('returns null when localStorage is empty', () => {
    expect(readUser()).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    localStorage.setItem('user', '{bad json')
    expect(readUser()).toBeNull()
  })

  it('normalizes account from username field', () => {
    const user = { username: 'alice', id: 1 }
    localStorage.setItem('user', JSON.stringify(user))
    const result = readUser()
    expect(result.account).toBe('alice')
    expect(result.username).toBe('alice')
  })

  it('prefers account over username', () => {
    const user = { account: 'acct', username: 'user', id: 1 }
    localStorage.setItem('user', JSON.stringify(user))
    expect(readUser().account).toBe('acct')
    expect(readUser().username).toBe('acct')
  })

  it('defaults empty invite fields', () => {
    const user = { account: 'a', id: 1 }
    localStorage.setItem('user', JSON.stringify(user))
    const result = readUser()
    expect(result.invite_code).toBe('')
    expect(result.inviter_user_id).toBeNull()
    expect(result.register_invite_code).toBe('')
  })

  it('preserves existing invite fields', () => {
    const user = { account: 'a', id: 1, invite_code: 'INV', inviter_user_id: 42, register_invite_code: 'REG' }
    localStorage.setItem('user', JSON.stringify(user))
    const result = readUser()
    expect(result.invite_code).toBe('INV')
    expect(result.inviter_user_id).toBe(42)
    expect(result.register_invite_code).toBe('REG')
  })

  it('returns null when stored value is "null" string', () => {
    localStorage.setItem('user', 'null')
    expect(readUser()).toBeNull()
  })
})

describe('writeUser', () => {
  it('writes normalized user to localStorage', () => {
    const user = { username: 'bob', id: 2 }
    writeUser(user)
    const stored = JSON.parse(localStorage.getItem('user'))
    expect(stored.account).toBe('bob')
    expect(stored.username).toBe('bob')
  })

  it('dispatches auth-changed event', () => {
    const spy = vi.fn()
    window.addEventListener('auth-changed', spy)
    writeUser({ account: 'x', id: 1 })
    expect(spy).toHaveBeenCalled()
    window.removeEventListener('auth-changed', spy)
  })

  it('does nothing when user is null', () => {
    writeUser(null)
    expect(localStorage.getItem('user')).toBeNull()
  })

  it('does nothing when user is undefined', () => {
    writeUser(undefined)
    expect(localStorage.getItem('user')).toBeNull()
  })
})

describe('clearUser', () => {
  it('removes user from localStorage', () => {
    localStorage.setItem('user', JSON.stringify({ account: 'a' }))
    clearUser()
    expect(localStorage.getItem('user')).toBeNull()
  })

  it('removes cached_prompt', () => {
    localStorage.setItem('cached_prompt', 'test')
    clearUser()
    expect(localStorage.getItem('cached_prompt')).toBeNull()
  })

  it('removes ref_images', () => {
    localStorage.setItem('ref_images', '[]')
    clearUser()
    expect(localStorage.getItem('ref_images')).toBeNull()
  })

  it('removes ref_image_url', () => {
    localStorage.setItem('ref_image_url', 'http://x')
    clearUser()
    expect(localStorage.getItem('ref_image_url')).toBeNull()
  })

  it('removes ref_image_name', () => {
    localStorage.setItem('ref_image_name', 'img.png')
    clearUser()
    expect(localStorage.getItem('ref_image_name')).toBeNull()
  })

  it('dispatches auth-changed event', () => {
    const spy = vi.fn()
    window.addEventListener('auth-changed', spy)
    clearUser()
    expect(spy).toHaveBeenCalled()
    window.removeEventListener('auth-changed', spy)
  })
})

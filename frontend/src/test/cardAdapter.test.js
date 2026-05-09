import { describe, it, expect } from 'vitest'
import { normalizeImage, normalizePrompt, normalizeList } from '../utils/cardAdapter'

describe('normalizeImage', () => {
  const base = {
    id: 1,
    filename: 'abc.png',
    prompt: 'a cat',
    created_at: '2025-01-01',
    likes_count: 5,
    is_liked: false,
    is_favorited: false,
    is_frozen: false,
    width: 512,
    height: 512,
    category: 'portrait',
    category_label: 'Portrait',
  }

  it('returns all expected fields', () => {
    const r = normalizeImage(base)
    expect(r._type).toBe('image')
    expect(r._raw).toBe(base)
    expect(r.id).toBe('1')
    expect(r.title).toBe('')
    expect(r.subtitle).toBe('a cat')
    expect(r.prompt).toBe('a cat')
    expect(r.thumbUrl).toBe('/api/images/thumb/abc.png?size=400')
    expect(r.thumbUrl2x).toBe('/api/images/thumb/abc.png?size=800')
    expect(r.fullUrl).toBe('/api/images/file/abc.png')
    expect(r.author).toBe('')
    expect(r.authorId).toBeNull()
    expect(r.createdAt).toBe('2025-01-01')
    expect(r.likesCount).toBe(5)
    expect(r.isLiked).toBe(false)
    expect(r.isFavorited).toBe(false)
    expect(r.isFrozen).toBe(false)
    expect(r.filename).toBe('abc.png')
    expect(r.width).toBe(512)
    expect(r.height).toBe(512)
    expect(r.category).toBe('portrait')
    expect(r.categoryLabel).toBe('Portrait')
    expect(r.negativePrompt).toBeNull()
    expect(r.tags).toBeNull()
    expect(r.imagePath).toBeNull()
    expect(r.name).toBeNull()
    expect(r.metadataType).toBeNull()
    expect(r.metadataSize).toBeNull()
  })

  it('parses metadata as JSON string', () => {
    const raw = { ...base, metadata: '{"title":"My Title","type":"photo","size":"2M"}' }
    const r = normalizeImage(raw)
    expect(r.title).toBe('My Title')
    expect(r.metadataType).toBe('photo')
    expect(r.metadataSize).toBe('2M')
  })

  it('handles metadata as object', () => {
    const raw = { ...base, metadata: { title: 'Obj Title', type: 'sketch', size: '500K' } }
    const r = normalizeImage(raw)
    expect(r.title).toBe('Obj Title')
    expect(r.metadataType).toBe('sketch')
    expect(r.metadataSize).toBe('500K')
  })

  it('handles empty string metadata', () => {
    const raw = { ...base, metadata: '' }
    const r = normalizeImage(raw)
    expect(r.title).toBe('')
    expect(r.metadataType).toBeNull()
  })

  it('handles missing metadata', () => {
    const r = normalizeImage(base)
    expect(r.title).toBe('')
  })

  it('falls back title: metadata.title < raw.title < raw.name', () => {
    expect(normalizeImage({ ...base, title: 'T' }).title).toBe('T')
    expect(normalizeImage({ ...base, name: 'N' }).title).toBe('N')
    expect(normalizeImage({ ...base, metadata: '{"title":"MT"}', title: 'T' }).title).toBe('MT')
  })

  it('resolves author: nickname > account > username', () => {
    expect(normalizeImage({ ...base, nickname: 'nick' }).author).toBe('nick')
    expect(normalizeImage({ ...base, account: 'acc' }).author).toBe('acc')
    expect(normalizeImage({ ...base, username: 'user' }).author).toBe('user')
    expect(normalizeImage({ ...base, nickname: 'n', account: 'a', username: 'u' }).author).toBe('n')
  })

  it('converts user_id to string', () => {
    expect(normalizeImage({ ...base, user_id: 42 }).authorId).toBe('42')
    expect(normalizeImage({ ...base, user_id: 0 }).authorId).toBeNull()
    expect(normalizeImage({ ...base }).authorId).toBeNull()
  })

  it('coerces boolean flags', () => {
    const r = normalizeImage({ ...base, is_liked: 1, is_favorited: 'yes', is_frozen: true })
    expect(r.isLiked).toBe(true)
    expect(r.isFavorited).toBe(true)
    expect(r.isFrozen).toBe(true)
  })

  it('defaults missing numeric fields', () => {
    const r = normalizeImage({ id: 1, filename: 'f.png' })
    expect(r.likesCount).toBe(0)
    expect(r.width).toBeNull()
    expect(r.height).toBeNull()
  })

  it('defaults missing string fields', () => {
    const r = normalizeImage({ id: 1, filename: 'f.png' })
    expect(r.prompt).toBe('')
    expect(r.subtitle).toBe('')
    expect(r.createdAt).toBe('')
    expect(r.category).toBeNull()
    expect(r.categoryLabel).toBeNull()
  })
})

describe('normalizePrompt', () => {
  const base = {
    id: 10,
    name: 'prompt name',
    prompt: 'draw something',
    created_at: '2025-02-02',
    likes_count: 3,
    is_liked: true,
    is_favorited: false,
    is_frozen: false,
    width: 1024,
    height: 768,
    category: 'landscape',
    category_label: 'Landscape',
    negative_prompt: 'bad quality',
    tags: ['nature', 'sky'],
    author: 'Author1',
  }

  it('returns all expected fields', () => {
    const r = normalizePrompt(base)
    expect(r._type).toBe('prompt')
    expect(r._raw).toBe(base)
    expect(r.id).toBe('10')
    expect(r.title).toBe('prompt name')
    expect(r.subtitle).toBe('prompt name')
    expect(r.prompt).toBe('draw something')
    expect(r.author).toBe('Author1')
    expect(r.authorName).toBe('Author1')
    expect(r.authorId).toBeNull()
    expect(r.createdAt).toBe('2025-02-02')
    expect(r.likesCount).toBe(3)
    expect(r.isLiked).toBe(true)
    expect(r.isFavorited).toBe(false)
    expect(r.isFrozen).toBe(false)
    expect(r.filename).toBeNull()
    expect(r.width).toBe(1024)
    expect(r.height).toBe(768)
    expect(r.metadataType).toBeNull()
    expect(r.metadataSize).toBeNull()
    expect(r.name).toBe('prompt name')
    expect(r.negativePrompt).toBe('bad quality')
    expect(r.tags).toEqual(['nature', 'sky'])
    expect(r.category).toBe('landscape')
    expect(r.categoryLabel).toBe('Landscape')
    expect(r.imagePath).toBeNull()
  })

  it('uses prompt as subtitle when name is missing', () => {
    const r = normalizePrompt({ ...base, name: '' })
    expect(r.subtitle).toBe('draw something')
  })

  it('prefers name over prompt for subtitle', () => {
    expect(normalizePrompt(base).subtitle).toBe('prompt name')
  })

  describe('image path handling', () => {
    it('produces null thumb/full urls when no image_path', () => {
      const r = normalizePrompt({ ...base, image_path: null })
      expect(r.thumbUrl).toBeNull()
      expect(r.thumbUrl2x).toBeNull()
      expect(r.fullUrl).toBeNull()
      expect(r.imagePath).toBeNull()
    })

    it('detects evo path (contains slash) and builds evo-thumb url', () => {
      const r = normalizePrompt({ ...base, image_path: 'user123/abc.jpg' })
      expect(r.thumbUrl).toBe('/api/prompts/evo-thumb/user123/abc.jpg?size=400')
      expect(r.thumbUrl2x).toBe('/api/prompts/evo-thumb/user123/abc.jpg?size=800')
      expect(r.fullUrl).toBe('/api/prompts/evo-thumb/user123/abc.jpg?size=800')
      expect(r.imagePath).toBe('user123/abc.jpg')
    })

    it('uses plain image url for non-evo path (no slash)', () => {
      const r = normalizePrompt({ ...base, image_path: 'abc.jpg' })
      expect(r.thumbUrl).toBe('/api/prompts/image/abc.jpg')
      expect(r.thumbUrl2x).toBe('/api/prompts/image/abc.jpg')
      expect(r.fullUrl).toBe('/api/prompts/image/abc.jpg')
      expect(r.imagePath).toBe('abc.jpg')
    })

    it('treats empty string image_path as no image', () => {
      const r = normalizePrompt({ ...base, image_path: '' })
      expect(r.thumbUrl).toBeNull()
    })
  })

  it('resolves author: author > nickname > account > username', () => {
    expect(normalizePrompt({ ...base, author: 'A', nickname: 'N' }).author).toBe('A')
    expect(normalizePrompt({ ...base, author: null, nickname: 'N' }).author).toBe('N')
    expect(normalizePrompt({ ...base, author: null, nickname: null, account: 'Acc' }).author).toBe('Acc')
    expect(normalizePrompt({ ...base, author: null, nickname: null, account: null, username: 'U' }).author).toBe('U')
    expect(normalizePrompt({ id: 1 }).author).toBe('')
  })

  it('authorName mirrors author resolution', () => {
    const r = normalizePrompt({ ...base, author: 'X' })
    expect(r.authorName).toBe('X')
  })

  it('parses tags from JSON string', () => {
    const r = normalizePrompt({ ...base, tags: '["a","b"]' })
    expect(r.tags).toEqual(['a', 'b'])
  })

  it('handles empty tags string', () => {
    const r = normalizePrompt({ ...base, tags: '' })
    expect(r.tags).toEqual([])
  })

  it('defaults missing tags to empty array', () => {
    const r = normalizePrompt({ ...base, tags: undefined })
    expect(r.tags).toEqual([])
  })

  it('keeps tags if already array', () => {
    const tags = ['x']
    const r = normalizePrompt({ ...base, tags })
    expect(r.tags).toBe(tags)
  })

  it('coerces boolean flags', () => {
    const r = normalizePrompt({ ...base, is_liked: 0, is_favorited: 1, is_frozen: 'yes' })
    expect(r.isLiked).toBe(false)
    expect(r.isFavorited).toBe(true)
    expect(r.isFrozen).toBe(true)
  })

  it('converts user_id to string', () => {
    expect(normalizePrompt({ ...base, user_id: 99 }).authorId).toBe('99')
    expect(normalizePrompt({ ...base }).authorId).toBeNull()
    expect(normalizePrompt({ ...base, user_id: 0 }).authorId).toBeNull()
  })

  it('defaults missing optional fields', () => {
    const r = normalizePrompt({ id: 1 })
    expect(r.title).toBe('')
    expect(r.subtitle).toBe('')
    expect(r.prompt).toBe('')
    expect(r.negativePrompt).toBeNull()
    expect(r.likesCount).toBe(0)
    expect(r.createdAt).toBe('')
    expect(r.width).toBeNull()
    expect(r.height).toBeNull()
    expect(r.name).toBeNull()
    expect(r.category).toBeNull()
    expect(r.categoryLabel).toBeNull()
  })

  it('categoryLabel falls back to category', () => {
    const r = normalizePrompt({ ...base, category_label: undefined, category: 'cat' })
    expect(r.categoryLabel).toBe('cat')
  })
})

describe('normalizeList', () => {
  it('normalizes array of image items', () => {
    const items = [
      { id: 1, filename: 'a.png' },
      { id: 2, filename: 'b.png' },
    ]
    const result = normalizeList(items, 'image')
    expect(result).toHaveLength(2)
    expect(result[0]._type).toBe('image')
    expect(result[0].id).toBe('1')
    expect(result[1].id).toBe('2')
  })

  it('normalizes array of prompt items', () => {
    const items = [{ id: 10, name: 'p1' }]
    const result = normalizeList(items, 'prompt')
    expect(result).toHaveLength(1)
    expect(result[0]._type).toBe('prompt')
    expect(result[0].id).toBe('10')
  })

  it('defaults to prompt normalizer for unknown type', () => {
    const items = [{ id: 1, name: 'x' }]
    const result = normalizeList(items, 'other')
    expect(result[0]._type).toBe('prompt')
  })

  it('returns empty array for empty input', () => {
    expect(normalizeList([], 'image')).toEqual([])
    expect(normalizeList([], 'prompt')).toEqual([])
  })
})

export function normalizeImage(raw) {
  const metadata = typeof raw.metadata === 'string' ? JSON.parse(raw.metadata || '{}') : (raw.metadata || {})
  return {
    _type: 'image',
    _raw: raw,
    id: String(raw.id),
    title: '',
    subtitle: raw.prompt || '',
    prompt: raw.prompt || '',
    thumbUrl: `/api/images/thumb/${raw.filename}`,
    fullUrl: `/api/images/file/${raw.filename}`,
    author: raw.nickname || raw.username || '',
    createdAt: raw.created_at || '',
    likesCount: raw.likes_count || 0,
    isLiked: !!raw.is_liked,
    isFrozen: !!raw.is_frozen,
    filename: raw.filename,
    metadataType: metadata.type || null,
    metadataSize: metadata.size || null,
    name: null,
    negativePrompt: null,
    tags: null,
    category: null,
    categoryLabel: null,
    imagePath: null,
  }
}

export function normalizePrompt(raw) {
  const hasImage = !!raw.image_path
  return {
    _type: 'prompt',
    _raw: raw,
    id: String(raw.id),
    title: raw.name || '',
    subtitle: raw.name || raw.prompt || '',
    prompt: raw.prompt || '',
    thumbUrl: hasImage ? `/api/prompts/evo-thumb/${raw.image_path}?size=400` : null,
    fullUrl: hasImage ? `/api/prompts/evo-thumb/${raw.image_path}?size=800` : null,
    author: raw.author || raw.nickname || raw.username || '',
    createdAt: raw.created_at || '',
    likesCount: raw.likes_count || 0,
    isLiked: !!raw.is_liked,
    isFrozen: !!raw.is_frozen,
    filename: null,
    metadataType: null,
    metadataSize: null,
    name: raw.name || null,
    negativePrompt: raw.negative_prompt || null,
    tags: Array.isArray(raw.tags) ? raw.tags : (typeof raw.tags === 'string' ? JSON.parse(raw.tags || '[]') : []),
    category: raw.category || null,
    categoryLabel: raw.category_label || raw.category || null,
    imagePath: raw.image_path || null,
  }
}

export function normalizeList(items, type) {
  const fn = type === 'image' ? normalizeImage : normalizePrompt
  return items.map(fn)
}

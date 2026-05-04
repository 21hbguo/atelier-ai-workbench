export function normalizeImage(raw) {
  const metadata = typeof raw.metadata === 'string' ? JSON.parse(raw.metadata || '{}') : (raw.metadata || {})
  return {
    _type: 'image',
    _raw: raw,
    id: String(raw.id),
    title: '',
    subtitle: raw.prompt || '',
    prompt: raw.prompt || '',
    thumbUrl: `/api/images/thumb/${raw.filename}?size=400`,
    thumbUrl2x: `/api/images/thumb/${raw.filename}?size=800`,
    fullUrl: `/api/images/file/${raw.filename}`,
    author: raw.nickname || raw.username || '',
    authorId: raw.user_id ? String(raw.user_id) : null,
    createdAt: raw.created_at || '',
    likesCount: raw.likes_count || 0,
    isLiked: !!raw.is_liked,
    isFavorited: !!raw.is_favorited,
    isFrozen: !!raw.is_frozen,
    filename: raw.filename,
    width: raw.width || null,
    height: raw.height || null,
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
  const isFullUrl = hasImage && raw.image_path.startsWith('http')
  return {
    _type: 'prompt',
    _raw: raw,
    id: String(raw.id),
    title: raw.name || '',
    subtitle: raw.name || raw.prompt || '',
    prompt: raw.prompt || '',
    thumbUrl: hasImage ? (isFullUrl ? raw.image_path : `/api/prompts/evo-thumb/${raw.image_path}?size=400`) : null,
    thumbUrl2x: hasImage ? (isFullUrl ? raw.image_path : `/api/prompts/evo-thumb/${raw.image_path}?size=800`) : null,
    fullUrl: hasImage ? (isFullUrl ? raw.image_path : `/api/prompts/evo-thumb/${raw.image_path}?size=800`) : null,
    author: raw.author || raw.nickname || raw.username || '',
    authorId: raw.user_id ? String(raw.user_id) : null,
    authorName: raw.author || raw.nickname || raw.username || '',
    createdAt: raw.created_at || '',
    likesCount: raw.likes_count || 0,
    isLiked: !!raw.is_liked,
    isFavorited: !!raw.is_favorited,
    isFrozen: !!raw.is_frozen,
    filename: null,
    width: raw.width || null,
    height: raw.height || null,
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

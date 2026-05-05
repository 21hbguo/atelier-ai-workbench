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
    author: raw.nickname || raw.account || raw.username || '',
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
    category: raw.category || null,
    categoryLabel: raw.category_label || raw.category || null,
    imagePath: null,
  }
}

export function normalizePrompt(raw) {
  const hasImage = !!raw.image_path
  const isEvoPath = hasImage && raw.image_path.includes('/')
  const promptImgUrl = hasImage ? (isEvoPath ? `/api/prompts/evo-thumb/${raw.image_path}` : `/api/prompts/image/${raw.image_path}`) : null
  return {
    _type: 'prompt',
    _raw: raw,
    id: String(raw.id),
    title: raw.name || '',
    subtitle: raw.name || raw.prompt || '',
    prompt: raw.prompt || '',
    thumbUrl: promptImgUrl ? (isEvoPath ? `${promptImgUrl}?size=400` : promptImgUrl) : null,
    thumbUrl2x: promptImgUrl ? (isEvoPath ? `${promptImgUrl}?size=800` : promptImgUrl) : null,
    fullUrl: promptImgUrl ? (isEvoPath ? `${promptImgUrl}?size=800` : promptImgUrl) : null,
    author: raw.author || raw.nickname || raw.account || raw.username || '',
    authorId: raw.user_id ? String(raw.user_id) : null,
    authorName: raw.author || raw.nickname || raw.account || raw.username || '',
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

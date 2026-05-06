import { useEffect, useState } from 'react'
export function getMediaRatio(width, height, fallback = '1 / 1') { const w = Number(width) || 0; const h = Number(height) || 0; return w > 0 && h > 0 ? `${w} / ${h}` : fallback }
export default function ProgressiveImage({ src, srcSet, sizes, width, height, alt = '', draggable = false, className = '', loading = 'lazy', ratio = '1 / 1', fallback = null, onLoad, onError }) {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => { setReady(false); setFailed(false) }, [src, srcSet])
  if (!src || failed) return fallback
  return <div className="progressive-image-shell" style={{ aspectRatio: ratio }}><div className={`progressive-image-placeholder ${ready ? 'is-hidden' : ''}`} /><img src={src} srcSet={srcSet} sizes={sizes} width={width || undefined} height={height || undefined} alt={alt} draggable={draggable} loading={loading} className={`progressive-image ${ready ? 'is-ready' : ''} ${className}`.trim()} onLoad={(e) => { setReady(true); onLoad?.(e) }} onError={(e) => { setFailed(true); onError?.(e) }} /></div>
}

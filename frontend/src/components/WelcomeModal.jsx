import { Gift, X, Sparkles } from 'lucide-react'

export default function WelcomeModal({ points, onClose }) {
  if (!points) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm rounded-2xl overflow-hidden animate-fade-in-up" style={{ background: 'var(--bg-primary)' }} onClick={e => e.stopPropagation()}>
        <div className="relative px-6 pt-8 pb-6 text-center" style={{ background: 'linear-gradient(135deg, #B0D1BB 0%, #8CB39E 100%)' }}>
          <button onClick={onClose} className="absolute top-3 right-3 p-1 rounded-full bg-white/20 hover:bg-white/30 transition-colors">
            <X size={16} className="text-white" />
          </button>
          <div className="w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.25)' }}>
            <Gift size={32} className="text-white" />
          </div>
          <h2 className="text-white text-lg font-bold">欢迎加入 Atelier</h2>
          <p className="text-white/80 text-xs mt-1">开启你的 AI 创作之旅</p>
        </div>
        <div className="px-6 py-5 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-2">
            <Sparkles size={18} style={{ color: 'var(--accent)' }} />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>注册赠送</span>
          </div>
          <div className="flex items-baseline justify-center gap-1 mb-4">
            <span className="text-4xl font-bold" style={{ color: 'var(--accent)' }}>{points}</span>
            <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>积分</span>
          </div>
          <p className="text-xs leading-relaxed mb-5" style={{ color: 'var(--text-secondary)' }}>
            积分可用于生成 AI 图片，每日签到也可获取积分哦
          </p>
          <button onClick={onClose} className="w-full py-2.5 rounded-2xl text-sm font-medium text-white hover:opacity-90 active:scale-[0.98] transition-all" style={{ background: 'var(--accent)' }}>
            开始创作
          </button>
        </div>
      </div>
    </div>
  )
}

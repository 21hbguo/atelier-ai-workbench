import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { configAPI } from '../api'

const FEATURES = [
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    ),
    title: '多模型聚合',
    desc: '一个入口调用 GPT-5.6-sol、KIMI-k3、GPT-Image-2 等主流大模型',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
    title: '多模态创作',
    desc: '对话、生图、图像理解，多种模态自由切换',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    title: 'AI 助手对话',
    desc: '智能对话，帮你优化提示词、激发创作灵感',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
        <polyline points="16 6 12 2 8 6" />
        <line x1="12" y1="2" x2="12" y2="15" />
      </svg>
    ),
    title: '私人服务器',
    desc: '独立部署，数据自主可控，安全私密',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v18M3 12h18" />
        <circle cx="12" cy="12" r="9" />
      </svg>
    ),
    title: '安全合规',
    desc: '内容安全管控，使用安心可靠',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      </svg>
    ),
    title: '每日签到',
    desc: '每天签到领取免费积分，持续使用零成本',
  },
]

const SHOWCASE_IMAGES = [
  {
    prompt: '赛博朋克城市夜景，霓虹灯光，雨夜街道',
    style: 'cyberpunk',
  },
  {
    prompt: '水墨风格山水画，云雾缭绕',
    style: 'ink',
  },
  {
    prompt: '可爱卡通角色设计，3D 渲染风格',
    style: 'cartoon',
  },
  {
    prompt: '极简主义产品摄影，纯白背景',
    style: 'minimal',
  },
]

export default function LandingPage() {
  const navigate = useNavigate()
  const [registerEnabled, setRegisterEnabled] = useState(true)

  useEffect(() => {
    configAPI.get().then(({ data }) => {
      setRegisterEnabled(data?.register_enabled !== false)
    }).catch(() => {})
  }, [])

  // LandingPage 不做自动跳转，由 App.jsx 路由层处理

  return (
    <div className="landing-page">
      {/* Hero */}
      <section className="landing-hero">
        <div className="landing-hero-inner">
          <div className="landing-hero-left">
            <div className="landing-brand">
              <h1 className="landing-title">Atelier</h1>
              <p className="landing-subtitle">AI 工作台</p>
            </div>
            <p className="landing-tagline">
              一个工作台，聚合主流大模型，多模态对话与创作随心切换
            </p>
            <p className="landing-model-badge">
              现已支持 GPT-5.6-sol · KIMI-k3 · GPT-Image-2
            </p>
            <div className="landing-cta-group">
              {registerEnabled ? (
                <button
                  className="landing-btn-primary"
                  onClick={() => navigate('/login?mode=register')}
                >
                  免费注册
                </button>
              ) : null}
              <button
                className="landing-btn-secondary"
                onClick={() => navigate('/login')}
              >
                已有账号？登录
              </button>
            </div>
            <div className="landing-stats">
              <div className="landing-stat">
                <span className="landing-stat-value">3+</span>
                <span className="landing-stat-label">主流大模型</span>
              </div>
              <div className="landing-stat-divider" />
              <div className="landing-stat">
                <span className="landing-stat-value">多模态</span>
                <span className="landing-stat-label">对话 · 生图 · 文档</span>
              </div>
              <div className="landing-stat-divider" />
              <div className="landing-stat">
                <span className="landing-stat-value">免费</span>
                <span className="landing-stat-label">注册即送积分</span>
              </div>
            </div>
          </div>
          <div className="landing-hero-right">
            <div className="landing-showcase-grid">
              {SHOWCASE_IMAGES.map((item, i) => (
                <div key={i} className={`landing-showcase-card landing-showcase-${item.style}`}>
                  <div className="landing-showcase-overlay">
                    <span className="landing-showcase-prompt">{item.prompt}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="landing-features">
        <h2 className="landing-section-title">核心功能</h2>
        <p className="landing-section-desc">从对话到创作，一站式多模态 AI 工作台</p>
        <div className="landing-features-grid">
          {FEATURES.map((f, i) => (
            <div key={i} className="landing-feature-card">
              <div className="landing-feature-icon">{f.icon}</div>
              <h3 className="landing-feature-title">{f.title}</h3>
              <p className="landing-feature-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Models */}
      <section className="landing-models">
        <h2 className="landing-section-title">支持的模型</h2>
        <p className="landing-section-desc">聚合业界主流大模型，按需切换</p>
        <div className="landing-models-grid">
          <div className="landing-model-card landing-model-featured">
            <div className="landing-model-badge">主力模型</div>
            <h3 className="landing-model-name">GPT-5.6-sol</h3>
            <p className="landing-model-provider">旗舰对话模型</p>
            <ul className="landing-model-features">
              <li>多模态对话与推理</li>
              <li>写作、编程、分析</li>
              <li>图像理解</li>
            </ul>
          </div>
          <div className="landing-model-card">
            <h3 className="landing-model-name">KIMI-k3</h3>
            <p className="landing-model-provider">长文本对话模型</p>
            <ul className="landing-model-features">
              <li>长文档理解与总结</li>
              <li>多轮对话</li>
              <li>知识问答</li>
            </ul>
          </div>
          <div className="landing-model-card">
            <h3 className="landing-model-name">GPT-Image-2</h3>
            <p className="landing-model-provider">图像生成模型</p>
            <ul className="landing-model-features">
              <li>文生图、图生图</li>
              <li>多风格高清出图</li>
              <li>提示词智能优化</li>
            </ul>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="landing-cta-section">
        <div className="landing-cta-card">
          <h2 className="landing-cta-title">开始你的 AI 工作台之旅</h2>
          <p className="landing-cta-desc">注册即送免费积分，无需绑定支付方式</p>
          <div className="landing-cta-buttons">
            {registerEnabled ? (
              <button
                className="landing-btn-primary landing-btn-lg"
                onClick={() => navigate('/login?mode=register')}
              >
                立即注册
              </button>
            ) : null}
            <button
              className="landing-btn-secondary landing-btn-lg"
              onClick={() => navigate('/login')}
            >
              登录
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <p>Atelier · AI 工作台</p>
        <div className="landing-footer-links">
          <button onClick={() => navigate('/agreement')}>用户协议</button>
          <span className="landing-footer-sep">·</span>
          <button onClick={() => navigate('/privacy')}>隐私政策</button>
        </div>
      </footer>
    </div>
  )
}

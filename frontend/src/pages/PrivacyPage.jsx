import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function PrivacyPage() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen py-12 px-4" style={{ background: 'var(--bg-primary)' }}>
      <div className="max-w-3xl mx-auto">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 mb-4 text-sm hover:opacity-80 transition-opacity" style={{ color: 'var(--text-secondary)' }}>
          <ArrowLeft size={16} />返回
        </button>
        <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>隐私政策</h1>
        <div className="prose prose-sm max-w-none space-y-4" style={{ color: 'var(--text-secondary)' }}>
          <p className="text-xs opacity-60">最后更新日期：2026年5月5日</p>

          <h2 className="text-base font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>一、信息收集</h2>
          <p>我们收集以下信息以提供服务：</p>
          <p>1. <strong>账号信息</strong>：注册时提供的邮箱地址、昵称、密码（加密存储）。</p>
          <p>2. <strong>使用数据</strong>：生成的提示词、上传的参考图片、生成结果、操作日志。</p>
          <p>3. <strong>设备信息</strong>：IP 地址、浏览器类型、登录时间，用于安全风控。</p>
          <p>4. <strong>支付信息</strong>：充值记录、支付凭证（如有），用于订单管理。</p>

          <h2 className="text-base font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>二、信息使用</h2>
          <p>我们使用收集的信息用于：</p>
          <p>1. 提供、维护和改进本平台的各项服务；</p>
          <p>2. 处理积分充值、消费和退款等交易；</p>
          <p>3. 进行安全监控，防范欺诈和滥用行为；</p>
          <p>4. 发送服务通知、安全提醒等必要信息；</p>
          <p>5. 统计分析，优化平台性能和用户体验。</p>

          <h2 className="text-base font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>三、信息存储与安全</h2>
          <p>1. 用户密码采用 bcrypt 加密存储，我们无法获取您的原始密码。</p>
          <p>2. 敏感配置信息（如 API 密钥）与应用配置分离存储。</p>
          <p>3. 采用 JWT + Refresh Token 双重认证机制保护用户会话安全。</p>
          <p>4. 对关键操作实施频率限制和风控检测。</p>
          <p>5. 数据存储在安全的服务器环境中，采取合理的技术措施防止未经授权的访问。</p>

          <h2 className="text-base font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>四、信息共享</h2>
          <p>我们不会将您的个人信息出售给第三方。以下情况除外：</p>
          <p>1. <strong>AI 服务提供商</strong>：您的提示词和参考图片会发送至 AI 模型服务商进行图像生成处理。</p>
          <p>2. <strong>图床服务</strong>：生成的图片可能存储于第三方图床以提供访问服务。</p>
          <p>3. <strong>法律要求</strong>：根据法律法规、诉讼或政府主管部门的要求披露信息。</p>

          <h2 className="text-base font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>五、用户权利</h2>
          <p>1. 您有权查看和修改您的账号信息。</p>
          <p>2. 您有权删除您的生成图片和历史记录。</p>
          <p>3. 您有权撤回分享至广场的内容。</p>
          <p>4. 您有权申请注销账号，注销后我们将删除您的个人数据（法律法规要求保留的除外）。</p>

          <h2 className="text-base font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>六、Cookie 与本地存储</h2>
          <p>本平台使用 Cookie 和浏览器本地存储来：</p>
          <p>1. 维持您的登录状态；</p>
          <p>2. 存储您的界面偏好设置（如主题模式）；</p>
          <p>3. 缓存任务数据以提升使用体验。</p>
          <p>您可以通过浏览器设置清除这些数据，但可能影响正常使用。</p>

          <h2 className="text-base font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>七、未成年人保护</h2>
          <p>本平台不面向未满 18 周岁的用户提供服务。如我们发现未成年人注册使用，将删除相关账号和数据。</p>

          <h2 className="text-base font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>八、政策更新</h2>
          <p>我们可能会不时更新本隐私政策，更新后的政策将在平台上公布。重大变更时我们会通过平台通知告知您。</p>

          <h2 className="text-base font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>九、联系我们</h2>
          <p>如您对本隐私政策有任何疑问，请通过平台内的反馈功能或客服渠道联系我们。</p>
        </div>
      </div>
    </div>
  )
}

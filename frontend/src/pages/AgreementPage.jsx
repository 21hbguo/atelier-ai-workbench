import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function AgreementPage() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen py-12 px-4" style={{ background: 'var(--bg-primary)' }}>
      <div className="max-w-3xl mx-auto">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 mb-4 text-sm hover:opacity-80 transition-opacity" style={{ color: 'var(--text-secondary)' }}>
          <ArrowLeft size={16} />返回
        </button>
        <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>用户协议</h1>
        <div className="prose prose-sm max-w-none space-y-4" style={{ color: 'var(--text-secondary)' }}>
          <p className="text-xs opacity-60">最后更新日期：2026年5月5日</p>

          <h2 className="text-base font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>一、服务说明</h2>
          <p>Atelier · AI 工作台（以下简称"本平台"）是一个多模态 AI 服务平台。用户通过消耗积分使用 AI 图像生成、提示词优化等功能。注册并使用本平台即表示您同意本协议的全部条款。</p>

          <h2 className="text-base font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>二、账号注册</h2>
          <p>1. 用户需通过邮箱验证码完成注册，注册时需提供有效的邮箱地址。</p>
          <p>2. 每个用户仅可注册一个账号，禁止批量注册或恶意注册。</p>
          <p>3. 用户应妥善保管账号信息，因账号泄露造成的损失由用户自行承担。</p>
          <p>4. 本平台保留冻结或删除违规账号的权利。</p>

          <h2 className="text-base font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>三、积分与充值</h2>
          <p>1. 积分是本平台的站内虚拟权益，用于 AI 图像生成、提示词优化、图片续期等功能消耗。</p>
          <p>2. 新用户注册即赠送一定积分，每日签到可获得额外积分。</p>
          <p>3. 用户可通过自愿充值支持平台运行，平台会按页面公示规则赠送对应积分。</p>
          <p>4. 充值属于用户自愿支持行为，不构成商品购买、预付储值或持续服务承诺。</p>
          <p>5. 积分不可转让、不可提现、不可跨账号转移；如遇生成失败，系统将自动退还本次消耗积分。</p>

          <h2 className="text-base font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>四、图片生成与存储</h2>
          <p>1. 用户通过本平台生成的图片，默认保留 2 天，到期后自动清理。</p>
          <p>2. 用户可通过消耗积分延长图片有效期，分享至广场的图片将被永久保留。</p>
          <p>3. 用户应自行备份重要图片，本平台不对图片丢失承担责任。</p>
          <p>4. AI 生成的图片版权归用户所有，但用户应遵守相关法律法规。</p>

          <h2 className="text-base font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>五、使用规范</h2>
          <p>用户不得利用本平台生成、传播以下内容：</p>
          <p>1. 违反国家法律法规的内容；</p>
          <p>2. 涉及色情、暴力、恐怖主义的内容；</p>
          <p>3. 侵犯他人知识产权、肖像权、隐私权的内容；</p>
          <p>4. 涉及政治敏感、宗教极端的内容；</p>
          <p>5. 其他违反公序良俗或可能对他人造成伤害的内容。</p>
          <p>违反上述规范的，本平台有权删除违规内容、冻结或删除违规账号，且不予退还已消耗积分。</p>

          <h2 className="text-base font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>六、社区广场</h2>
          <p>1. 用户可将生成的图片分享至广场，供其他用户浏览和收藏。</p>
          <p>2. 分享至广场的内容视为公开内容，其他用户可查看和使用。</p>
          <p>3. 用户可随时撤回分享，撤回后图片将从广场移除。</p>
          <p>4. 本平台有权对广场内容进行审核和管理。</p>

          <h2 className="text-base font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>七、免责声明</h2>
          <p>1. AI 生成结果具有随机性，本平台不保证生成结果完全符合用户预期。</p>
          <p>2. 因不可抗力、第三方服务中断等原因导致的服务异常，本平台不承担责任。</p>
          <p>3. 本平台不对用户使用 AI 生成内容所产生的任何后果承担责任。</p>

          <h2 className="text-base font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>八、协议修改</h2>
          <p>本平台有权根据业务需要修改本协议，修改后的协议将在平台上公布。继续使用本平台即视为同意修改后的协议。</p>
        </div>
      </div>
    </div>
  )
}

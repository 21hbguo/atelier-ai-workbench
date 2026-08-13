import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function RefundPage() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen py-12 px-4" style={{ background: 'var(--bg-primary)' }}>
      <div className="max-w-3xl mx-auto">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 mb-4 text-sm hover:opacity-80 transition-opacity" style={{ color: 'var(--text-secondary)' }}>
          <ArrowLeft size={16} />返回
        </button>
        <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>充值说明与积分规则</h1>
        <div className="prose prose-sm max-w-none space-y-4" style={{ color: 'var(--text-secondary)' }}>
          <p className="text-xs opacity-60">最后更新日期：2026年5月5日</p>

          <h2 className="text-base font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>一、积分消耗规则</h2>
          <p>1. 每次 AI 图像生成消耗相应积分，具体消耗量以生成页面显示为准。</p>
          <p>2. 图片有效期延长操作按图片数量扣积分，具体单价以延长页面显示为准。</p>
          <p>3. 积分在提交生成请求时立即扣除。</p>

          <h2 className="text-base font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>二、自动退还</h2>
          <p>以下情况系统将自动退还已消耗的积分：</p>
          <p>1. <strong>生成失败</strong>：因系统原因或 AI 服务异常导致的生成失败，积分自动退还至账户。</p>
          <p>2. <strong>提示词优化失败</strong>：优化服务异常时，自动退还本次消耗。</p>
          <p>3. <strong>内容审核拦截</strong>：因触发违禁词检测而被拦截的请求，积分自动退还。</p>

          <h2 className="text-base font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>三、充值说明</h2>
          <p>1. 用户可通过微信或支付宝自愿充值支持平台运行，平台按页面规则赠送对应积分。</p>
          <p>2. 充值属于个人自愿支持行为，不构成商品购买、预付储值或持续服务承诺。</p>
          <p>3. 充值完成并发放积分后，不支持回退发放，请按需理性支持。</p>
          <p>4. 如遇凭证异常、发放异常等情况，用户可联系平台核查处理。</p>

          <h2 className="text-base font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>四、不支持回退的情况</h2>
          <p>以下情况不支持回退发放或额外补偿：</p>
          <p>1. 已成功生成图片并完成交付的订单；</p>
          <p>2. 用户对生成结果不满意（AI 生成具有随机性，不保证完全符合预期）；</p>
          <p>3. 因用户违反平台规定导致账号被冻结或封禁的；</p>
          <p>4. 通过兑换码获取的积分；</p>
          <p>5. 签到、活动赠送等免费获取的积分。</p>

          <h2 className="text-base font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>五、特别说明</h2>
          <p>1. 平台保留在合理范围内调整积分消耗标准的权利，调整前将提前公告通知。</p>
          <p>2. 如遇系统故障或不可抗力导致的大规模服务中断，平台将视情况进行积分补偿或异常核查。</p>
          <p>3. 本规则的最终解释权归 Atelier · AI 工作台所有。</p>
        </div>
      </div>
    </div>
  )
}

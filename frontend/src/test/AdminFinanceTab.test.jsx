import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../components/Pagination', () => ({
  default: ({ page, totalPages, onPageChange }) => (
    <div data-testid="pagination">
      <span>{page}/{totalPages}</span>
      <button onClick={() => onPageChange(page + 1)}>next</button>
    </div>
  ),
}))

import AdminFinanceTab from '../pages/admin-tabs/AdminFinanceTab'

const defaultOverview = {
  summary: {
    revenue_amount: 1000,
    purchased_cost: 500,
    cost_amount: 300,
    profit_amount: 700,
    profit_rate: 70,
    total_calls: 50,
    missing_rule_calls: 2,
    insufficient_calls: 1,
  },
  purchases: {},
  rules: [],
  start_date: '2026-04-01',
  end_date: '2026-05-01',
}

const defaultProps = {
  financeRange: '30d',
  setFinanceRange: vi.fn(),
  financeOverview: defaultOverview,
  financeProviders: [],
  financePurchases: [],
  financePurchaseTotal: 0,
  financePurchasePage: 1,
  setFinancePurchasePage: vi.fn(),
  financeTasks: [],
  financeTaskTotal: 0,
  financeTaskPage: 1,
  setFinanceTaskPage: vi.fn(),
  financeProviderFilter: '',
  setFinanceProviderFilter: vi.fn(),
  financeTaskProviderFilter: '',
  setFinanceTaskProviderFilter: vi.fn(),
  financeModelFilter: '',
  setFinanceModelFilter: vi.fn(),
  financeStatusFilter: '',
  setFinanceStatusFilter: vi.fn(),
  financeLoading: false,
  financeCreatingPurchase: false,
  financePurchaseDraft: { id: null, provider_id: '', amount_rmb: '', quota_amount: '', purchase_date: '2026-05-01 12:00:00', remark: '', can_edit_core: true, consumed_quota: 0, adjust_consumed: '' },
  setFinancePurchaseDraft: vi.fn(),
  handleCreatePurchase: vi.fn(),
  handleEditPurchase: vi.fn(),
  handleDeletePurchase: vi.fn(),
  handleCancelPurchaseEdit: vi.fn(),
  providerOptions: [],
  modelOptions: [],
  financeRules: [],
  financeRuleDraft: { id: null, provider_id: '', model_id: '', quota_per_success: '', enabled: true, remark: '' },
  setFinanceRuleDraft: vi.fn(),
  financeRuleSaving: false,
  handleSaveFinanceRule: vi.fn(),
  handleEditFinanceRule: vi.fn(),
  handleDeleteFinanceRule: vi.fn(),
}

const renderTab = (overrides = {}) =>
  render(<AdminFinanceTab {...defaultProps} {...overrides} />)

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AdminFinanceTab', () => {
  it('shows loading spinner when loading and no overview', () => {
    renderTab({ financeLoading: true, financeOverview: null })
    expect(document.querySelector('.animate-spin-slow')).toBeInTheDocument()
  })

  it('renders range buttons', () => {
    renderTab()
    expect(screen.getByText('today')).toBeInTheDocument()
    expect(screen.getByText('7d')).toBeInTheDocument()
    expect(screen.getByText('30d')).toBeInTheDocument()
    expect(screen.getByText('all')).toBeInTheDocument()
  })

  it('highlights current range', () => {
    renderTab({ financeRange: '7d' })
    const btn7d = screen.getByText('7d')
    expect(btn7d.className).toContain('text-white')
  })

  it('calls setFinanceRange on range click', () => {
    const setFinanceRange = vi.fn()
    renderTab({ setFinanceRange })
    fireEvent.click(screen.getByText('today'))
    expect(setFinanceRange).toHaveBeenCalledWith('today')
  })

  it('renders overview summary stats', () => {
    renderTab()
    expect(screen.getByText('¥1000')).toBeInTheDocument()
    expect(screen.getByText('¥500')).toBeInTheDocument()
    expect(screen.getByText('¥300')).toBeInTheDocument()
    expect(screen.getByText('¥700')).toBeInTheDocument()
    expect(screen.getByText('70%')).toBeInTheDocument()
    expect(screen.getByText('50')).toBeInTheDocument()
  })

  it('renders date range', () => {
    renderTab()
    expect(screen.getByText('2026-04-01 ~ 2026-05-01')).toBeInTheDocument()
  })

  it('renders provider summary table', () => {
    const financeProviders = [
      { provider_id: 'prov-a', provider_unit_name: 'credits', purchased_quota: 1000, remaining_quota: 500, calls: 30, missing_rule_calls: 1, insufficient_calls: 0 },
    ]
    renderTab({ financeProviders })
    expect(screen.getByText('prov-a')).toBeInTheDocument()
    expect(screen.getByText('credits')).toBeInTheDocument()
  })

  it('shows empty provider summary', () => {
    renderTab({ financeProviders: [] })
    expect(screen.getByText('暂无统计')).toBeInTheDocument()
  })

  it('renders purchases table', () => {
    const financePurchases = [
      {
        id: 1,
        provider_id: 'prov-a',
        can_delete: true,
        remaining_quota: 100,
        provider_unit_name: 'credits',
        amount_rmb: 500,
        quota_amount: 1000,
        consumed_quota: 0,
        unit_cost: 0.5,
      },
    ]
    renderTab({ financePurchases })
    expect(screen.getAllByText('prov-a').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('1000').length).toBeGreaterThanOrEqual(1)
  })

  it('shows empty purchases', () => {
    renderTab({ financePurchases: [] })
    expect(screen.getByText('暂无采购记录')).toBeInTheDocument()
  })

  it('calls handleEditPurchase on edit click', () => {
    const handleEditPurchase = vi.fn()
    const financePurchases = [
      { id: 1, provider_id: 'prov-a', can_delete: true, remaining_quota: 100, provider_unit_name: 'c', amount_rmb: 100, quota_amount: 200, consumed_quota: 0, unit_cost: 0.5 },
    ]
    renderTab({ financePurchases, handleEditPurchase })
    fireEvent.click(screen.getByText('编辑'))
    expect(handleEditPurchase).toHaveBeenCalledWith(financePurchases[0])
  })

  it('calls handleDeletePurchase on delete click for deletable purchase', () => {
    const handleDeletePurchase = vi.fn()
    const financePurchases = [
      { id: 1, provider_id: 'prov-a', can_delete: true, remaining_quota: 100, provider_unit_name: 'c', amount_rmb: 100, quota_amount: 200, consumed_quota: 0, unit_cost: 0.5 },
    ]
    renderTab({ financePurchases, handleDeletePurchase })
    fireEvent.click(screen.getByText('删除'))
    expect(handleDeletePurchase).toHaveBeenCalledWith(financePurchases[0])
  })

  it('does not show delete button for locked purchase', () => {
    const financePurchases = [
      { id: 1, provider_id: 'prov-a', can_delete: false, remaining_quota: 50, provider_unit_name: 'c', amount_rmb: 100, quota_amount: 200, consumed_quota: 150, unit_cost: 0.5 },
    ]
    renderTab({ financePurchases })
    expect(screen.queryByText('删除')).not.toBeInTheDocument()
  })

  it('renders finance rules table', () => {
    const financeRules = [
      { id: 1, provider_id: 'prov-a', model_id: 'm1', model_label: 'Model 1', provider_unit_name: 'credits', quota_per_success: 5, remaining_times: 100, calls: 20, cost_amount: 50 },
    ]
    const overview = { ...defaultOverview, rules: financeRules }
    renderTab({ financeRules, financeOverview: overview })
    expect(screen.getByText('Model 1')).toBeInTheDocument()
    expect(screen.getAllByText('prov-a').length).toBeGreaterThanOrEqual(1)
  })

  it('shows empty rules', () => {
    renderTab({ financeRules: [], financeOverview: { ...defaultOverview, rules: [] } })
    expect(screen.getByText('暂无规则')).toBeInTheDocument()
  })

  it('calls handleSaveFinanceRule on save click', () => {
    const handleSaveFinanceRule = vi.fn()
    renderTab({ handleSaveFinanceRule })
    fireEvent.click(screen.getByText('保存规则'))
    expect(handleSaveFinanceRule).toHaveBeenCalledTimes(1)
  })

  it('shows saving state for rules', () => {
    renderTab({ financeRuleSaving: true })
    expect(screen.getByText('保存中...')).toBeInTheDocument()
  })

  it('calls handleEditFinanceRule on rule edit click', () => {
    const handleEditFinanceRule = vi.fn()
    const financeRules = [
      { id: 1, provider_id: 'prov-a', model_id: 'm1', model_label: 'Model 1', provider_unit_name: 'c', quota_per_success: 5 },
    ]
    renderTab({ financeRules, financePurchases: [], financeOverview: { ...defaultOverview, rules: financeRules }, handleEditFinanceRule })
    const editButtons = screen.getAllByText('编辑')
    fireEvent.click(editButtons[0])
    expect(handleEditFinanceRule).toHaveBeenCalledWith(financeRules[0])
  })

  it('calls handleDeleteFinanceRule on rule delete click', () => {
    const handleDeleteFinanceRule = vi.fn()
    const financeRules = [
      { id: 42, provider_id: 'prov-a', model_id: 'm1', model_label: 'Model 1', provider_unit_name: 'c', quota_per_success: 5 },
    ]
    renderTab({ financeRules, financeOverview: { ...defaultOverview, rules: financeRules }, handleDeleteFinanceRule })
    fireEvent.click(screen.getByText('删除'))
    expect(handleDeleteFinanceRule).toHaveBeenCalledWith(42)
  })

  it('renders tasks table', () => {
    const financeTasks = [
      {
        id: 1,
        task_id: 'task-abc',
        nickname: 'Alice',
        model_label: 'GPT-Image',
        model_id: 'gpt-image-2',
        provider_id: 'prov-a',
        charged_points: 10,
        quota_used: 1,
        quota_shortage: 0,
        cost_rmb: 0.5,
        provider_unit_name: 'credits',
        cost_source: 'purchase',
      },
    ]
    renderTab({ financeTasks })
    expect(screen.getByText('task-abc')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText(/GPT-Image/)).toBeInTheDocument()
  })

  it('shows empty tasks', () => {
    renderTab({ financeTasks: [] })
    expect(screen.getByText('暂无明细')).toBeInTheDocument()
  })

  it('shows purchase form draft values', () => {
    const financePurchaseDraft = { id: null, provider_id: 'prov-a', amount_rmb: '100', quota_amount: '500', purchase_date: '2026-05-01', remark: 'test', can_edit_core: true, consumed_quota: 0, adjust_consumed: '' }
    renderTab({ financePurchaseDraft })
    expect(screen.getByText('新增采购')).toBeInTheDocument()
  })

  it('shows edit mode for existing purchase', () => {
    const financePurchaseDraft = { id: 1, provider_id: 'prov-a', amount_rmb: '100', quota_amount: '500', purchase_date: '2026-05-01', remark: '', can_edit_core: true, consumed_quota: 0, adjust_consumed: '' }
    renderTab({ financePurchaseDraft })
    expect(screen.getByText('保存修改')).toBeInTheDocument()
    expect(screen.getByText('取消编辑')).toBeInTheDocument()
  })
})

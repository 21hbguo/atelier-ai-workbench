import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const {
  readUserMock,
  navigateMock,
  locationMock,
  alertMock,
  confirmMock,
  usersMock,
  historyMock,
  adminModelsMock,
  configAdminMock,
  generationAdminMock,
  categoriesMock,
  statsOverviewMock,
  statsGetMock,
  statsSystemMock,
  announcementsListMock,
  financeOverviewMock,
  financeProvidersMock,
  financePurchasesMock,
  financeQuotaRulesMock,
  financeTasksMock,
  emailVerificationsMock,
  listClassificationTasksMock,
  listAuditTasksMock,
  hostingImagesMock,
  imageStatsMock,
  bannedWordsMock,
  rechargeRequestsMock,
  configUpdateMock,
  createUserMock,
  deleteUserMock,
  toggleFreezeMock,
  adjustPointsMock,
  resetPasswordMock,
  migratePointsMock,
  deleteHistoryMock,
  approveRechargeMock,
  rejectRechargeMock,
  refundRechargeMock,
  generateCodesMock,
  deleteCodeMock,
  saveFinanceQuotaRuleMock,
  deleteFinanceQuotaRuleMock,
  createFinancePurchaseMock,
  updateFinancePurchaseMock,
  deleteFinancePurchaseMock,
  addBannedWordMock,
  deleteBannedWordMock,
  batchImportBannedWordsMock,
  batchDeleteHostingMock,
  cleanDuplicatesMock,
  createClassificationTaskMock,
  createAuditTaskMock,
  announcementCreateMock,
  announcementDeleteMock,
  uploadLocalPublicMock,
} = vi.hoisted(() => ({
  readUserMock: vi.fn(),
  navigateMock: vi.fn(),
  locationMock: { search: '', pathname: '/admin' },
  alertMock: vi.fn(),
  confirmMock: vi.fn(async () => true),
  usersMock: vi.fn(async () => ({ data: { users: [], total: 0 } })),
  historyMock: vi.fn(async () => ({ data: { items: [], total: 0, summary: {} } })),
  adminModelsMock: vi.fn(async () => ({ data: { models: [] } })),
  configAdminMock: vi.fn(async () => ({ data: {} })),
  generationAdminMock: vi.fn(async () => ({ data: { default_model_id: 'gpt-image-2', generation_models: {}, generation_providers: {} } })),
  categoriesMock: vi.fn(async () => ({ data: { categories: [] } })),
  statsOverviewMock: vi.fn(async () => ({ data: {} })),
  statsGetMock: vi.fn(async () => ({ data: {} })),
  statsSystemMock: vi.fn(async () => ({ data: {} })),
  announcementsListMock: vi.fn(async () => ({ data: { items: [], total: 0 } })),
  financeOverviewMock: vi.fn(async () => ({ data: {} })),
  financeProvidersMock: vi.fn(async () => ({ data: { providers: [] } })),
  financePurchasesMock: vi.fn(async () => ({ data: { items: [], total: 0 } })),
  financeQuotaRulesMock: vi.fn(async () => ({ data: { items: [] } })),
  financeTasksMock: vi.fn(async () => ({ data: { items: [], total: 0 } })),
  emailVerificationsMock: vi.fn(async () => ({ data: { items: [], total: 0 } })),
  listClassificationTasksMock: vi.fn(async () => ({ data: { items: [], total: 0 } })),
  listAuditTasksMock: vi.fn(async () => ({ data: { items: [], total: 0 } })),
  hostingImagesMock: vi.fn(async () => ({ data: { items: [], total: 0 } })),
  imageStatsMock: vi.fn(async () => ({ data: {} })),
  bannedWordsMock: vi.fn(async () => ({ data: { words: [], total: 0 } })),
  rechargeRequestsMock: vi.fn(async () => ({ data: { items: [], total: 0 } })),
  configUpdateMock: vi.fn(async () => ({ data: {} })),
  createUserMock: vi.fn(async () => ({ data: { user: { account: 'new' } } })),
  deleteUserMock: vi.fn(async () => ({ data: {} })),
  toggleFreezeMock: vi.fn(async () => ({ data: { is_frozen: true } })),
  adjustPointsMock: vi.fn(async () => ({ data: {} })),
  resetPasswordMock: vi.fn(async () => ({ data: {} })),
  migratePointsMock: vi.fn(async () => ({ data: { message: 'ok' } })),
  deleteHistoryMock: vi.fn(async () => ({ data: {} })),
  approveRechargeMock: vi.fn(async () => ({ data: {} })),
  rejectRechargeMock: vi.fn(async () => ({ data: {} })),
  refundRechargeMock: vi.fn(async () => ({ data: { message: 'ok' } })),
  generateCodesMock: vi.fn(async () => ({ data: { codes: [] } })),
  deleteCodeMock: vi.fn(async () => ({ data: {} })),
  saveFinanceQuotaRuleMock: vi.fn(async () => ({ data: {} })),
  deleteFinanceQuotaRuleMock: vi.fn(async () => ({ data: {} })),
  createFinancePurchaseMock: vi.fn(async () => ({ data: {} })),
  updateFinancePurchaseMock: vi.fn(async () => ({ data: {} })),
  deleteFinancePurchaseMock: vi.fn(async () => ({ data: {} })),
  addBannedWordMock: vi.fn(async () => ({ data: {} })),
  deleteBannedWordMock: vi.fn(async () => ({ data: {} })),
  batchImportBannedWordsMock: vi.fn(async () => ({ data: { message: 'ok' } })),
  batchDeleteHostingMock: vi.fn(async () => ({ data: {} })),
  cleanDuplicatesMock: vi.fn(async () => ({ data: { deleted: 0 } })),
  createClassificationTaskMock: vi.fn(async () => ({ data: {} })),
  createAuditTaskMock: vi.fn(async () => ({ data: {} })),
  announcementCreateMock: vi.fn(async () => ({ data: {} })),
  announcementDeleteMock: vi.fn(async () => ({ data: {} })),
  uploadLocalPublicMock: vi.fn(async () => ({ data: { url: '' } })),
}))

vi.mock('../auth', () => ({ readUser: readUserMock }))

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => locationMock,
  MemoryRouter: ({ children }) => children,
}))

vi.mock('../components/AppDialogProvider', () => ({
  useAppDialog: () => ({ alert: alertMock, confirm: confirmMock, choose: vi.fn(async () => null) }),
}))

vi.mock('../api', () => ({
  adminAPI: {
    users: usersMock,
    history: historyMock,
    createUser: createUserMock,
    deleteUser: deleteUserMock,
    toggleFreeze: toggleFreezeMock,
    adjustPoints: adjustPointsMock,
    resetPassword: resetPasswordMock,
    migratePoints: migratePointsMock,
    deleteHistory: deleteHistoryMock,
    statsOverview: statsOverviewMock,
    hostingImages: hostingImagesMock,
    imageStats: imageStatsMock,
    bannedWords: bannedWordsMock,
    addBannedWord: addBannedWordMock,
    deleteBannedWord: deleteBannedWordMock,
    batchImportBannedWords: batchImportBannedWordsMock,
    batchDeleteHosting: batchDeleteHostingMock,
    cleanDuplicates: cleanDuplicatesMock,
    rechargeRequests: rechargeRequestsMock,
    approveRecharge: approveRechargeMock,
    rejectRecharge: rejectRechargeMock,
    refundRecharge: refundRechargeMock,
    generateCodes: generateCodesMock,
    deleteCode: deleteCodeMock,
    financeOverview: financeOverviewMock,
    financeProviders: financeProvidersMock,
    financePurchases: financePurchasesMock,
    financeQuotaRules: financeQuotaRulesMock,
    financeTasks: financeTasksMock,
    createFinancePurchase: createFinancePurchaseMock,
    updateFinancePurchase: updateFinancePurchaseMock,
    deleteFinancePurchase: deleteFinancePurchaseMock,
    saveFinanceQuotaRule: saveFinanceQuotaRuleMock,
    deleteFinanceQuotaRule: deleteFinanceQuotaRuleMock,
    emailVerifications: emailVerificationsMock,
    listClassificationTasks: listClassificationTasksMock,
    createClassificationTask: createClassificationTaskMock,
    listAuditTasks: listAuditTasksMock,
    createAuditTask: createAuditTaskMock,
  },
  configAPI: {
    get: vi.fn(async () => ({ data: {} })),
    admin: configAdminMock,
    update: configUpdateMock,
    generationAdmin: generationAdminMock,
    models: adminModelsMock,
  },
  statsAPI: {
    get: statsGetMock,
    system: statsSystemMock,
  },
  promptAPI: {
    categories: categoriesMock,
    listPublic: vi.fn(async () => ({ data: { prompts: [] } })),
  },
  announcementAPI: {
    list: announcementsListMock,
    create: announcementCreateMock,
    delete: announcementDeleteMock,
    getUnread: vi.fn(async () => ({ data: { items: [] } })),
    markRead: vi.fn(async () => ({ data: {} })),
  },
  uploadAPI: {
    uploadLocalPublic: uploadLocalPublicMock,
  },
  notificationAPI: {
    unreadCount: vi.fn(async () => ({ data: { count: 0 } })),
  },
}))

vi.mock('../components/MainLayout', () => ({ default: ({ children }) => <div data-testid="main-layout">{children}</div> }))
vi.mock('../components/PageLayout', () => ({ default: ({ children, className }) => <div data-testid="page-layout" className={className}>{children}</div> }))
vi.mock('../components/SearchInput', () => ({
  default: ({ value, onChange, placeholder }) => (
    <input data-testid="search-input" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
  ),
}))
vi.mock('../components/Pagination', () => ({
  default: ({ page, totalPages, onPageChange }) => (
    <div data-testid="pagination"><span>{page}/{totalPages}</span></div>
  ),
}))
vi.mock('../components/UnifiedCard', () => ({ default: () => <div /> }))
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  LineChart: () => <div />,
  Line: () => <div />,
  CartesianGrid: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
}))

vi.mock('../pages/admin-tabs/AdminUsersTab', () => ({
  default: ({ userTotal }) => <div data-testid="users-tab">Users Tab ({userTotal})</div>,
}))
vi.mock('../pages/admin-tabs/AdminHistoryTab', () => ({
  default: ({ historyTotal }) => <div data-testid="history-tab">History Tab ({historyTotal})</div>,
}))
vi.mock('../pages/admin-tabs/AdminAnnouncementsTab', () => ({
  default: () => <div data-testid="announcements-tab" />,
}))
vi.mock('../pages/admin-tabs/AdminBannedTab', () => ({ default: () => <div data-testid="banned-tab" /> }))
vi.mock('../pages/admin-tabs/AdminHostingTab', () => ({ default: () => <div data-testid="hosting-tab" /> }))
vi.mock('../pages/admin-tabs/AdminFinanceTab', () => ({ default: () => <div data-testid="finance-tab" /> }))
vi.mock('../pages/admin-tabs/AdminClassificationTab', () => ({ default: () => <div data-testid="classification-tab" /> }))

import AdminPage from '../pages/AdminPage'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../ThemeContext'
import { LayoutModeProvider } from '../LayoutModeContext'

const renderPage = (userOverrides = {}) => {
  readUserMock.mockReturnValue({
    id: 1,
    username: 'admin',
    nickname: 'Admin',
    is_admin: true,
    points: 100,
    ...userOverrides,
  })
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <LayoutModeProvider>
          <AdminPage />
        </LayoutModeProvider>
      </ThemeProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  locationMock.search = ''
  locationMock.pathname = '/admin'
  confirmMock.mockResolvedValue(true)
})

describe('AdminPage', () => {
  it('shows blocked message for non-admin user', () => {
    renderPage({ is_admin: false })
    expect(screen.getByText('需要管理员权限')).toBeInTheDocument()
  })

  it('shows blocked message when no user', () => {
    readUserMock.mockReturnValue(null)
    render(
      <MemoryRouter>
        <ThemeProvider>
          <LayoutModeProvider>
            <AdminPage />
          </LayoutModeProvider>
        </ThemeProvider>
      </MemoryRouter>
    )
    expect(screen.getByText('需要管理员权限')).toBeInTheDocument()
  })

  it('renders tab bar for admin user', async () => {
    renderPage()
    await waitFor(() => expect(usersMock).toHaveBeenCalled())
    expect(screen.getByText('系统统计')).toBeInTheDocument()
    expect(screen.getByText('财务中心')).toBeInTheDocument()
    expect(screen.getByText('用户管理')).toBeInTheDocument()
    expect(screen.getByText('生成历史')).toBeInTheDocument()
    expect(screen.getByText('图床管理')).toBeInTheDocument()
    expect(screen.getByText('违禁词管理')).toBeInTheDocument()
    expect(screen.getByText('AI分类')).toBeInTheDocument()
    expect(screen.getByText('兑换码')).toBeInTheDocument()
    expect(screen.getByText('充值审核')).toBeInTheDocument()
    expect(screen.getByText('公告管理')).toBeInTheDocument()
    expect(screen.getByText('邮件验证')).toBeInTheDocument()
    expect(screen.getByText('配置中心')).toBeInTheDocument()
  })

  it('defaults to users tab', async () => {
    renderPage()
    await waitFor(() => expect(usersMock).toHaveBeenCalled())
    expect(screen.getByTestId('users-tab')).toBeInTheDocument()
  })

  it('switches to history tab on click', async () => {
    renderPage()
    await waitFor(() => expect(usersMock).toHaveBeenCalled())
    fireEvent.click(screen.getByText('生成历史'))
    expect(navigateMock).toHaveBeenCalledWith('/admin?tab=history', { replace: true })
    await waitFor(() => expect(historyMock).toHaveBeenCalled())
    expect(screen.getByTestId('history-tab')).toBeInTheDocument()
  })

  it('switches to announcements tab on click', async () => {
    renderPage()
    await waitFor(() => expect(usersMock).toHaveBeenCalled())
    fireEvent.click(screen.getByText('公告管理'))
    expect(navigateMock).toHaveBeenCalledWith('/admin?tab=announcements', { replace: true })
    await waitFor(() => expect(announcementsListMock).toHaveBeenCalled())
  })

  it('switches to config tab on click', async () => {
    renderPage()
    await waitFor(() => expect(usersMock).toHaveBeenCalled())
    fireEvent.click(screen.getByText('配置中心'))
    expect(navigateMock).toHaveBeenCalledWith('/admin?tab=config', { replace: true })
    await waitFor(() => expect(configAdminMock).toHaveBeenCalled())
  })

  it('navigates to /admin when switching to users tab', async () => {
    renderPage()
    await waitFor(() => expect(usersMock).toHaveBeenCalled())
    fireEvent.click(screen.getByText('系统统计'))
    fireEvent.click(screen.getByText('用户管理'))
    expect(navigateMock).toHaveBeenCalledWith('/admin', { replace: true })
  })

  it('reads tab from URL search params', async () => {
    locationMock.search = '?tab=announcements'
    renderPage()
    await waitFor(() => expect(announcementsListMock).toHaveBeenCalled())
    expect(screen.getByTestId('announcements-tab')).toBeInTheDocument()
  })

  it('loads configAPI.models on mount', async () => {
    renderPage()
    await waitFor(() => expect(adminModelsMock).toHaveBeenCalled())
  })

  it('loads promptAPI.categories on mount', async () => {
    renderPage()
    await waitFor(() => expect(categoriesMock).toHaveBeenCalled())
  })

  it('loads users when on users tab', async () => {
    renderPage()
    await waitFor(() => expect(usersMock).toHaveBeenCalledWith(1, 20, undefined))
  })

  it('loads history when switching to history tab', async () => {
    renderPage()
    await waitFor(() => expect(usersMock).toHaveBeenCalled())
    fireEvent.click(screen.getByText('生成历史'))
    await waitFor(() => expect(historyMock).toHaveBeenCalled())
  })
})

import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import AppDialogProvider, { useAppDialog } from '../components/AppDialogProvider'

function Harness({ onReady }) {
  const dialog = useAppDialog()
  return <button data-testid="expose" onClick={() => onReady(dialog)}>expose</button>
}

function setup() {
  let api
  render(
    <AppDialogProvider>
      <Harness onReady={(d) => { api = d }} />
    </AppDialogProvider>
  )
  fireEvent.click(screen.getByTestId('expose'))
  return api
}

function getBackdrop() {
  return document.querySelector('[class*="bg-black"]')
}

beforeEach(() => { cleanup() })

describe('useAppDialog', () => {
  it('throws when used outside AppDialogProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Harness onReady={() => {}} />)).toThrow(
      'useAppDialog must be used within AppDialogProvider'
    )
    spy.mockRestore()
  })

  it('exposes alert, confirm, choose', () => {
    const api = setup()
    expect(typeof api.alert).toBe('function')
    expect(typeof api.confirm).toBe('function')
    expect(typeof api.choose).toBe('function')
  })
})

describe('alert', () => {
  it('renders message and closes on confirm click', () => {
    const api = setup()
    act(() => { api.alert('操作成功') })
    expect(screen.getByText('操作成功')).toBeInTheDocument()
    expect(screen.getByText('确定')).toBeInTheDocument()
    fireEvent.click(screen.getByText('确定'))
    expect(screen.queryByText('操作成功')).not.toBeInTheDocument()
  })

  it('closes on backdrop click', () => {
    const api = setup()
    act(() => { api.alert('提示信息') })
    expect(screen.getByText('提示信息')).toBeInTheDocument()
    fireEvent.click(getBackdrop())
    expect(screen.queryByText('提示信息')).not.toBeInTheDocument()
  })

  it('uses default message when empty', () => {
    const api = setup()
    act(() => { api.alert('') })
    expect(screen.getByText('操作完成')).toBeInTheDocument()
    fireEvent.click(screen.getByText('确定'))
  })

  it('uses default message when called with no args', () => {
    const api = setup()
    act(() => { api.alert() })
    expect(screen.getByText('操作完成')).toBeInTheDocument()
    fireEvent.click(screen.getByText('确定'))
  })
})

describe('confirm', () => {
  it('renders message with confirm and cancel buttons', () => {
    const api = setup()
    let p
    act(() => { p = api.confirm('确认删除？') })
    expect(screen.getByText('确认删除？')).toBeInTheDocument()
    expect(screen.getByText('确认')).toBeInTheDocument()
    expect(screen.getByText('取消')).toBeInTheDocument()
    act(() => { fireEvent.click(screen.getByText('取消')) })
    return p
  })

  it('resolves true when confirmed', async () => {
    const api = setup()
    let p
    act(() => { p = api.confirm('继续？') })
    act(() => { fireEvent.click(screen.getByText('确认')) })
    expect(await p).toBe(true)
  })

  it('resolves false when cancelled', async () => {
    const api = setup()
    let p
    act(() => { p = api.confirm('继续？') })
    act(() => { fireEvent.click(screen.getByText('取消')) })
    expect(await p).toBe(false)
  })

  it('resolves false on backdrop click', async () => {
    const api = setup()
    let p
    act(() => { p = api.confirm('继续？') })
    act(() => { fireEvent.click(getBackdrop()) })
    expect(await p).toBe(false)
  })

  it('uses default message when empty', () => {
    const api = setup()
    let p
    act(() => { p = api.confirm('') })
    expect(screen.getByText('确认继续？')).toBeInTheDocument()
    act(() => { fireEvent.click(screen.getByText('取消')) })
    return p
  })

  it('dialog closes after resolving', async () => {
    const api = setup()
    let p
    act(() => { p = api.confirm('继续？') })
    act(() => { fireEvent.click(screen.getByText('确认')) })
    await p
    expect(screen.queryByText('继续？')).not.toBeInTheDocument()
  })
})

describe('choose', () => {
  const options = [
    { value: 'a', label: '选项A' },
    { value: 'b', label: '选项B', color: '#f00' },
  ]

  it('renders message and option buttons', () => {
    const api = setup()
    let p
    act(() => { p = api.choose('请选择操作', options) })
    expect(screen.getByText('请选择操作')).toBeInTheDocument()
    expect(screen.getByText('选项A')).toBeInTheDocument()
    expect(screen.getByText('选项B')).toBeInTheDocument()
    expect(screen.getByText('取消')).toBeInTheDocument()
    act(() => { fireEvent.click(screen.getByText('取消')) })
    return p
  })

  it('resolves selected value on option click', async () => {
    const api = setup()
    let p
    act(() => { p = api.choose('选择', options) })
    act(() => { fireEvent.click(screen.getByText('选项B')) })
    expect(await p).toBe('b')
  })

  it('resolves another option value', async () => {
    const api = setup()
    let p
    act(() => { p = api.choose('选择', options) })
    act(() => { fireEvent.click(screen.getByText('选项A')) })
    expect(await p).toBe('a')
  })

  it('resolves null on cancel click', async () => {
    const api = setup()
    let p
    act(() => { p = api.choose('选择', options) })
    act(() => { fireEvent.click(screen.getByText('取消')) })
    expect(await p).toBe(null)
  })

  it('resolves null on backdrop click', async () => {
    const api = setup()
    let p
    act(() => { p = api.choose('选择', options) })
    act(() => { fireEvent.click(getBackdrop()) })
    expect(await p).toBe(null)
  })

  it('uses default message when empty', () => {
    const api = setup()
    let p
    act(() => { p = api.choose('', options) })
    expect(screen.getByText('请选择')).toBeInTheDocument()
    act(() => { fireEvent.click(screen.getByText('取消')) })
    return p
  })

  it('uses empty options when called without options', () => {
    const api = setup()
    let p
    act(() => { p = api.choose('选择') })
    expect(screen.getByText('选择')).toBeInTheDocument()
    expect(screen.getByText('取消')).toBeInTheDocument()
    act(() => { fireEvent.click(screen.getByText('取消')) })
    return p
  })

  it('dialog closes after resolving', async () => {
    const api = setup()
    let p
    act(() => { p = api.choose('选择', options) })
    act(() => { fireEvent.click(screen.getByText('选项A')) })
    await p
    expect(screen.queryByText('选择')).not.toBeInTheDocument()
  })
})

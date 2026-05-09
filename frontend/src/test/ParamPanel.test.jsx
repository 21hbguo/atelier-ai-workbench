import { render, screen, fireEvent, within, cleanup, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { modelsMock } = vi.hoisted(() => ({
  modelsMock: vi.fn(async () => ({
    data: {
      models: [
        {
          model_id: 'gpt-image-2',
          label: 'GPT-Image-2',
          params: {
            size: {
              label: '比例',
              type: 'select',
              default: 'auto',
              options: [
                { value: 'auto', label: '自动' },
                { value: '1:1', label: '1:1' },
                { value: '16:9', label: '16:9' },
              ],
            },
          },
        },
        {
          model_id: 'grsai-vip',
          label: 'GPT-Image-2-VIP',
          params: {
            points_cost: 15,
            resolution_costs: { auto: 15, low: 15, medium: 25, high: 40 },
            size: {
              label: '比例',
              type: 'select',
              default: 'auto',
              options: [
                { value: 'auto', label: '自动' },
                { value: '1:1', label: '1:1' },
                { value: '16:9', label: '16:9' },
              ],
            },
            resolution: {
              label: '分辨率',
              type: 'select',
              default: 'low',
              options: [
                { value: 'low', label: '1K' },
                { value: 'medium', label: '2K' },
                { value: 'high', label: '4K' },
              ],
            },
            quality: {
              label: '画质',
              type: 'select',
              default: 'auto',
              options: [
                { value: 'auto', label: '自动' },
                { value: 'high', label: '高' },
              ],
            },
          },
        },
      ],
    },
  })),
}))

vi.mock('../api', () => ({
  configAPI: { models: modelsMock },
}))

import ParamPanel from '../components/ParamPanel'

function createOnChange(initialParams) {
  let current = { ...initialParams }
  const fn = vi.fn(updater => {
    const result = typeof updater === 'function' ? updater(current) : updater
    current = { ...current, ...result }
  })
  fn.current = () => current
  return fn
}

describe('ParamPanel', () => {
  beforeEach(() => {
    cleanup()
    modelsMock.mockClear()
  })

  it('renders model selector with available models', async () => {
    const onChange = createOnChange({ model_id: 'gpt-image-2', roll_count: 5, optimize_stream: true })
    render(<ParamPanel params={onChange.current()} onChange={onChange} />)
    await screen.findByText('模型')
    const modelLabel = screen.getByText('模型').closest('label')
    const select = within(modelLabel).getByRole('combobox')
    expect(select.value).toBe('gpt-image-2')
    expect(within(select).getByText('GPT-Image-2')).toBeTruthy()
    expect(within(select).getByText('GPT-Image-2-VIP')).toBeTruthy()
  })

  it('renders roll count selector', async () => {
    const onChange = createOnChange({ model_id: 'gpt-image-2', roll_count: 5, optimize_stream: true })
    render(<ParamPanel params={onChange.current()} onChange={onChange} />)
    await screen.findByText('一次生成张数')
    expect(screen.getByText('一次生成张数')).toBeInTheDocument()
    expect(screen.getByText('2次')).toBeInTheDocument()
    expect(screen.getByText('5次')).toBeInTheDocument()
  })

  it('renders optimize stream toggle', async () => {
    const onChange = createOnChange({ model_id: 'gpt-image-2', roll_count: 5, optimize_stream: true })
    render(<ParamPanel params={onChange.current()} onChange={onChange} />)
    await screen.findByText('优化流式输出')
    expect(screen.getByText('优化流式输出')).toBeInTheDocument()
  })

  it('changes model on selection', async () => {
    const onChange = createOnChange({ model_id: 'gpt-image-2', roll_count: 5, optimize_stream: true })
    render(<ParamPanel params={onChange.current()} onChange={onChange} />)
    await screen.findByText('模型')
    const modelLabel = screen.getByText('模型').closest('label')
    const select = within(modelLabel).getByRole('combobox')
    fireEvent.change(select, { target: { value: 'grsai-vip' } })
    expect(onChange.current().model_id).toBe('grsai-vip')
    expect(onChange.current()._model_label).toBe('GPT-Image-2-VIP')
  })

  it('shows gpt-image-2 params: only ratio', async () => {
    const onChange = createOnChange({ model_id: 'gpt-image-2', roll_count: 5, optimize_stream: true })
    render(<ParamPanel params={onChange.current()} onChange={onChange} />)
    await screen.findByText('比例')
    expect(screen.getByText('比例')).toBeInTheDocument()
    expect(screen.queryByText('分辨率')).not.toBeInTheDocument()
    expect(screen.queryByText('画质')).not.toBeInTheDocument()
  })

  it('shows VIP params: ratio, resolution, quality', async () => {
    const onChange = createOnChange({ model_id: 'grsai-vip', resolution: 'low', quality: 'auto', roll_count: 5, optimize_stream: true })
    render(<ParamPanel params={onChange.current()} onChange={onChange} />)
    await screen.findByText('分辨率')
    expect(screen.getByText('比例')).toBeInTheDocument()
    expect(screen.getByText('分辨率')).toBeInTheDocument()
    expect(screen.getByText('画质')).toBeInTheDocument()
  })

  it('changes ratio via size select', async () => {
    const onChange = createOnChange({ model_id: 'gpt-image-2', roll_count: 5, optimize_stream: true })
    render(<ParamPanel params={onChange.current()} onChange={onChange} />)
    await screen.findByText('比例')
    const ratioLabel = screen.getByText('比例').closest('label')
    const select = within(ratioLabel).getByRole('combobox')
    fireEvent.change(select, { target: { value: '16:9' } })
    expect(onChange.current().size).toBe('16:9')
  })

  it('changes resolution on VIP model', async () => {
    const onChange = createOnChange({ model_id: 'grsai-vip', resolution: 'low', quality: 'auto', _points_cost: 15, roll_count: 5, optimize_stream: true })
    render(<ParamPanel params={onChange.current()} onChange={onChange} />)
    await screen.findByText('分辨率')
    const resLabel = screen.getByText('分辨率').closest('label')
    const select = within(resLabel).getByRole('combobox')
    fireEvent.change(select, { target: { value: 'high' } })
    expect(onChange.current().resolution).toBe('high')
  })

  it('updates points cost when VIP resolution changes', async () => {
    const onChange = createOnChange({ model_id: 'grsai-vip', resolution: 'low', quality: 'auto', _points_cost: 15, roll_count: 5, optimize_stream: true })
    render(<ParamPanel params={onChange.current()} onChange={onChange} />)
    await screen.findByText('分辨率')
    const resLabel = screen.getByText('分辨率').closest('label')
    const select = within(resLabel).getByRole('combobox')
    fireEvent.change(select, { target: { value: 'medium' } })
    expect(onChange.current()._points_cost).toBe(25)
  })

  it('changes quality on VIP model', async () => {
    const onChange = createOnChange({ model_id: 'grsai-vip', resolution: 'low', quality: 'auto', _points_cost: 15, roll_count: 5, optimize_stream: true })
    render(<ParamPanel params={onChange.current()} onChange={onChange} />)
    await screen.findByText('画质')
    const qLabel = screen.getByText('画质').closest('label')
    const select = within(qLabel).getByRole('combobox')
    fireEvent.change(select, { target: { value: 'high' } })
    expect(onChange.current().quality).toBe('high')
  })

  it('changes roll count', async () => {
    const onChange = createOnChange({ model_id: 'gpt-image-2', roll_count: 5, optimize_stream: true })
    render(<ParamPanel params={onChange.current()} onChange={onChange} />)
    await screen.findByText('一次生成张数')
    const rollLabel = screen.getByText('一次生成张数').closest('label')
    const select = within(rollLabel).getByRole('combobox')
    fireEvent.change(select, { target: { value: '3' } })
    expect(onChange.current().roll_count).toBe(3)
  })

  it('toggles optimize stream', async () => {
    const onChange = createOnChange({ model_id: 'gpt-image-2', roll_count: 5, optimize_stream: true })
    render(<ParamPanel params={onChange.current()} onChange={onChange} />)
    await screen.findByText('优化流式输出')
    const toggleBtn = screen.getByText('优化流式输出').closest('label').querySelector('button')
    fireEvent.click(toggleBtn)
    expect(onChange.current().optimize_stream).toBe(false)
  })

  it('handles model with input type param', async () => {
    modelsMock.mockResolvedValueOnce({
      data: {
        models: [
          {
            model_id: 'test-model',
            label: 'Test',
            params: {
              prompt_extra: {
                label: 'Extra Prompt',
                type: 'input',
                default: '',
                placeholder: 'type here',
              },
            },
          },
        ],
      },
    })
    const onChange = createOnChange({ model_id: 'test-model' })
    render(<ParamPanel params={onChange.current()} onChange={onChange} />)
    await screen.findByText('Extra Prompt')
    const input = screen.getByPlaceholderText('type here')
    fireEvent.change(input, { target: { value: 'hello' } })
    expect(onChange.current().prompt_extra).toBe('hello')
  })

  it('sets default values on mount for new model', async () => {
    const onChange = createOnChange({})
    render(<ParamPanel params={onChange.current()} onChange={onChange} />)
    await waitFor(() => {
      expect(onChange.current().model_id).toBe('gpt-image-2')
      expect(onChange.current()._model_label).toBe('GPT-Image-2')
    })
  })

  it('sets VIP points cost on model switch', async () => {
    const onChange = createOnChange({ model_id: 'gpt-image-2', roll_count: 5, optimize_stream: true })
    render(<ParamPanel params={onChange.current()} onChange={onChange} />)
    await screen.findByText('模型')
    const modelLabel = screen.getByText('模型').closest('label')
    const select = within(modelLabel).getByRole('combobox')
    fireEvent.change(select, { target: { value: 'grsai-vip' } })
    await waitFor(() => {
      expect(onChange.current()._points_cost).toBe(15)
    })
  })

  it('handles empty models list gracefully', async () => {
    modelsMock.mockResolvedValueOnce({ data: { models: [] } })
    const onChange = createOnChange({ model_id: 'gpt-image-2' })
    render(<ParamPanel params={onChange.current()} onChange={onChange} />)
    await waitFor(() => {
      expect(screen.queryByText('模型')).not.toBeInTheDocument()
    })
  })

  it('hides aspectRatio from visible entries', async () => {
    modelsMock.mockResolvedValueOnce({
      data: {
        models: [
          {
            model_id: 'ar-model',
            label: 'AR Model',
            params: {
              aspectRatio: { label: 'AR', type: 'select', default: '1:1', options: ['1:1'] },
              quality: { label: 'Quality', type: 'select', default: 'auto', options: ['auto'] },
            },
          },
        ],
      },
    })
    const onChange = createOnChange({ model_id: 'ar-model' })
    render(<ParamPanel params={onChange.current()} onChange={onChange} />)
    await screen.findByText('Quality')
    expect(screen.queryByText('AR')).not.toBeInTheDocument()
  })
})

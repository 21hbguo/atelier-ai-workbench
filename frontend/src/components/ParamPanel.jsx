import { useState, useEffect, useMemo } from 'react'
import { configAPI } from '../api'

function isVipModel(modelId=''){return modelId==='grsai-vip'}
function getVipResolutionCost(params={},resolution='auto',fallback=10){const costs=params?.resolution_costs||{};const key=resolution||'auto';const value=costs[key]??costs.auto??params?.points_cost;const num=Number(value);return num>0?Math.round(num):fallback}

export default function ParamPanel({ params, onChange }) {
  const [models, setModels] = useState([])

  useEffect(() => {
    configAPI.models().then(res => {
      setModels(res.data?.models || [])
    }).catch(() => {})
  }, [])

  const currentModel = useMemo(() =>
    models.find(m => m.model_id === params.model_id) || models[0],
    [models, params.model_id]
  )

  const modelParams = currentModel?.params || {}
  const visibleEntries = useMemo(() => Object.entries(modelParams).filter(([key]) => key !== 'aspectRatio'), [modelParams])

  useEffect(() => {
    if (!currentModel) return
    const defaults = {}
    if (!params.model_id) defaults.model_id = currentModel.model_id
    defaults._model_label = currentModel.label || currentModel.model_id
    if (modelParams.resolution_costs !== undefined) defaults._resolution_costs = modelParams.resolution_costs
    for (const [key, cfg] of Object.entries(modelParams)) {
      if (cfg.default !== undefined && params[key] === undefined) {
        defaults[key] = cfg.default
      }
    }
    if (isVipModel(currentModel?.model_id)) defaults._points_cost = getVipResolutionCost(modelParams, params?.resolution ?? modelParams?.resolution?.default ?? 'low')
    else if (modelParams.points_cost !== undefined) defaults._points_cost = modelParams.points_cost
    if (Object.keys(defaults).length > 0) {
      onChange(p => ({ ...p, ...defaults }))
    }
  }, [currentModel, modelParams, onChange, params?.resolution])

  useEffect(() => {
    if (!isVipModel(currentModel?.model_id)) return
    const resolution = params?.resolution ?? modelParams?.resolution?.default ?? 'low'
    const nextCost=getVipResolutionCost(modelParams,resolution,Number(params?._points_cost)||10)
    if (Number(params?._points_cost)!==nextCost) onChange(p => ({ ...p, _points_cost: nextCost }))
  }, [currentModel?.model_id, modelParams, onChange, params?._points_cost, params?.resolution])

  const handleModelChange = (modelId) => {
    const model = models.find(m => m.model_id === modelId)
    if (!model) return
    const newParams = { model_id: modelId, _model_label: model.label || modelId, _points_cost: model?.params?.points_cost, _resolution_costs: model?.params?.resolution_costs }
    for (const [key, cfg] of Object.entries(model.params || {})) {
      if (key === 'points_cost') {
        newParams._points_cost = cfg
        continue
      }
      if (key === 'resolution_costs') continue
      if (cfg.default !== undefined) {
        newParams[key] = cfg.default
      }
    }
    if (isVipModel(modelId)) newParams._points_cost = getVipResolutionCost(model.params || {}, newParams.resolution || 'low', Number(newParams._points_cost)||10)
    onChange(p => ({ ...p, ...newParams }))
  }

  const renderParam = (key, cfg) => {
    if (cfg.type === 'select') {
      return (
        <label key={key} className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{cfg.label || key}</span>
          <select value={params[key] ?? cfg.default ?? ''} onChange={e => onChange(p => ({ ...p, [key]: e.target.value, ...(isVipModel(currentModel?.model_id)&&key==='resolution'?{_points_cost:getVipResolutionCost(modelParams,e.target.value,Number(p?._points_cost)||10),_resolution_costs:modelParams?.resolution_costs||p?._resolution_costs}:{}) }))}
            className="px-2 py-1.5 rounded-2xl text-sm border outline-none focus:ring-1 focus:ring-accent/50"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>
            {(cfg.options || []).map(opt => typeof opt === 'string'
              ? <option key={opt} value={opt}>{opt}</option>
              : <option key={opt.value} value={opt.value}>{opt.label}</option>
            )}
          </select>
        </label>
      )
    }
    if (cfg.type === 'input') {
      return (
        <label key={key} className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{cfg.label || key}</span>
          <input type="text" value={params[key] ?? cfg.default ?? ''} onChange={e => onChange(p => ({ ...p, [key]: e.target.value }))}
            placeholder={cfg.placeholder || ''}
            className="px-2 py-1.5 rounded-2xl text-sm border outline-none focus:ring-1 focus:ring-accent/50"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
        </label>
      )
    }
    return null
  }

  return (
    <div className="grid gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>一次生成张数</span>
        <select value={params.roll_count ?? 5} onChange={e => onChange(p => ({ ...p, roll_count: Math.min(5, Math.max(2, Number(e.target.value) || 5)) }))}
          className="px-2 py-1.5 rounded-2xl text-sm border outline-none focus:ring-1 focus:ring-accent/50"
          style={{ background: 'var(--bg-input)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>
          <option value={2}>2次</option>
          <option value={3}>3次</option>
          <option value={4}>4次</option>
          <option value={5}>5次</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>优化流式输出</span>
          <span className="text-[10px]" style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>开启后优化结果实时逐字显示</span>
        </div>
        <button type="button" onClick={() => onChange(p => ({ ...p, optimize_stream: p.optimize_stream === false ? true : false }))}
          className="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
          style={{ background: params.optimize_stream !== false ? 'var(--accent)' : 'var(--border-color)' }}>
          <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
            style={{ left: params.optimize_stream !== false ? '18px' : '2px' }} />
        </button>
      </label>
      {models.length > 0 && (
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>模型</span>
          <select value={currentModel?.model_id ?? ''} onChange={e => handleModelChange(e.target.value)}
            className="px-2 py-1.5 rounded-2xl text-sm border outline-none focus:ring-1 focus:ring-accent/50"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>
            {models.map(m => <option key={m.model_id} value={m.model_id}>{m.label}</option>)}
          </select>
        </label>
      )}
      {visibleEntries.map(([key, cfg]) => renderParam(key, cfg))}
    </div>
  )
}

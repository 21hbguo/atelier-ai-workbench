import { useState } from 'react'
import {
  ChevronDown, ChevronUp, Loader2, AlertCircle, Check,
  Image as ImageIcon, Search, BookOpen, Wrench, Download, Maximize2,
} from 'lucide-react'

const STATUS_LABEL = {
  pending: '等待中',
  running: '执行中',
  success: '已完成',
  error: '执行失败',
}

function getToolIcon(name) {
  if (name === 'image_generate') return ImageIcon
  if (name === 'web_search') return Search
  if (name === 'knowledge_search') return BookOpen
  return Wrench
}

function getToolLabel(name) {
  if (name === 'image_generate') return '图像生成'
  if (name === 'web_search') return '网页搜索'
  if (name === 'knowledge_search') return '知识库检索'
  return name || '工具'
}

function getMainArgSummary(toolCall) {
  const args = toolCall.arguments || {}
  const raw = args.prompt || args.query || args.q || args.text || args.content || ''
  if (!raw) return ''
  const s = String(raw)
  return s.length > 50 ? s.slice(0, 50) + '…' : s
}

function isImageFile(f) {
  const type = String(f?.type || '').toLowerCase()
  const url = String(f?.url || f?.filename || '').toLowerCase()
  return type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)(\?|$)/.test(url)
}

export default function ToolCallCard({ toolCall, onImageClick }) {
  const status = toolCall.status || 'pending'
  const isRunning = status === 'running'
  const isPending = status === 'pending'
  const isError = status === 'error'

import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg-primary)' }}>
          <div className="text-center">
            <p className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>页面出错了</p>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>请刷新页面重试</p>
            {this.state.error?.message && <p className="text-xs mb-4 break-all" style={{ color: 'var(--color-error)', maxWidth: 640 }}>{this.state.error.message}</p>}
            <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-2xl text-sm font-medium text-white" style={{ background: 'var(--accent)' }}>
              刷新页面
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

import { useState } from 'react'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'

export default function MainLayout({ children, dragProps }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden" {...dragProps}>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden" style={{ color: 'var(--text-primary)' }}><Menu size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

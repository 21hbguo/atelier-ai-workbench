import { useNavigate } from 'react-router-dom'

export default function PageLayout({ children, className = '' }) {
  const navigate = useNavigate()

  return (
    <div className={`min-h-screen ${className}`} onClick={() => navigate('/')}>
      <div className="h-full" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

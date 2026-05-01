import { useNavigate } from 'react-router-dom'

export default function PageLayout({ children, className = '' }) {
  const navigate = useNavigate()
  const goBack = (e) => { if (e.target === e.currentTarget) navigate('/') }

  return (
    <div className={`min-h-screen ${className}`} onClick={goBack}>
      <div className="min-h-screen max-w-5xl mx-auto" onClick={goBack}>
        {children}
      </div>
    </div>
  )
}


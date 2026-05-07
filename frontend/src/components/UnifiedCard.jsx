export default function UnifiedCard({ checked = false, onClick, className = '', mediaNode, hoverNode, bottomNode, topLeftNode, topRightNode, selectNode, overlayNode, footerNode, ...props }) {
  return (
    <div className={`group relative rounded-2xl overflow-hidden bg-[var(--bg-card)] shadow-sm hover:shadow-md transition-shadow ${checked ? 'ring-2 ring-accent/50' : ''} ${className}`} {...props}>
      <div className="relative cursor-pointer" onClick={onClick}>
        {mediaNode}
        {hoverNode}
        {bottomNode}
        {topLeftNode}
        {topRightNode}
        {selectNode}
        {overlayNode}
      </div>
      {footerNode}
    </div>
  )
}

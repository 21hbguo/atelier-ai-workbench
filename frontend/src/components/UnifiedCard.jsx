export default function UnifiedCard({ checked = false, onClick, className = '', mediaNode, hoverNode, bottomNode, topLeftNode, topRightNode, selectNode, overlayNode, ...props }) {
  return (
    <div className={`group relative rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer ${checked ? 'ring-2 ring-accent/50' : ''} ${className}`} onClick={onClick} {...props}>
      {mediaNode}
      {hoverNode}
      {bottomNode}
      {topLeftNode}
      {topRightNode}
      {selectNode}
      {overlayNode}
    </div>
  )
}

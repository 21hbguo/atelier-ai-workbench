import { createContext, useContext, useEffect, useState } from 'react'
const LayoutModeContext=createContext()
export function LayoutModeProvider({ children }) {
  const [layoutMode,setLayoutMode]=useState(()=>localStorage.getItem('image_card_layout')==='grid'?'grid':'masonry')
  useEffect(()=>{ localStorage.setItem('image_card_layout',layoutMode) },[layoutMode])
  return <LayoutModeContext.Provider value={{ layoutMode, setLayoutMode, toggleLayoutMode:()=>setLayoutMode(v=>v==='masonry'?'grid':'masonry') }}>{children}</LayoutModeContext.Provider>
}
export const useLayoutMode=()=>useContext(LayoutModeContext)

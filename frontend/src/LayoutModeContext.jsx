import { createContext, useContext, useEffect, useState } from 'react'
const LayoutModeContext=createContext()
const defaultCols={base:1,sm:3,md:4,lg:5}
const breakpointLabels={base:'手机',sm:'小屏',md:'平板',lg:'桌面'}
const breakpointOptions={base:[1,2],sm:[2,3,4],md:[2,3,4,5],lg:[3,4,5,6]}
function getBreakpoint(w){return w>=1024?'lg':w>=768?'md':w>=640?'sm':'base'}
function readCols(){
  try{
    const raw=localStorage.getItem('image_card_cols');
    if(!raw)return defaultCols;
    const parsed=JSON.parse(raw)||{};
    return {
      base:breakpointOptions.base.includes(Number(parsed.base))?Number(parsed.base):defaultCols.base,
      sm:breakpointOptions.sm.includes(Number(parsed.sm))?Number(parsed.sm):defaultCols.sm,
      md:breakpointOptions.md.includes(Number(parsed.md))?Number(parsed.md):defaultCols.md,
      lg:breakpointOptions.lg.includes(Number(parsed.lg))?Number(parsed.lg):defaultCols.lg
    }
  }catch{return defaultCols}
}
export function LayoutModeProvider({ children }) {
  const [layoutMode,setLayoutMode]=useState(()=>localStorage.getItem('image_card_layout')==='grid'?'grid':'masonry')
  const [cols,setCols]=useState(readCols)
  const [currentBreakpoint,setCurrentBreakpoint]=useState(()=>getBreakpoint(window.innerWidth))
  useEffect(()=>{localStorage.setItem('image_card_layout',layoutMode)},[layoutMode])
  useEffect(()=>{
    localStorage.setItem('image_card_cols',JSON.stringify(cols));
    document.documentElement.style.setProperty('--card-feed-grid-cols-base',String(cols.base));
    document.documentElement.style.setProperty('--card-feed-grid-cols-sm',String(cols.sm));
    document.documentElement.style.setProperty('--card-feed-grid-cols-md',String(cols.md));
    document.documentElement.style.setProperty('--card-feed-grid-cols-lg',String(cols.lg));
    document.documentElement.style.setProperty('--card-feed-masonry-cols-base',String(cols.base));
    document.documentElement.style.setProperty('--card-feed-masonry-cols-sm',String(cols.sm));
    document.documentElement.style.setProperty('--card-feed-masonry-cols-md',String(cols.md));
    document.documentElement.style.setProperty('--card-feed-masonry-cols-lg',String(cols.lg))
  },[cols])
  useEffect(()=>{
    const onResize=()=>setCurrentBreakpoint(getBreakpoint(window.innerWidth));
    window.addEventListener('resize',onResize);
    return()=>window.removeEventListener('resize',onResize)
  },[])
  const toggleCurrentCols=()=>setCols(v=>{
    const key=currentBreakpoint,list=breakpointOptions[key],idx=list.indexOf(v[key]),next=list[(idx+1)%list.length];
    return {...v,[key]:next}
  })
  return (
    <LayoutModeContext.Provider value={{
      layoutMode,
      setLayoutMode,
      toggleLayoutMode:()=>setLayoutMode(v=>v==='masonry'?'grid':'masonry'),
      cols,
      setCols,
      currentBreakpoint,
      currentCols:cols[currentBreakpoint],
      currentBreakpointLabel:breakpointLabels[currentBreakpoint],
      toggleCurrentCols
    }}>
      {children}
    </LayoutModeContext.Provider>
  )
}
export const useLayoutMode=()=>useContext(LayoutModeContext)

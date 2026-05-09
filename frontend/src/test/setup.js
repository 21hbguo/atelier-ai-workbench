import * as matchers from '@testing-library/jest-dom/matchers'
import { vi, expect } from 'vitest'
expect.extend(matchers)
class ResizeObserverMock{observe(){}unobserve(){}disconnect(){}}
global.ResizeObserver=global.ResizeObserver||ResizeObserverMock
window.ResizeObserver=window.ResizeObserver||ResizeObserverMock
window.matchMedia=window.matchMedia||(()=>({matches:false,media:'',onchange:null,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return false}}))
window.scrollTo=window.scrollTo||(()=>{})
window.requestAnimationFrame=window.requestAnimationFrame||(cb=>setTimeout(cb,0))
window.cancelAnimationFrame=window.cancelAnimationFrame||(id=>clearTimeout(id))
if(!HTMLElement.prototype.scrollTo)HTMLElement.prototype.scrollTo=()=>{}
Object.defineProperty(window,'showSaveFilePicker',{configurable:true,writable:true,value:undefined})
Object.defineProperty(window.navigator,'virtualKeyboard',{configurable:true,writable:true,value:null})
window.alert=vi.fn()
window.__LAST_ERROR_BOUNDARY__=null
global.fetch=vi.fn(async()=>({ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:async()=>({}),text:async()=>''}))

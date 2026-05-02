export const readUser=()=>{try{return JSON.parse(localStorage.getItem('user')||'null')}catch{return null}}
export const writeUser=(user)=>{if(user)localStorage.setItem('user',JSON.stringify(user));window.dispatchEvent(new Event('auth-changed'))}
export const clearUser=()=>{localStorage.removeItem('user');window.dispatchEvent(new Event('auth-changed'))}

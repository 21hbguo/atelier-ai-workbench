export const readUser=()=>{try{return JSON.parse(localStorage.getItem('user')||'null')}catch{return null}}
export const writeUser=(user)=>{if(user)localStorage.setItem('user',JSON.stringify(user));window.dispatchEvent(new Event('auth-changed'))}
export const clearUser=()=>{localStorage.removeItem('user');localStorage.removeItem('cached_prompt');localStorage.removeItem('ref_images');localStorage.removeItem('ref_image_url');localStorage.removeItem('ref_image_name');window.dispatchEvent(new Event('auth-changed'))}

const normalizeUser=user=>{if(!user)return null;const account=user.account||user.username||'';return {...user,account,username:account}}
export const readUser=()=>{try{return normalizeUser(JSON.parse(localStorage.getItem('user')||'null'))}catch{return null}}
export const writeUser=(user)=>{const normalized=normalizeUser(user);if(normalized)localStorage.setItem('user',JSON.stringify(normalized));window.dispatchEvent(new Event('auth-changed'))}
export const clearUser=()=>{localStorage.removeItem('user');localStorage.removeItem('cached_prompt');localStorage.removeItem('ref_images');localStorage.removeItem('ref_image_url');localStorage.removeItem('ref_image_name');window.dispatchEvent(new Event('auth-changed'))}

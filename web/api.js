let token='';
export async function loadWorkspace() {const value=await request('/api/workspace');token=value.csrf_token;return value;}
export async function request(url,body,headers={}) {
  const stationHeaders=window.__STARNET_API_TOKEN__?{'X-Starnet-Token':window.__STARNET_API_TOKEN__}:{};
  const options=body===undefined?{headers:stationHeaders}:{method:'POST',headers:{'Content-Type':'application/json','X-Ultra-Token':token,...stationHeaders,...headers},body:JSON.stringify(body)};
  const response=await fetch(window.ULTRA_API_BASE?url.replace(/^\/api/,window.ULTRA_API_BASE):url,options);
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||`Request failed (${response.status})`);
  return result;
}
export function esc(value) {return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function amount(value,currency='TND') {
  if(value===null||value===undefined)return `Unknown (${currency})`;
  const digits=currency==='TND'?3:2;
  return `${(value/10**digits).toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits})} ${currency}`;
}
export function human(value) {return String(value||'unknown').replaceAll('_',' ');}
export function shortTime(value) {return new Date(value).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});}
export function taskReady(task) {return ['todo','blocked_on_owner','in_progress'].includes(task.status)&&!task.unmet_dependencies.length;}
export function priceMinor(text,currency){
  if(!text.trim())return null;
  const places=currency==='TND'?3:2;
  const pattern=new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`);
  if(!pattern.test(text.trim()))throw new Error(`Amount needs a nonnegative decimal with at most ${places} fractional digits.`);
  const [whole,fraction='']=text.trim().split('.');
  const value=Number(whole)*10**places+Number(fraction.padEnd(places,'0'));
  if(!Number.isSafeInteger(value))throw new Error('Amount is too large.');
  return value;
}

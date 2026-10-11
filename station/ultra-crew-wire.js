'use strict';
// The station's link to the local FreeLLMAPI service. scripts/freellmapi.py key writes <runtime>/.secrets/freellmapi.json;
// only a loopback base URL on the configured port and a well-formed unified key are ever accepted.
const KEY_RE=/^freellmapi-[0-9a-f]{48}$/;
function portFrom(env){
  const port=Number(env&&env.ULTRA_FREELLMAPI_PORT||3001);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('ULTRA_FREELLMAPI_PORT must be a whole number from 1024 to 65535.');
  return port;
}
function makeWire({fs,path,runtime,port}){
  const file=path.join(runtime,'.secrets','freellmapi.json'),expected='http://127.0.0.1:'+port+'/v1';
  let current=null,problem='not_configured',apply=null;
  function read(){
    let raw;
    try{raw=JSON.parse(fs.readFileSync(file,'utf8'));}
    catch(e){return {wire:null,problem:e&&e.code==='ENOENT'?'not_configured':'unreadable'};}
    if(!raw||raw.baseUrl!==expected)return {wire:null,problem:'wrong_endpoint'};
    if(!KEY_RE.test(String(raw.key||'')))return {wire:null,problem:'bad_key'};
    return {wire:{baseUrl:expected,key:raw.key},problem:null};
  }
  function push(){if(apply)apply('custom',current?{baseUrl:current.baseUrl,key:current.key}:{baseUrl:'',key:''});}
  function refresh(){
    const r=read(),changed=JSON.stringify(r.wire)!==JSON.stringify(current);
    current=r.wire;problem=r.problem;
    if(changed)push();
    return current;
  }
  function register(fn){apply=typeof fn==='function'?fn:null;const r=read();current=r.wire;problem=r.problem;push();}
  return {file,expected,refresh,register,get:()=>current,
    isFreeTier:id=>String(id||'')==='custom'&&!!current,
    status:()=>({configured:!!current,problem,baseUrl:expected})};
}
module.exports={makeWire,portFrom,KEY_RE};

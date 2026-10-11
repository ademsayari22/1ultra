'use strict';
// Owner-controlled feature switches. Agents may read them; only the owner route (same-origin page + token) writes.
// `ready:false` means the feature has not been unlocked and verified yet; later phases flip `ready` per switch.
const crypto=require('node:crypto');
const CATALOG=Object.freeze([
  {id:'lead.codex',label:'Lead agent on Codex (gpt-6.1-sol, xhigh)',type:'bool',default:false,ready:true,needs:'Turn on, then sign in: model dock → GPT / CODEX → Sign in with ChatGPT; pick GPT 6.1 SOL · XHIGH'},
  {id:'crew.freellmapi',label:'Crew agents on FreeLLMAPI',type:'bool',default:false,ready:true,needs:'Start FreeLLMAPI first: python3 scripts/freellmapi.py start, then key and tiers'},
  {id:'crew.escalate_to_lead',label:'Lead takes over crew work that fails on every free option',type:'bool',default:true,ready:true,needs:'lead.codex on'},
  {id:'tools.web',label:'Web search and page reading',type:'bool',default:false,ready:true,needs:''},
  {id:'tools.browser',label:'Agent-driven headless browser',type:'bool',default:false,ready:false,needs:'Playwright Chromium'},
  {id:'tools.shell',label:'Shell, terminal and files outside the agent workspace',type:'bool',default:false,ready:false,needs:''},
  {id:'tools.computer',label:'Desktop control and windows on your screen',type:'bool',default:false,ready:false,needs:''},
  {id:'tools.mcp',label:'MCP connectors and plugins',type:'bool',default:false,ready:false,needs:'A key or sign-in per connector'},
  {id:'channels.telegram',label:'Telegram (your own account)',type:'bool',default:false,ready:false,needs:'A bot token you create, plus owner pairing'},
  {id:'channels.discord',label:'Discord (your own account)',type:'bool',default:false,ready:false,needs:'A bot token you create, plus owner pairing'},
  {id:'channels.slack',label:'Slack (your own account)',type:'bool',default:false,ready:false,needs:'A bot token you create, plus owner pairing'},
  {id:'channels.signal',label:'Signal (your own account)',type:'bool',default:false,ready:false,needs:'A linked device, plus owner pairing'},
  {id:'channels.matrix',label:'Matrix (your own account)',type:'bool',default:false,ready:false,needs:'A bot account, plus owner pairing'},
  {id:'cron',label:'Scheduled routines',type:'bool',default:false,ready:false,needs:''},
  {id:'nightshift',label:'Night Shift: unattended work inside its leash',type:'bool',default:false,ready:false,needs:''},
  {id:'voice',label:'Push-to-talk and spoken replies',type:'bool',default:false,ready:false,needs:'An audio-capable provider'},
  {id:'skills.market',label:'Skill Market browsing and installs',type:'bool',default:false,ready:false,needs:''},
  {id:'concurrency',label:'Maximum simultaneous agent runs',type:'int',default:2,min:1,max:8,ready:true,needs:''},
  {id:'spend_cap_usd',label:'Spend cap for paid providers (USD)',type:'number',default:0,min:0,max:1000,ready:true,needs:''},
]);
function failure(code,message){return Object.assign(new Error(message),{code});}
function makeSwitches({fs,path,file,providerIds=[],now=()=>new Date().toISOString()}){
  const catalog=[...CATALOG,...providerIds.map(id=>({id:'providers.'+id,label:'Provider: '+id,type:'bool',default:false,ready:false,needs:'Your own key; paid use is refused while the spend cap is 0'}))];
  const byId=new Map(catalog.map(row=>[row.id,row]));
  // An unreadable file fails closed: every switch reads as its default and changes are refused until the owner fixes it.
  function load(){if(!fs.existsSync(file))return {state:{version:1,values:{},history:[]},problem:null};
    try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error('not an object');
      return {state:{version:1,values:saved.values&&typeof saved.values==='object'?saved.values:{},history:Array.isArray(saved.history)?saved.history:[]},problem:null};}
    catch(e){return {state:{version:1,values:{},history:[]},problem:path.basename(file)+' is unreadable ('+e.message+'). Every switch reads as its default until you fix or delete the file.'};}}
  function read(){return load().state;}
  function problem(){return load().problem;}
  function write(state){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(state,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,file);}
  function value(id){const row=byId.get(id);if(!row)throw failure('unknown','Unknown switch: '+id);const values=read().values;return Object.hasOwn(values,id)?values[id]:row.default;}
  function isOn(id){if(id==='channels'||id==='providers')return catalog.some(row=>row.id.startsWith(id+'.')&&value(row.id)===true);return value(id)===true;}
  function validate(row,v){
    if(row.type==='bool')return typeof v==='boolean';
    if(typeof v!=='number'||!Number.isFinite(v)||(row.type==='int'&&!Number.isInteger(v)))return false;
    return v>=row.min&&v<=row.max;
  }
  function set(id,v){
    const row=byId.get(id);if(!row)throw failure('unknown','Unknown switch: '+id);
    if(!row.ready)throw failure('not_ready','"'+row.label+'" is not available yet.');
    if(!validate(row,v))throw failure('invalid','Invalid value for "'+row.label+'".');
    const issue=problem();if(issue)throw failure('invalid',issue);
    const state=read(),from=Object.hasOwn(state.values,id)?state.values[id]:row.default;
    state.values[id]=v;state.history=[...state.history,{at:now(),id,from,to:v}].slice(-500);write(state);
  }
  function list(){return catalog.map(row=>({...row,value:value(row.id)}));}
  function version(){return crypto.createHash('sha256').update(fs.existsSync(file)?fs.readFileSync(file):'').digest('hex');}
  return {list,value,isOn,set,version,problem,file,CATALOG:catalog};
}
module.exports={makeSwitches,CATALOG};

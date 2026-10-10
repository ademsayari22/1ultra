'use strict';
const deny = () => { throw new Error('Live models and external connections are disabled in this campaign.'); };
function routeAllowed(method, route) {
  const p=route.split('?')[0];
  if(p.startsWith('/api/ultra/')) return ['GET','POST'].includes(method);
  if(p==='/health')return method==='GET';
  return method==='GET' && !p.startsWith('/api/') && !p.startsWith('/v1') && !p.startsWith('/workshop-run/');
}
function makeGate(){const desks=new Set();return {
  enter(desk){if(desks.has(desk))throw new Error('This desk already has an active job.');if(desks.size>=2)throw new Error('Only two preparation workers may run.');desks.add(desk);},
  leave(desk){desks.delete(desk);}, active(){return [...desks];}
};}
function runtimeAllowed(root,runtime){
  const path=require('node:path');
  if(runtime===path.join(root,'runs','station-runtime'))return true;
  return runtime.startsWith('/tmp/') && (runtime===path.join(root,'runtime') && root.startsWith('/tmp/') || !runtime.startsWith(root+path.sep));
}
function install(runtime){
  for(const key of Object.keys(process.env))if(/^(STARNET|SKYNET)_/.test(key))delete process.env[key];
  Object.assign(process.env,{STARNET_WORKSPACES:runtime,STARNET_PORT:process.env.ULTRA_PORT||'8541',
    STARNET_LIVE_PRICES:'0',STARNET_QUEST_REFRESH:'0',STARNET_CRON_ENABLED:'0',STARNET_NIGHTSHIFT_ENABLED:'0',
    STARNET_SKILL_REVIEW:'0',STARNET_APP_VERSION:'1Ultra-local',STARNET_BUILD_DESCRIBE:'e0a36dc+1ultra'});
  // This is an explicit gate, independent of upstream's zero-means-unlimited budgets.
  globalThis.fetch=async()=>deny();
  for(const mod of ['node:http','node:https']){const m=require(mod);m.request=deny;m.get=deny;}
  require('node:net').Socket.prototype.connect=deny;
  const cp=require('node:child_process');
  for(const method of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[method]=deny;
}
module.exports={routeAllowed,makeGate,runtimeAllowed,install,assertModelAllowed:deny};

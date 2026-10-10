#!/usr/bin/env node
// Test-only local transport. It never connects to a provider.
const fs=require('node:fs'),path=require('node:path');
if(process.argv.includes('login')){process.stdout.write('Logged in using ChatGPT\n');process.exit(0);}
let prompt='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>prompt+=chunk);
process.stdin.on('end',()=>{
  const context=JSON.parse(fs.readFileSync(path.join(process.cwd(),'context.json'),'utf8'));
  const effort='model_reasoning_effort='+JSON.stringify(context.agent_settings.reasoning_effort);
  if(!process.argv.includes(effort)||!prompt.includes('Project role instructions:')||context.skills.some(s=>!prompt.includes('Project skill '+s.id+':'))){process.stdout.write(JSON.stringify({type:'turn.failed'})+'\n');process.exitCode=1;return;}
  process.stdout.write(JSON.stringify({type:'turn.started'})+'\n');
  if(context.judgment_reason.includes('FIXTURE_TIMEOUT'))return setTimeout(()=>{},300000);
  if(context.judgment_reason.includes('FIXTURE_FAILURE')){process.stdout.write(JSON.stringify({type:'turn.failed'})+'\n');process.exitCode=1;return;}
  setTimeout(()=>{
    const pitch=context.kind==='pitch'?{subject:'FICTIONAL QA FIXTURE · '+context.lead.company,body:'Bonjour '+context.lead.company+', votre activité publiée mérite un petit exemple ciblé. Pouvons-nous examiner un échantillon autorisé ? Adem'}:null;
    const result={summary:context.kind==='pitch'?'Tailored pitch fixture':'QA review fixture',answer:context.agent_output_to_review?'Review source alignment before using the Sales draft.':'Company need remains unconfirmed.',pitch,evidence:context.lead?[{source:context.lead.source_url,claim:context.lead.observed_fact}]:[],unknowns:['Actual buyer need'],owner_actions:['Review each claim before sending.']};
    fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message')+1],JSON.stringify(result));
    process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:100,output_tokens:50}})+'\n');
  },1500);
});

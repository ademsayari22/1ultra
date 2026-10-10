import {esc} from './api.js';

const guides={
 R01:{title:'Review 5 Tunisian companies',steps:['Open five source pages from the lead board.','Check the company, Tunisian location and public contact route.','Confirm the five discoveries you actually reviewed.'],action:'Browse leads',route:'leads'},
 R02:{title:'Choose your first 5 leads',steps:['Pick companies with a plausible need for one small service.','Use Shortlist on five company cards.','Keep each possible need as a question for the buyer.'],action:'Build shortlist',route:'leads',stage:'scout'},
 R04:{title:'Source the next local batch',steps:['Open the Apollo sourcing desk.','Set Account HQ to Tunisia and choose one niche.','Preview an export and import only relevant new companies.'],action:'Open Apollo',provider:'apollo'},
 S01:{title:'Choose a small offer',steps:['Choose checked tables, spreadsheet cleanup, catalogue preparation or a one-page website pilot.','Match the offer to a company’s visible activity.','Confirm your weekly capacity in Plan time.'],action:'Choose offer & capacity',planning:true},
 S02:{title:'Build a tiny proof example',steps:['Use a synthetic or explicitly permitted sample.','Produce the proposed output and an exceptions list.','Save the example where you can show and explain it.'],action:'Open data tools',tool:'csv-workbench'},
 Q00:{title:'Check your proof',steps:['Compare the example with its source.','Check identifiers, amounts and unclear values.','Keep the checked example reference for your pitch.'],action:'Inspect acceptance checks',tool:'scope-check'},
 S03:{title:'Prepare 3 personal pitches',steps:['Choose a shortlisted company and a small offer.','Prepare a French pitch from the source observation.','Edit the opening and ask one relevant question.'],action:'Prepare pitches',route:'leads',stage:'shortlist'},
 Q01:{title:'Review 3 pitches',steps:['Open each pitch and check its observation against the source.','Keep scope, price and timing conditional on a permitted sample.','Click Confirm pitch reviewed for three drafts.'],action:'Review pitches',route:'leads',stage:'pitch'},
 C01:{title:'Start real conversations',steps:['Review a specific recipient and message before sending yourself.','Record the actual contact date and evidence after sending.','Record replies or no reply, with a next follow-up date.'],action:'Track contacts & replies',route:'leads'},
 C02:{title:'Turn interest into a small pilot',steps:['Ask which repeated task costs them time.','Agree permitted sample, output, exceptions, quantity and acceptance.','Agree the price, deadline and start condition with the buyer.'],action:'Check pilot scope',tool:'scope-check'},
 F04:{title:'Confirm the pilot can start',steps:['Keep the buyer’s accepted scope and terms.','Check the agreed payment or funded milestone if required.','Record actual evidence that the start condition is fulfilled.'],action:'Inspect scope',tool:'scope-check'},
};
export function guide(task){return guides[task.id]||{title:task.title,steps:['Complete the action described in this quest.','Keep a reference to the actual result.','Confirm completion only after its prerequisites are satisfied.'],action:task.default_script?'Open related tool':'Inspect quest',tool:task.default_script};}
export function actionButton(task,cls='primary'){
 const g=guide(task);return `<button class="${cls}" data-quest-action="${esc(task.id)}">${esc(g.action)}</button>`;
}
export function guideHTML(task){const g=guide(task);return `<ol class="quest-steps">${g.steps.map(step=>`<li>${esc(step)}</li>`).join('')}</ol>${actionButton(task,'quiet full')}`;}
export function preparedEvidence(task,data){
 if(task.id==='S01')return data.budget.opening_offer&&data.budget.available_hours_this_week!==null&&data.budget.available_hours_this_week!==undefined?{ready:true,text:`I chose ${data.budget.opening_offer} as the opening offer and confirmed ${data.budget.available_hours_this_week} hours available this week. Reference: data/budget.json.`}:{ready:false,text:'Choose your opening offer and confirm weekly capacity in Plan time.'};
 const leads=data.hunt?.leads||[];const reviewed=leads.filter(l=>l.source_type!=='apollo_csv'&&!l.audit_flags.some(flag=>!['already_contacted'].includes(flag)));
 const selected=leads.filter(l=>l.shortlisted);const drafted=selected.filter(l=>l.draft?.body);const checked=drafted.filter(l=>l.draft.reviewed);
 const required={R01:[reviewed,5,'I checked the public source and Tunisia location'],R02:[selected,5,'I chose these companies for the first outreach batch'],S03:[drafted,3,'I prepared and inspected these company-specific pitches'],Q01:[checked,3,'I checked the source observations, small offers and claims in these pitches']}[task.id];
 if(!required)return null;
 if(required[0].length<required[1])return {ready:false,text:`${required[0].length} / ${required[1]} required items prepared. ${guide(task).action} first.`};
 return {ready:true,text:required[2]+': '+required[0].slice(0,required[1]).map(l=>`${l.company} (${l.id})`).join('; ')+'. References: data/leads.json.'};
}

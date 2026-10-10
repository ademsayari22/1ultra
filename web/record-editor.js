import {esc, human, priceMinor, request} from './api.js';

const stages=['discovered','contacted','no_reply','replied','qualified','sample_received','proposed','accepted','declined','application_submitted','interview','rejected'];
const kinds=['service_prospect','warm_contact','job_discovery','remote_contract_discovery'];
const currencies=['TND','USD','EUR','CAD','AED'];
const $=s=>document.querySelector(s);

function input(name,label,value,type='text',extra=''){
 return `<label for="record-${name}">${esc(label)}</label><input id="record-${name}" data-field="${name}" type="${type}" value="${esc(value??'')}" ${type==='text'?'maxlength="4000"':''} ${extra}>`;
}
function text(name,label,value){return `<label for="record-${name}">${esc(label)}</label><textarea id="record-${name}" data-field="${name}" rows="3" maxlength="4000">${esc(value||'')}</textarea>`;}
function options(name,label,values,value){return `<label for="record-${name}">${esc(label)}</label><select id="record-${name}" data-field="${name}">${values.map(v=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(human(v))}</option>`).join('')}</select>`;}
export function historyView(record,restoreKind=''){
 const history=record.history||[];
 if(!history.length)return '<p class="caption">No edit history yet. Existing records remain intact.</p>';
 return `<details class="record-history"><summary>Edit history · ${history.length} ${history.length===1?'change':'changes'}</summary><ol>${history.map((event,index)=>({event,index})).reverse().map(({event,index})=>`<li><time>${esc(new Date(event.at).toLocaleString('en-GB'))}</time><p>${esc(human(event.before.status))} → ${esc(human(event.after.status))}</p><details><summary>Saved values</summary><pre>${esc(JSON.stringify({before:event.before,after:event.after},null,2))}</pre></details>${restoreKind&&Object.keys(event.before).length?`<button type="button" class="quiet" data-use-${restoreKind}-revision="${index}">Use previous values</button>`:''}</li>`).join('')}</ol></details>`;
}

export class RecordEditor{
 constructor({data,refresh,select,toast,activity}){
  Object.assign(this,{data,refresh,select,toast,activity});this.busy=false;
  document.addEventListener('click',event=>{
   const button=event.target.closest('[data-edit-record],[data-new-record],[data-planning]');
   if(!button||!this.data())return;
   if(button.hasAttribute('data-planning'))this.open('budget');
   else if(button.dataset.newRecord)this.open(button.dataset.newRecord);
   else {const [collection,...id]=button.dataset.editRecord.split(':');this.open(collection,id.join(':'));}
  });
  $('#record-form').addEventListener('submit',event=>this.save(event));
  $('#record-history').addEventListener('click',event=>{
   const button=event.target.closest('[data-use-record-revision]');if(!button)return;
   const previous=this.current.history[Number(button.dataset.useRecordRevision)]?.before;if(!previous)return;
   for(const el of $('#record-fields').querySelectorAll('[data-field]')){
    const key=el.dataset.field;let value=previous[key];
    if(key==='amount')value=previous.amount_minor==null?'':(previous.amount_minor/10**(previous.currency==='TND'?3:2)).toFixed(previous.currency==='TND'?3:2);
    if(el.type==='checkbox')el.checked=false;else el.value=value??'';
   }
   $('#record-note').textContent='Previous values loaded into the form. Review and confirm before saving a new revision.';
  });
  for(const id of ['close-record','cancel-record'])$('#'+id).addEventListener('click',()=>$('#record-dialog').close());
 }
 open(collection,id=null){
  const data=this.data();const record=collection==='budget'?data.budget:data[collection].find(row=>row.id===id)||{};
  this.collection=collection;this.id=id;this.version=data.record_versions[collection];
  this.current=record;
  $('#record-title').textContent=collection==='budget'?'Plan your time':`${id?'Update':'Add'} ${collection==='leads'?'lead':'payment'}`;
  $('#record-note').textContent=collection==='budget'?'Leave unknown values blank. These settings guide your daily queue.':collection==='payments'?'Billing details are optional. Record a receipt only after money actually arrives.':'Record actual outcomes with their evidence. Saving this form does not send a message.';
  let fields='';
  if(collection==='budget'){
   fields='<label for="record-opening_offer">Opening service offer</label><select id="record-opening_offer" data-field="opening_offer"><option value="">Choose one small offer…</option>'+[['cleanup','Checked spreadsheet cleanup'],['documents','Document to checked table'],['catalogue','Catalogue / ERP data preparation'],['website','One-page website pilot']].map(([id,label])=>`<option value="${id}" ${record.opening_offer===id?'selected':''}>${label}</option>`).join('')+'</select>';
   fields+=input('available_hours_this_week','Hours available this week · optional',record.available_hours_this_week,'number','min="0" max="168" step="0.5"');
   fields+=input('daily_minutes','Minutes available today · optional',record.daily_minutes_on&&record.daily_minutes_on!==data.local_date?null:record.daily_minutes,'number','min="0" max="1440" step="1"');
   fields+=`<details class="optional-fields"><summary>Optional payment planning</summary>${input('receiving_method','Receiving method · optional',record.receiving_method)}</details>`;
   if(data.tasks.some(task=>task.id==='F01'))fields+=`<label class="checkbox-label"><input type="checkbox" id="record-defer_billing" data-field="defer_billing" ${record.defer_billing?'checked':''}>Leave billing preparation out of the daily queue for now.</label>`;
  }else if(collection==='leads'){
   fields=input('company','Company or contact name · may be unknown',record.company)+options('kind','Opportunity type',kinds,record.kind||'service_prospect');
   fields+=options('country','Company country · Tunisia focus',['TN','unknown'],record.country||'TN');
   fields+=input('location','City / location',record.location)+input('industry','Industry',record.industry)+input('contact_route','Contact route',record.contact_route);
   fields+=options('status','Recorded stage',stages,record.status||'discovered');
   fields+=input('contacted_on','Actual contact / application date',record.contacted_on,'date');
   fields+=text('status_evidence','Outcome evidence · required for progress',record.status_evidence);
   fields+=text('observed_fact','What you observed',record.observed_fact);
   fields+=text('need_hypothesis','Possible need · a hypothesis until the buyer confirms it',record.need_hypothesis);
   fields+=text('pitch_hook','French pitch opening · based on your source observation',record.pitch_hook);
   fields+=`<details class="optional-fields"><summary>Source details</summary>${input('source_url','Public source URL · optional for warm contacts',record.source_url,'url')}${input('source_reference','Source or relationship reference',record.source_reference)}${input('checked_date','Date actually checked',record.checked_date,'date')}${input('expires','Expiry date · if known',record.expires,'date')}</details>`;
  }else{
   const currency=record.currency||'TND',places=currency==='TND'?3:2;
   const minor=record.amount_minor;
   const decimal=minor===null||minor===undefined?'':`${Math.floor(minor/10**places)}.${String(minor%10**places).padStart(places,'0')}`;
   fields=input('description','Description',record.description)+options('status','Recorded status',['owed','deposit_received','received'],record.status||'owed');
   fields+=options('currency','Currency',currencies,currency)+input('amount','Amount · leave blank if unknown',decimal,'text','inputmode="decimal"');
   fields+=input('receipt_evidence','Actual receipt reference · for received money',record.receipt_evidence);
   fields+=input('received_on','Date money arrived · if known',record.received_on,'date');
   fields+=input('obligation_reference','Delivery / refund obligation · required for deposits',record.obligation_reference);
   fields+=`<details class="optional-fields"><summary>Optional billing details</summary>${input('invoice_reference','Invoice reference',record.invoice_reference)}${input('work_acceptance_evidence','Work acceptance evidence',record.work_acceptance_evidence)}${input('agreed_due_date','Agreed due date · if known',record.agreed_due_date,'date')}</details>`;
  }
  if(collection!=='budget'){
   fields+=input('next_action_on','Next follow-up date · optional',record.next_action_on,'date')+input('next_action','Next action',record.next_action)+text('notes','Notes',record.notes);
   fields+='<label class="checkbox-label"><input id="record-owner_confirmed" data-field="owner_confirmed" type="checkbox">I checked and confirm this actual outcome or receipt.</label>';
  }
  $('#record-fields').innerHTML=fields;
  $('#record-history').innerHTML=collection==='budget'?'':historyView(record,'record');
  $('#record-error').textContent='';$('#record-dialog').showModal();
 }
 body(){
  const body={};
  for(const el of $('#record-fields').querySelectorAll('[data-field]')){
   const key=el.dataset.field;
   body[key]=el.type==='checkbox'?el.checked:el.type==='number'?(el.value===''?null:Number(el.value)):el.value.trim()||null;
  }
  if(this.collection==='payments'){body.amount_minor=priceMinor(body.amount||'',body.currency);delete body.amount;}
  return body;
 }
 async save(event){
  event.preventDefault();if(this.busy)return;this.busy=true;$('#save-record').disabled=true;
  try{
   const path=this.collection==='budget'?'/api/planning':'/api/'+this.collection+(this.id?'/'+encodeURIComponent(this.id):'');
   const value=await request(path,this.body(),{'If-Match':this.version});
   $('#record-dialog').close();await this.refresh();
   if(this.collection!=='budget')this.select(value.record.id);
   this.toast(this.collection==='budget'?'Planning settings saved.':'Record saved with edit history.');
   this.activity(this.collection==='budget'?'Daily queue updated from your planning settings.':'Owner-entered record saved; quest completion is recorded separately.');
  }catch(error){
   let message=error.message;
   if(message.includes('Records changed')){
    try{await this.refresh();this.version=this.data().record_versions[this.collection];
     const confirmation=$('#record-owner_confirmed');if(confirmation)confirmation.checked=false;
     message+=' Your form values are retained. Review the latest record before confirming again.';
     const latest=this.collection==='budget'?this.data().budget:this.data()[this.collection].find(row=>row.id===this.id);
     this.current=latest||{};$('#record-history').innerHTML=latest?historyView(latest,'record'):'';
    }catch{}
   }
   $('#record-error').textContent=message;
  }finally{this.busy=false;$('#save-record').disabled=false;}
 }
}

import {icon,labels,roleIcons} from './icons.js';
import {esc,taskReady} from './api.js';

const positions = [
 ['ultra_research',270,103,145,91],['ultra_ops',425,94,160,104],['ultra_sales',600,103,145,91],
 ['founder',375,254,250,120],['ultra_delivery',270,420,145,88],['ultra_qa',435,420,145,88],['ultra_finance',600,420,145,88],
 ['discover',34,172,150,68],['scope',34,283,150,68],['pilot',34,397,150,68],
 ['ultra_customer',814,285,162,100],['process',237,580,170,68],['review',452,580,170,68],['handover',662,580,170,68],
];
const edges=[['ultra_research','founder'],['ultra_ops','founder'],['ultra_sales','founder'],['founder','ultra_delivery'],['founder','ultra_qa'],['founder','ultra_finance'],['discover','scope'],['scope','pilot'],['scope','founder'],['founder','ultra_customer'],['ultra_delivery','process'],['ultra_qa','review'],['ultra_finance','handover'],['process','review'],['review','handover']];
const nodeLabels={founder:'1ULTRA',discover:'Discover',scope:'Scope',pilot:'Paid pilot',process:'Process',review:'Review',handover:'Handover'};
const captions={founder:'Founder',discover:'8 discoveries',scope:'Sample & terms',pilot:'Agreed terms',process:'D01 · processing',review:'Q02 · source',handover:'D02 · acceptance'};
const groups=[['SALES PIPELINE',20,124,180,367],['AGENT TEAM',254,50,508,478],['SIMULATION',796,245,196,166],['DELIVERY',216,548,634,128]];
const byId=Object.fromEntries(positions.map(p=>[p[0],p]));
function edgePath(a,b) {
  const [,x1,y1,w1,h1]=byId[a],[,x2,y2,w2,h2]=byId[b];
  if(Math.abs(y1-y2)<45 || a==='scope'||b==='ultra_customer') {
    const direction=x2>x1?1:-1,ax=x1+(direction>0?w1:0),ay=y1+h1/2,bx=x2+(direction>0?0:w2),by=y2+h2/2,m=(ax+bx)/2;
    return `M${ax},${ay} H${m} V${by} H${bx}`;
  }
  const downward=y2>y1,ax=x1+w1/2,ay=y1+(downward?h1:0),bx=x2+w2/2,by=y2+(downward?0:h2),m=(ay+by)/2;
  return `M${ax},${ay} V${m} H${bx} V${by}`;
}
export class EcosystemGraph {
  constructor(container,data,onSelect,selected='ultra_ops') {
    this.container=container;this.data=data;this.onSelect=onSelect;this.selected=selected;
    this.mobile=window.innerWidth<700;this.zoom=this.mobile?2.25:1;this.x=0;this.y=0;this.drag=null;this.filter='all';this.search='';
    this.draw();
  }
  draw() {
    this.container.innerHTML=`<div class="graph-stage"><svg id="ecosystem-graph" viewBox="0 0 1000 750" role="group" aria-label="Startup ecosystem map"><defs><marker id="edge-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8" fill="#45cfa1"/></marker></defs><g id="graph-world">${groups.map(([name,x,y,w,h])=>`<g class="graph-group"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9"/><text x="${x+w/2}" y="${y+23}" text-anchor="middle">${name}</text></g>`).join('')}<g class="graph-edges">${edges.map(([a,b])=>`<path data-edge="${a} ${b}" d="${edgePath(a,b)}" marker-end="url(#edge-arrow)"/>`).join('')}</g>${positions.map(p=>this.node(p)).join('')}</g></svg><div class="graph-legend"><span><i class="dot"></i>Ready</span><span><i class="dot blocked"></i>Blocked</span><span><i class="dot simulation"></i>Simulation</span></div><div class="graph-controls"><button data-zoom="out" class="icon-button" aria-label="Zoom out">${icon('minus')}</button><output id="zoom-level">100%</output><button data-zoom="in" class="icon-button" aria-label="Zoom in">${icon('plus')}</button><button data-zoom="fit" class="icon-button fit-button" aria-label="Fit map">${icon('fit')}</button><svg class="minimap" viewBox="0 0 1000 750" aria-label="Ecosystem overview">${positions.map(([id,x,y,w,h])=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${id==='founder'?'mini-core':''}"/>`).join('')}</svg></div></div>`;
    this.svg=this.container.querySelector('#ecosystem-graph');this.world=this.container.querySelector('#graph-world');
    this.container.querySelectorAll('[data-node]').forEach(n=>{
      const select=()=>this.onSelect(n.dataset.node);
      n.addEventListener('click',select);
      n.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();select();}});
    });
    this.container.querySelectorAll('[data-zoom]').forEach(b=>b.addEventListener('click',()=>{
      if(b.dataset.zoom==='fit'){this.zoom=1;this.x=0;this.y=0;}else this.zoom=Math.max(.65,Math.min(3.5,this.zoom+(b.dataset.zoom==='in'?.15:-.15)));
      this.transform();
    }));
    this.svg.addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey){e.preventDefault();this.zoom=Math.max(.65,Math.min(3.5,this.zoom-e.deltaY*.001));this.transform();}},{passive:false});
    this.svg.addEventListener('pointerdown',e=>{if(e.target.closest('[data-node]'))return;this.drag={cx:e.clientX,cy:e.clientY,x:this.x,y:this.y};this.svg.setPointerCapture(e.pointerId);this.svg.classList.add('dragging');});
    this.svg.addEventListener('pointermove',e=>{if(!this.drag)return;const ratio=1000/this.svg.getBoundingClientRect().width;this.x=this.drag.x+(e.clientX-this.drag.cx)*ratio;this.y=this.drag.y+(e.clientY-this.drag.cy)*ratio;this.transform();});
    const end=()=>{this.drag=null;this.svg.classList.remove('dragging');};this.svg.addEventListener('pointerup',end);this.svg.addEventListener('pointercancel',end);
    this.select(this.selected);this.transform();
  }
  node([id,x,y,w,h]) {
    const isRole=id.startsWith('ultra_'),isFounder=id==='founder',kind=isRole?roleIcons[id]:id==='process'?'operations':id;
    const label=labels[id]||nodeLabels[id],caption=id==='discover'?`${this.data.leads.length} discoveries`:isRole?id:captions[id];
    const workflowTask={discover:'R01',scope:'C02',pilot:'F04',process:'D01',review:'Q02',handover:'D02'};
    const task=this.data.tasks.find(t=>t.id===workflowTask[id]);
    const state=id==='ultra_customer'?'simulation':isFounder||id==='ultra_ops'?'ready':isRole?'idle':task?(task.status==='done'&&task.completion_evidence?'ready':taskReady(task)?'ready':'blocked'):'blocked';
    return `<g class="graph-node ${isFounder?'core-node':''} ${state}" data-node="${id}" transform="translate(${x},${y})" tabindex="0" role="button" aria-label="Select ${esc(label)}"><rect class="node-surface" width="${w}" height="${h}" rx="4"/>${isFounder?`<text class="core-title" x="${w/2}" y="44" text-anchor="middle">1ULTRA</text><text class="core-founder" x="${w/2}" y="68" text-anchor="middle">Founder</text><text class="core-copy" x="${w/2}" y="96" text-anchor="middle">Local agent-assisted</text><text class="core-copy" x="${w/2}" y="113" text-anchor="middle">startup command center</text>`:`<g transform="translate(15,15)">${icon(kind).replace('<svg ','<svg width="25" height="25" ')}</g><circle class="node-dot" cx="${w-15}" cy="14" r="4"/><text class="node-label" x="${isRole?17:54}" y="${isRole?57:28}">${esc(label)}</text><text class="node-caption" x="${isRole?17:54}" y="${isRole?77:49}">${esc(caption)}</text>`}</g>`;
  }
  select(id) {this.selected=id;this.container.querySelectorAll('[data-node]').forEach(n=>{n.classList.toggle('selected',n.dataset.node===id);n.setAttribute('aria-pressed',n.dataset.node===id?'true':'false');});}
  transform() {this.world.setAttribute('transform',`translate(${this.x+500*(1-this.zoom)} ${this.y+375*(1-this.zoom)}) scale(${this.zoom})`);this.container.querySelector('#zoom-level').textContent=`${Math.round(this.zoom*100)}%`;}
  applyFilter(filter,search) {
    this.filter=filter;this.search=search.toLowerCase();
    const match=id=>{const text=`${labels[id]||nodeLabels[id]} ${id}`.toLowerCase();const group=filter==='all'||(filter==='agents'&&id.startsWith('ultra_'))||(filter==='sales'&&['discover','scope','pilot'].includes(id))||(filter==='delivery'&&['process','review','handover'].includes(id));return group&&(!this.search||text.includes(this.search));};
    if(this.mobile){
      const centers={all:[500,375],agents:[508,290],sales:[110,310],delivery:[530,610]};
      let [cx,cy]=centers[filter]||centers.all;
      const first=this.search?positions.find(p=>match(p[0])):null;if(first){cx=first[1]+first[3]/2;cy=first[2]+first[4]/2;}
      this.zoom=2.25;this.x=(500-cx)*this.zoom;this.y=(375-cy)*this.zoom;this.transform();
    }
    this.container.querySelectorAll('[data-node]').forEach(n=>n.classList.toggle('dimmed',!match(n.dataset.node)));
    this.container.querySelectorAll('[data-edge]').forEach(n=>n.classList.toggle('dimmed',!n.dataset.edge.split(' ').every(match)));
  }
}

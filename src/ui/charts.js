// Small SVG charts with hover. No libraries.

import { MON, MONL, money } from '../core/format.js';

export function niceMax(v){ const p = Math.pow(10, Math.floor(Math.log10(v||1))); for (const m of [1,2,2.5,5,10]) if (m*p >= v) return m*p; return 10*p; }
export function lineChart(svg, tip, series, labels){
  const W = svg.clientWidth || 700, H = +svg.getAttribute('height'), L=44, R=40, T=10, B=24;
  const max = niceMax(Math.max(...series.flatMap(s=>s.v.filter(x=>x!=null))));
  const x = i => L + i*(W-L-R)/(labels.length-1), y = v => T + (H-T-B)*(1-v/max);
  let g = '';
  for (let i=0;i<=4;i++){ const v=max*i/4; g += `<line class="gl" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L-8}" y="${y(v)+4}" text-anchor="end">${v>=1000?(v/1000)+'k':v}</text>`; }
  labels.forEach((l,i)=> g += `<text x="${x(i)}" y="${H-6}" text-anchor="middle">${l}</text>`);
  for (const s of series){
    const pts = s.v.map((v,i)=>v==null?null:[x(i),y(v)]).filter(Boolean);
    if (!pts.length) continue;
    g += `<polyline fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(p=>p.join(',')).join(' ')}"/>`;
    const last = pts[pts.length-1]; g += `<circle cx="${last[0]}" cy="${last[1]}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/><text x="${last[0]+8}" y="${last[1]+4}" style="fill:var(--text2);font-weight:500">${s.name}</text>`;
  }
  g += `<line id="xh" class="gl" y1="${T}" y2="${H-B}" style="display:none;stroke:var(--text3)"/><g id="dots"></g><rect x="${L}" y="0" width="${W-L-R}" height="${H}" fill="transparent" id="hit"/>`;
  svg.innerHTML = g;
  const hit = svg.querySelector('#hit'), xh = svg.querySelector('#xh'), dots = svg.querySelector('#dots');
  hit.addEventListener('mousemove', e => {
    const r = svg.getBoundingClientRect(), i = Math.max(0, Math.min(labels.length-1, Math.round((e.clientX-r.left-L)/((W-L-R)/(labels.length-1)))));
    xh.style.display=''; xh.setAttribute('x1',x(i)); xh.setAttribute('x2',x(i));
    dots.innerHTML = series.filter(s=>s.v[i]!=null).map(s=>`<circle cx="${x(i)}" cy="${y(s.v[i])}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`).join('');
    tip.innerHTML = `<b>${MONL[i]}</b>` + series.map(s=>`<div class="tr"><i style="background:${s.color}"></i><span>${s.name}</span>${s.v[i]==null?'–':money(s.v[i],false)}</div>`).join('');
    tip.style.display='block'; const tx = x(i)+16; tip.style.left = (tx+160>W? x(i)-170 : tx)+'px'; tip.style.top='40px';
  });
  hit.addEventListener('mouseleave', () => { tip.style.display='none'; xh.style.display='none'; dots.innerHTML=''; });
}
export function barChart(svg, tip, data, onPick, budget=null){
  const W = svg.clientWidth || 700, H = +svg.getAttribute('height'), L=44, R=8, T=10, B=24;
  const max = niceMax(Math.max(...data.map(d=>d[1]), budget||0, 1)), bw = (W-L-R)/data.length;
  const y = v => T + (H-T-B)*(1-Math.max(0,v)/max);
  let g = '';
  for (let i=0;i<=4;i++){ const v=max*i/4; g += `<line class="gl" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L-8}" y="${y(v)+4}" text-anchor="end">${v>=1000?(v/1000).toFixed(v%1000?1:0)+'k':Math.round(v)}</text>`; }
  data.forEach(([k,v],i)=>{
    const h = Math.max(0,(H-T-B)-(y(v)-T)), x0 = L+i*bw+1, w = Math.max(2,bw-4);
    if (h>0) g += `<path d="M${x0},${H-B} v${-(h-Math.min(4,h))} q0,-${Math.min(4,h)} ${Math.min(4,w/2)},-${Math.min(4,h)} h${w-2*Math.min(4,w/2)} q${Math.min(4,w/2)},0 ${Math.min(4,w/2)},${Math.min(4,h)} v${h-Math.min(4,h)} z" fill="var(--accent)"/>`;
    if (k.endsWith('-01') || k.endsWith('-07')) g += `<text x="${x0+w/2}" y="${H-6}" text-anchor="middle">${MON[+k.slice(5)-1]} ${k.slice(2,4)}</text>`;
    g += `<rect x="${L+i*bw}" y="0" width="${bw}" height="${H}" fill="transparent" data-i="${i}"/>`;
  });
  if (budget) g += `<line x1="${L}" x2="${W-R}" y1="${y(budget)}" y2="${y(budget)}" class="budline"/>`;
  svg.innerHTML = g;
  svg.querySelectorAll('rect[data-i]').forEach(r => {
    r.addEventListener('mouseenter', () => { const i=+r.dataset.i, [k,v]=data[i]; tip.innerHTML = `<b>${MONL[+k.slice(5)-1]} ${k.slice(0,4)}</b><div>${money(v)}</div>`; tip.style.display='block'; const lx = L+i*bw+bw+12; tip.style.left=(lx+130>W?L+i*bw-130:lx)+'px'; tip.style.top='40px'; });
    r.addEventListener('mouseleave', () => tip.style.display='none');
    r.addEventListener('click', () => onPick && onPick(data[+r.dataset.i][0]));
  });
}

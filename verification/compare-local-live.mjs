// Real rendering of local and live, same session, same viewport — so a difference is a difference.
import { spawn } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe', PORT=9350
const OUT='verification/redesign-compare'
await mkdir(OUT,{recursive:true})
const proc=spawn(CHROME,['--headless','--disable-gpu','--no-sandbox',`--remote-debugging-port=${PORT}`,'about:blank'],{stdio:'ignore'})
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); let list
for(let i=0;i<40;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}/json/list`);if(r.ok){list=await r.json();break}}catch{}await sleep(250)}
const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl)
await new Promise(r=>ws.addEventListener('open',r))
let id=0;const p=new Map()
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id)}})
const send=(m,q={})=>new Promise(r=>{const i=++id;p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:q}))})
const ev=async x=>(await send('Runtime.evaluate',{returnByValue:true,expression:x,awaitPromise:true})).result?.result?.value

const PAGES=[
  ['home','/'],['news','/news'],['article','/news/a-tribute-to-major-league-pool'],
  ['seasons','/seasons'],['groups','/seasons/2187?view=groups'],['playoffs','/seasons/2187?view=playoffs'],
  ['tournaments','/tournaments'],['ladder','/rankings'],['register','/register'],['login','/login'],
  ['profile','/players/xlx-cerebro-xlx'],
]
const WIDTHS=[[1440,900],[390,844]]
const rows=[]
await send('Page.enable')
for(const [w,h] of WIDTHS){
  await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:w<768})
  for(const [name,path] of PAGES){
    const probe={}
    for(const [env,base] of [['local','http://localhost:3000'],['live','https://8br.gg']]){
      await send('Page.navigate',{url:base+path+(path.includes('?')?'&':'?')+'cb='+Date.now()})
      await sleep(w===1440?2600:2200)
      const r=await ev(`(()=>{const de=document.documentElement;
        const imgs=[...document.images];
        const broken=imgs.filter(i=>i.complete&&i.naturalWidth===0).length;
        const clipped=[...document.querySelectorAll('h1,h2,h3,p,td,a,button')].filter(e=>e.scrollWidth>e.clientWidth+2&&getComputedStyle(e).overflow==='visible').length;
        const nav=[...document.querySelectorAll('header a')].map(a=>a.textContent.trim()).filter(Boolean).join('|');
        return JSON.stringify({sw:de.scrollWidth,cw:de.clientWidth,imgs:imgs.length,broken,clipped,nav,title:document.title});})()`)
      probe[env]=JSON.parse(r||'{}')
      const shot=await send('Page.captureScreenshot',{format:'png'})
      if(shot.result?.data) await writeFile(`${OUT}/${name}-${w}-${env}.png`,Buffer.from(shot.result.data,'base64'))
    }
    const L=probe.local,V=probe.live
    rows.push({page:name,w,
      overflowL:L.sw>L.cw, overflowV:V.sw>V.cw,
      brokenL:L.broken, brokenV:V.broken,
      clippedL:L.clipped, clippedV:V.clipped,
      imgsMatch:L.imgs===V.imgs, imgsL:L.imgs, imgsV:V.imgs,
      navMatch:L.nav===V.nav, titleMatch:L.title===V.title})
  }
}
let bad=0
console.log('')
for(const r of rows){
  const issues=[]
  if(r.overflowL) issues.push('local overflow'); if(r.overflowV) issues.push('live overflow')
  if(r.brokenL) issues.push(`local ${r.brokenL} broken img`); if(r.brokenV) issues.push(`live ${r.brokenV} broken img`)
  if(r.clippedL) issues.push(`local ${r.clippedL} clipped`)
  if(!r.imgsMatch) issues.push(`img count ${r.imgsL} vs ${r.imgsV}`)
  if(!r.navMatch) issues.push('nav differs')
  if(!r.titleMatch) issues.push('title differs')
  if(issues.length) bad++
  console.log(`  ${issues.length?'DIFF':'ok  '} ${String(r.w).padStart(4)} ${r.page.padEnd(12)} ${issues.join('; ')||'local matches live'}`)
}
console.log(`\n  ${rows.length-bad}/${rows.length} comparisons clean`)
ws.close();proc.kill()

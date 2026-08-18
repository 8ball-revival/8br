import { spawn } from 'node:child_process'
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe', PORT=9340
const proc=spawn(CHROME,['--headless','--disable-gpu','--no-sandbox',`--remote-debugging-port=${PORT}`,'about:blank'],{stdio:'ignore'})
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); let list
for(let i=0;i<40;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}/json/list`);if(r.ok){list=await r.json();break}}catch{}await sleep(250)}
const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl)
await new Promise(r=>ws.addEventListener('open',r))
let id=0;const p=new Map()
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id)}})
const send=(m,q={})=>new Promise(r=>{const i=++id;p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:q}))})
const ev=async x=>(await send('Runtime.evaluate',{returnByValue:true,expression:x,awaitPromise:true})).result?.result?.value
await send('Page.enable')
let pass=0,fail=0
const ck=(n,ok,d='')=>{ if(ok)pass++;else{fail++} ; console.log(`    ${ok?'ok  ':'FAIL'} ${n}${ok?'':' — '+d}`) }
for(const [label,w,h] of [['desktop',1440,900],['mobile',390,844]]){
  console.log(`\n  ${label}`)
  await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:w<768})
  for(const [name,path] of [['home','/'],['news','/news'],['article','/news/a-tribute-to-major-league-pool'],['ladder','/rankings']]){
    await send('Page.navigate',{url:'https://8br.gg'+path+'?cb='+Date.now()}); await sleep(3000)
    const r=await ev(`(()=>{const de=document.documentElement;
      const broken=[...document.images].filter(i=>i.complete&&i.naturalWidth===0).map(i=>i.currentSrc||i.src).slice(0,3);
      return JSON.stringify({sw:de.scrollWidth,cw:de.clientWidth,imgs:document.images.length,broken});})()`)
    const v=JSON.parse(r||'{}')
    ck(`${name}: no horizontal overflow`, v.sw<=v.cw, `${v.sw}/${v.cw}`)
    ck(`${name}: no broken images (${v.imgs} total)`, (v.broken||[]).length===0, (v.broken||[]).join(' '))
  }
  // lightbox above the header
  await send('Page.navigate',{url:'https://8br.gg/news/a-tribute-to-major-league-pool?cb='+Date.now()}); await sleep(3000)
  await ev(`document.querySelector('button[aria-haspopup="dialog"]').click()`); await sleep(900)
  const lb=await ev(`(()=>{const c=document.querySelector('[aria-label="Close image"]');if(!c)return JSON.stringify({open:false});
    const b=c.getBoundingClientRect();const hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);
    return JSON.stringify({open:true,clickable:!!(hit&&(hit===c||c.contains(hit)))});})()`)
  const l=JSON.parse(lb||'{}')
  ck('lightbox opens', l.open===true)
  ck('close control is clickable (above the header)', l.clickable===true)
  await ev(`document.querySelector('[aria-label="Close image"]')?.click()`); await sleep(500)
}
console.log(`\n  ${pass} passed, ${fail} failed`)
ws.close();proc.kill(); process.exitCode=fail>0?1:0

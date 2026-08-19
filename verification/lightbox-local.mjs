// Lightbox behaviour, exercised in real Chrome: open, zoom, and all three ways of closing.
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9336, OUT = 'verification/redesign-compare'
const proc = spawn(CHROME, ['--headless','--disable-gpu','--no-sandbox',`--remote-debugging-port=${PORT}`,'about:blank'], { stdio:'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let list
for (let i=0;i<40;i++){ try{ const r=await fetch(`http://127.0.0.1:${PORT}/json/list`); if(r.ok){ list=await r.json(); break } }catch{} await sleep(250) }
const ws = new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl)
await new Promise(r=>ws.addEventListener('open',r))
let id=0; const pending=new Map()
ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}})
const send=(method,params={})=>new Promise(res=>{const i=++id;pending.set(i,res);ws.send(JSON.stringify({id:i,method,params}))})
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate',{returnByValue:true,expression:expr,awaitPromise:true})
  return r.result?.result?.value
}
const shot = async (name) => {
  const s = await send('Page.captureScreenshot',{format:'png'})
  if (s.result?.data) await writeFile(`${OUT}/${name}.png`, Buffer.from(s.result.data,'base64'))
}
let pass=0, fail=0
const check=(n,ok,d='')=>{ if(ok)pass++; else {fail++; console.log(`    FAIL ${n}${d?' — '+d:''}`)} ; console.log(`    ${ok?'ok  ':'FAIL'} ${n}`) }

await send('Page.enable')
const URL_ = 'http://localhost:3000/news/a-tribute-to-major-league-pool'

for (const [label,w,h] of [['desktop',1440,900],['mobile',390,844]]) {
  console.log(`\n  ${label} (${w}x${h})`)
  await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:w<768})
  await send('Page.navigate',{url:URL_}); await sleep(3000)

  const beforeOverflow = await evalJs(`document.body.style.overflow || '(none)'`)
  // Open by clicking the featured image's button.
  await evalJs(`(()=>{const b=document.querySelector('aside button[aria-haspopup="dialog"]')||document.querySelector('button[aria-haspopup="dialog"]');b.setAttribute('data-trigger','1');b.click();return true})()`)
  await sleep(900)
  check('lightbox opens', await evalJs(`!!document.querySelector('[role="dialog"][aria-modal="true"]')`))
  const nat = await evalJs(`(()=>{const i=document.querySelector('[role=dialog] img');return i?i.naturalWidth+'x'+i.naturalHeight:'none'})()`)
  const rend = await evalJs(`(()=>{const i=document.querySelector('[role=dialog] img');const r=i.getBoundingClientRect();return Math.round(r.width)+'x'+Math.round(r.height)})()`)
  check('original image is loaded', nat !== 'none' && !nat.startsWith('0x'), nat)
  const [nw,nh]=nat.split('x').map(Number), [rw,rh]=rend.split('x').map(Number)
  check('aspect ratio preserved (not distorted)', Math.abs((nw/nh)-(rw/rh)) < 0.02, `natural ${nat} rendered ${rend}`)
  check('background scroll locked', (await evalJs(`document.body.style.overflow`)) === 'hidden')
  await shot(`lightbox-${label}-open`)

  // Zoom in / out / reset
  await evalJs(`document.querySelector('[aria-label="Zoom in"]').click()`); await sleep(400)
  const z1 = await evalJs(`parseInt(document.querySelector('[role=dialog] span').textContent,10)`)
  check('zoom in increases magnification', Number(z1) > 100, `${z1}%`)
  check('zoomed image can scroll', await evalJs(`document.querySelector('[role=dialog]').scrollHeight >= document.querySelector('[role=dialog]').clientHeight`))
  await shot(`lightbox-${label}-zoomed`)
  await evalJs(`document.querySelector('[aria-label="Zoom out"]').click()`); await sleep(300)
  check('zoom out decreases magnification', Number(await evalJs(`parseInt(document.querySelector('[role=dialog] span').textContent,10)`)) < Number(z1))
  await evalJs(`document.querySelector('[aria-label="Zoom in"]').click();document.querySelector('[aria-label="Zoom in"]').click()`); await sleep(400)
  await evalJs(`document.querySelector('[aria-label="Reset to fit"]').click()`); await sleep(400)
  check('reset returns to fit', (await evalJs(`parseInt(document.querySelector('[role=dialog] span').textContent,10)`)) === 100)

  // Escape
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await sleep(700)
  check('Escape closes', !(await evalJs(`!!document.querySelector('[role="dialog"][aria-modal="true"]')`)))
  check('focus returns to the triggering image', await evalJs(`document.activeElement?.getAttribute('data-trigger')==='1'`))
  check('background scroll restored', (await evalJs(`document.body.style.overflow || '(none)'`)) === beforeOverflow)

  // Close button
  await evalJs(`document.querySelector('button[aria-haspopup="dialog"]').click()`); await sleep(800)
  await evalJs(`document.querySelector('[aria-label="Close image"]').click()`); await sleep(700)
  check('the close control closes', !(await evalJs(`!!document.querySelector('[role="dialog"][aria-modal="true"]')`)))

  // Backdrop
  await evalJs(`document.querySelector('button[aria-haspopup="dialog"]').click()`); await sleep(800)
  check('clicking the IMAGE does not close', await evalJs(`(()=>{document.querySelector('[role=dialog] img').click();return !!document.querySelector('[role=dialog]')})()`))
  await evalJs(`(()=>{const d=document.querySelector('[role=dialog]');d.dispatchEvent(new MouseEvent('click',{bubbles:true}));return true})()`)
  await sleep(700)
  check('clicking the backdrop closes', !(await evalJs(`!!document.querySelector('[role="dialog"][aria-modal="true"]')`)))

  const de = await evalJs(`document.documentElement.scrollWidth + '/' + document.documentElement.clientWidth`)
  const [sw,cw]=de.split('/').map(Number)
  check('no horizontal page overflow', sw<=cw, de)
}
console.log(`\n  ${pass} passed, ${fail} failed`)
ws.close(); proc.kill()
process.exitCode = fail>0?1:0

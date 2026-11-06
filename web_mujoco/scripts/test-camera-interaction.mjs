import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createServer} from 'vite';

const externalUrl=process.argv.find(arg=>arg.startsWith('--url='))?.slice(6);
const server=externalUrl?null:await createServer({server:{host:'127.0.0.1',port:5196,strictPort:true}});
await server?.listen();
const url=externalUrl||'http://127.0.0.1:5196/?variant=dual';
const label=process.argv.find(arg=>arg.startsWith('--label='))?.slice(8)||'current';
const baseline=process.argv.includes('--baseline');
const softwareRendering=!process.argv.includes('--hardware');
// Match the visual UI check: reduce only main-canvas pixels on CPU-only CI.
const deviceScaleFactor=softwareRendering ? .5 : 1;
// CI uses SwiftShader and captures previews serially. A single capture has taken
// nearly 47 seconds on the hosted runner, so allow time for all three cameras.
const previewTimeout=softwareRendering?240000:10000;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||(process.platform==='win32'?'chrome':undefined),headless:true,
  args:[...(softwareRendering?['--use-angle=swiftshader']:[]),'--enable-webgl','--ignore-gpu-blocklist']});
const errors=[],report={url,label,environment:{softwareRendering,deviceScaleFactor,previewTimeout}};
await mkdir('.reports',{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:1100,height:850},deviceScaleFactor,serviceWorkers:'block'});
  await page.addInitScript(()=>{
    window.__previewPaints={};
    const wait=WebGL2RenderingContext.prototype.clientWaitSync;
    WebGL2RenderingContext.prototype.clientWaitSync=function(...args) {
      return window.__holdCameraReadback?this.TIMEOUT_EXPIRED:wait.apply(this,args);
    };
    const paint=CanvasRenderingContext2D.prototype.putImageData;
    CanvasRenderingContext2D.prototype.putImageData=function(...args) {
      const result=paint.apply(this,args),id=this.canvas.id;
      if(['overhead-camera-canvas','left-wrist-camera-canvas','right-wrist-camera-canvas'].includes(id)) {
        const previous=window.__previewPaints[id],now=performance.now();
        window.__previewPaints[id]={frames:(previous?.frames||0)+1,lastAt:now};
      }
      return result;
    };
  });
  page.on('pageerror',error=>errors.push(error.message));
  await page.routeWebSocket('**',socket=>socket.close());
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.rebotDual&&document.getElementById('dual-loading').hidden,null,{timeout:180000});
  await page.waitForFunction(()=>['overhead-camera-canvas','left-wrist-camera-canvas','right-wrist-camera-canvas'].every(id=>
    document.getElementById(id).getContext('2d').getImageData(160,120,1,1).data.slice(0,3).some(v=>v>0)),null,{timeout:90000});
  await page.waitForTimeout(2000);
  const paints=()=>page.evaluate(()=>structuredClone(window.__previewPaints));
  const paintDelta=(before,after)=>Object.fromEntries(Object.keys(before).map(id=>[id,after[id].frames-before[id].frames]));
  const waitForPaints=before=>page.waitForFunction(before=>Object.keys(before).every(id=>
    window.__previewPaints[id]?.frames>before[id].frames),before,{timeout:previewTimeout});
  const waitForDraw=before=>page.waitForFunction(draws=>window.rebotDual.renderMetrics().mainDraws>draws,
    before.mainDraws,{timeout:previewTimeout});
  const idlePaintsBefore=await paints();await page.waitForTimeout(600);
  if(!baseline) {
    try {await waitForPaints(idlePaintsBefore);}
    catch(error) {
      report.idlePreviewTimeout={before:idlePaintsBefore,after:await paints(),metrics:await page.evaluate(()=>window.rebotDual.renderMetrics())};
      throw error;
    }
  }
  report.idlePreviews=paintDelta(idlePaintsBefore,await paints());
  if(!baseline)assert(Object.values(report.idlePreviews).every(count=>count>0),'all three preview canvases must keep painting while the scene is idle');
  await page.mouse.move(100,470);
  const snapshot=()=>page.evaluate(()=>window.rebotDual.renderMetrics());
  report.before=await snapshot();
  await page.mouse.wheel(0,-120);await page.waitForTimeout(300);
  if(!baseline)await waitForDraw(report.before);
  report.singleWheel=await snapshot();
  report.singleWheelDraws=report.singleWheel.mainDraws-report.before.mainDraws;
  assert(report.singleWheel.camera.distance<report.before.camera.distance,'wheel must move the camera');
  if(!baseline)assert(report.singleWheelDraws>0,'an idle scene must repaint after a single wheel tick');
  console.log(JSON.stringify({label,singleWheelDraws:report.singleWheelDraws,beforeDistance:report.before.camera.distance,afterDistance:report.singleWheel.camera.distance}));
  const samples=[];
  for(const delta of [-80,-80,-80,80,80,80,80,-80]) {
    const before=await snapshot();await page.mouse.wheel(0,delta);await page.waitForTimeout(160);
    if(!baseline)await waitForDraw(before);
    const after=await snapshot();samples.push({delta,draws:after.mainDraws-before.mainDraws,distance:after.camera.distance,mainMs:after.mainMs});
    assert.deepEqual(after.camera.target,report.before.camera.target);
    if(!baseline)assert(after.mainDraws>before.mainDraws,'each wheel tick must produce a visible frame');
  }
  report.samples=samples;report.after=await snapshot();
  report.steadyMainCpuMs=(report.after.mainTotalMs-report.before.mainTotalMs)/Math.max(1,report.after.mainDraws-report.before.mainDraws);
  const burstBefore=await snapshot();
  const burstPaintsBefore=await paints();
  const paintProbe=page.evaluate(()=>new Promise(resolve=>{
    const began=performance.now(),paintTimes=[];let draws=window.rebotDual.renderMetrics().mainDraws;
    window.__cameraProbeActive=true;
    function tick(now) {
      const current=window.rebotDual.renderMetrics().mainDraws;
      if(current!==draws){paintTimes.push(now-began);draws=current;}
      if(window.__cameraProbeActive)requestAnimationFrame(tick);else resolve(paintTimes);
    }
    requestAnimationFrame(tick);
  }));
  const burstDeadline=Date.now()+previewTimeout;
  let burstPaintsEnd;
  for(let i=0;;i++) {
    const before=await snapshot();await page.mouse.wheel(0,Math.floor(i/12)%2===0?-40:40);await page.waitForTimeout(20);
    if(!baseline&&softwareRendering)await waitForDraw(before);
    if(i>=23&&(i+1)%6===0) {
      burstPaintsEnd=await paints();
      if(baseline||Object.values(paintDelta(burstPaintsBefore,burstPaintsEnd)).every(count=>count>0)||Date.now()>=burstDeadline)break;
    }
  }
  report.burstEnd=await snapshot();
  await page.evaluate(()=>{window.__cameraProbeActive=false;});
  const paintTimes=await paintProbe;
  report.burst={draws:report.burstEnd.mainDraws-burstBefore.mainDraws,paintTimes,
    maxPaintGapMs:Math.max(0,...paintTimes.slice(1).map((time,i)=>time-paintTimes[i])),
    previewCaptures:report.burstEnd.sensor.captures-burstBefore.sensor.captures,
    previewPaints:paintDelta(burstPaintsBefore,burstPaintsEnd)};
  if(!baseline)assert(report.burst.draws>=12,'a continuous wheel gesture must keep repainting');
  if(!baseline)assert(Object.values(report.burst.previewPaints).every(count=>count>0),'zooming must not starve any preview canvas');
  await page.waitForTimeout(700);const idleStart=await snapshot();await page.waitForTimeout(600);const idleEnd=await snapshot();
  report.idleDraws=idleEnd.mainDraws-idleStart.mainDraws;
  if(!baseline)assert(report.idleDraws<=1,'camera updates must stop when interaction settles');
  if(!baseline) {
    await page.evaluate(()=>{window.__holdCameraReadback=true;});
    await page.waitForFunction(()=>window.rebotDual.renderMetrics().sensor.pendingCaptures>0,null,{timeout:previewTimeout});
    const waitingBefore=await snapshot();
    for(let i=0;i<6;i++){await page.mouse.wheel(0,i<3?-40:40);await page.waitForTimeout(25);}
    await waitForDraw(waitingBefore);
    const waitingAfter=await snapshot();
    assert(waitingAfter.mainDraws>waitingBefore.mainDraws,'pending camera readback must not freeze the main viewport');
    assert(waitingAfter.sensor.pendingCaptures>0);
    const framesBefore=waitingAfter.previews;
    await page.evaluate(()=>{window.__holdCameraReadback=false;});
    await page.waitForFunction(framesBefore=>['overhead','left-wrist','right-wrist'].every(key=>
      window.rebotDual.renderMetrics().previews[key].frames>framesBefore[key].frames),framesBefore,{timeout:previewTimeout});
    report.delayedReadback={mainDraws:waitingAfter.mainDraws-waitingBefore.mainDraws,recovered:await snapshot()};
  }
  assert(!report.after.previewError);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({label,idlePreviews:report.idlePreviews,samples,burst:report.burst,idleDraws:report.idleDraws,steadyMainCpuMs:report.steadyMainCpuMs,errors}));
} finally {
  report.errors=errors;await writeFile(`.reports/camera-${label}.json`,JSON.stringify(report,null,2));await browser.close();await server?.close();
}

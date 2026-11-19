import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { MODEL_VARIANTS } from '../src/model-variants.js';
const externalUrl=process.argv.find(arg=>arg.startsWith('--url='))?.slice(6);
const softwareRendering=!process.argv.includes('--hardware');
// Keep CSS layout and RGB-D sensor resolution unchanged. Only the main canvas
// uses fewer display pixels on CPU-only CI runners.
const deviceScaleFactor=softwareRendering ? .5 : 1;
const observationTimeout=softwareRendering?180000:60000;
const taskTimeout=softwareRendering?600000:240000;
const server=externalUrl?null:await createServer({server:{host:'127.0.0.1',port:5194,strictPort:true}});
await server?.listen();
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||(process.platform==='win32'?'chrome':undefined),headless:true,args:[...(softwareRendering?['--use-angle=swiftshader']:[]),'--enable-webgl','--ignore-gpu-blocklist']});
const errors=[],checks={environment:{softwareRendering,deviceScaleFactor,observationTimeout,taskTimeout}};await mkdir('.reports',{recursive:true});
let page;
try {
  page=await browser.newPage({viewport:{width:1100,height:850},deviceScaleFactor});
  page.setDefaultTimeout(90000);
  page.on('pageerror',error=>errors.push(error.message));await page.routeWebSocket('**',socket=>socket.close());
  await page.goto(externalUrl||'http://127.0.0.1:5194/?variant=dual',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.rebotDual&&document.getElementById('dual-loading').hidden,null,{timeout:180000});
  console.log('UI: scene loaded');
  const cameraPixels=()=>page.evaluate(()=>['overhead-camera-canvas','left-wrist-camera-canvas','right-wrist-camera-canvas'].map(id=>{
    const c=document.getElementById(id),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let nonzero=0,hash=0;for(let i=0;i<p.length;i+=16){if(p[i]||p[i+1]||p[i+2])nonzero++;hash=(hash*31+p[i]+p[i+1]*3+p[i+2]*7)>>>0;}return {id,nonzero,hash,visible:c.getClientRects().length>0};
  }));
  await page.waitForFunction(()=>['overhead-camera-canvas','left-wrist-camera-canvas','right-wrist-camera-canvas'].every(id=>{
    const c=document.getElementById(id);return c.getContext('2d').getImageData(160,120,1,1).data.slice(0,3).some(v=>v>0);
  }),null,{timeout:90000});
  const camerasBefore=await cameraPixels();
  assert(camerasBefore.every(c=>c.nonzero>100&&c.visible));assert(new Set(camerasBefore.map(c=>c.hash)).size===3);
  checks.camerasBefore=camerasBefore;
  checks.renderBefore=await page.evaluate(()=>window.rebotDual.renderMetrics());
  console.log('UI: three camera frames ready',JSON.stringify(checks.renderBefore));
  await page.screenshot({path:'.reports/visual-ui-initial.png',timeout:90000});
  const orbit=MODEL_VARIANTS.dual.view.orbit;
  const cameraState=()=>page.evaluate(()=>window.rebotDual.renderMetrics().camera);
  function checkCameraUnchanged(actual,expected) {
    for(const key of ['position','target'])actual[key].forEach((value,i)=>assert(Math.abs(value-expected[key][i])<1e-6,'tasks must preserve the user camera'));
  }
  function checkBounds(camera) {
    for(const [value,min,max] of [[camera.azimuth,orbit.minAzimuthAngle,orbit.maxAzimuthAngle],
      [camera.polar,orbit.minPolarAngle,orbit.maxPolarAngle],[camera.distance,orbit.minDistance,orbit.maxDistance]]) {
      assert(value>=min-1e-6&&value<=max+1e-6,JSON.stringify(camera));
    }
    assert(camera.position[0]>camera.target[0]&&camera.position[2]>camera.target[2]);
    assert(camera.position[1] <= MODEL_VARIANTS.dual.view.maxCameraY + 1e-6, 'Camera must stay inside the side wall');
  }
  const initialCamera=await cameraState();checkBounds(initialCamera);
  assert(initialCamera.azimuth>Math.PI*105/180,'the initial view must be on the clear side of the coffee machine, beyond the former right limit');
  assert(initialCamera.azimuth<orbit.maxAzimuthAngle,'the initial view must leave room to rotate farther right');
  for(const [id,position,target] of [
    ['dual-room',[3,-3.2,2.7],[.28,.28,.98]],
    ['dual-overhead',[.3,-.001,2.9],[.24,0,.83]],
    ['dual-close',[1.45,.90,1.80],[.29,.01,.94]],
    ['dual-coffee',[1.5,.95,1.85],[.32,-.10,.98]],
    ['dual-feeding',[1.25,-.25,1.65],[.25,.42,1.00]],
    ['dual-perspective',MODEL_VARIANTS.dual.view.position,MODEL_VARIANTS.dual.view.target]
  ]) {
    await page.locator(`#${id}`).click();const camera=await cameraState();checkBounds(camera);
    camera.position.forEach((value,i)=>assert(Math.abs(value-position[i])<1e-6,JSON.stringify({id,camera,position})));
    camera.target.forEach((value,i)=>assert(Math.abs(value-target[i])<1e-6));
    if(id==='dual-room')await page.screenshot({path:'.reports/visual-ui-room.png'});
  }
  // Start on the scene canvas, clear of both the camera monitors and dock.
  const pointer={x:100,y:470};
  for(const [dx,dy,property,expected] of [
    [1800,0,'azimuth',orbit.minAzimuthAngle],[-1800,0,'azimuth',orbit.maxAzimuthAngle],
    [0,1800,'polar',orbit.minPolarAngle],[0,-1800,'polar',orbit.maxPolarAngle]
  ]) {
    await page.locator('#dual-perspective').click();await page.mouse.move(pointer.x,pointer.y);await page.mouse.down();
    await page.mouse.move(pointer.x+dx,pointer.y+dy,{steps:12});await page.mouse.up();
    await page.waitForFunction(({property,expected})=>Math.abs(window.rebotDual.renderMetrics().camera[property]-expected)<1e-6,{property,expected},{timeout:5000});
    const camera=await cameraState();checkBounds(camera);assert(Math.abs(camera[property]-expected)<1e-6,JSON.stringify({dx,dy,property,expected,camera}));
  }
  await page.locator('#dual-perspective').click();const anchored=await cameraState();
  for(const modifiers of [[],['Control']]) {
    for(const key of modifiers)await page.keyboard.down(key);
    await page.mouse.move(pointer.x,pointer.y);await page.mouse.down({button:modifiers.length?'left':'right'});
    await page.mouse.move(pointer.x+350,pointer.y+150,{steps:6});await page.mouse.up({button:modifiers.length?'left':'right'});
    for(const key of modifiers)await page.keyboard.up(key);
    assert.deepEqual((await cameraState()).target,anchored.target);
  }
  await page.locator('#dual-room').click();
  await page.mouse.move(pointer.x,pointer.y);
  for(const [delta,distance] of [[10000,orbit.maxDistance],[-10000,orbit.minDistance]]) {
    await page.mouse.wheel(0,delta);
    await page.waitForFunction(({distance})=>Math.abs(window.rebotDual.renderMetrics().camera.distance-distance)<1e-6,{distance});
    checkBounds(await cameraState());
  }
  // A wide shot can cross the wall when orbiting toward it at full zoom out.
  await page.locator('#dual-room').click();
  await page.mouse.move(pointer.x,pointer.y);
  await page.mouse.wheel(0,10000);
  await page.waitForFunction(max => Math.abs(window.rebotDual.renderMetrics().camera.distance - max) < 1e-6,orbit.maxDistance);
  await page.mouse.down();
  await page.mouse.move(pointer.x-1800,pointer.y,{steps:12});
  await page.mouse.up();
  await page.waitForFunction(max => Math.abs(window.rebotDual.renderMetrics().camera.azimuth - max) < 1e-6,orbit.maxAzimuthAngle);
  const wallView = await cameraState();
  checkBounds(wallView);
  assert(Math.abs(wallView.position[1] - MODEL_VARIANTS.dual.view.maxCameraY) < 1e-6);
  assert(wallView.distance < orbit.maxDistance);
  await page.mouse.move(pointer.x,pointer.y);
  await page.mouse.wheel(0,10000);
  checkBounds(await cameraState());
  await page.screenshot({path:'.reports/visual-ui-wall-limit.png'});
  await page.locator('#dual-perspective').click();
  const cdp=await page.context().newCDPSession(page);
  const touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y],id)=>({x,y,id}))});
  await touch('touchStart',[[60,470],[140,470]]);await touch('touchMove',[[100,470],[180,470]]);await touch('touchEnd',[]);
  assert.deepEqual((await cameraState()).target,anchored.target);
  assert(Math.abs((await cameraState()).distance-anchored.distance)<1e-6);
  await touch('touchStart',[[60,470],[140,470]]);await touch('touchMove',[[10,470],[610,470]]);await touch('touchEnd',[]);
  checkBounds(await cameraState());assert((await cameraState()).distance<anchored.distance);await cdp.detach();
  await page.locator('#dual-perspective').click();checks.cameraBounds=true;
  console.log('UI: bounded mouse/touch orbit, fixed target, zoom limits and six view presets passed');
  await page.getByRole('button',{name:'收起任务卡片',exact:true}).click({force:true});
  assert.equal(await page.locator('#dual-task-details').isVisible(),false);
  await page.getByRole('button',{name:'展开任务卡片',exact:true}).click({force:true});
  assert.equal(await page.locator('#dual-task-details').isVisible(),true);checks.fold=true;
  console.log('UI: fold controls passed');
  const cameraBeforeStart=await cameraState();
  await page.locator('#dual-speed').selectOption('4');await page.locator('#dual-start').click({force:true});
  await page.waitForFunction(()=>{const s=window.rebotDual.state();return s.running||Boolean(s.error);},null,{timeout:observationTimeout});
  await page.waitForFunction(()=>{const s=window.rebotDual.state();return Boolean(s.error)||!s.cooperation.vision.waiting&&s.cooperation.phase==='approach';},null,{timeout:observationTimeout});
  const started=await page.evaluate(()=>window.rebotDual.state());
  assert.equal(started.error,'',JSON.stringify(started.cooperation.failure));
  await page.locator('#dual-task-details').waitFor({state:'hidden'});
  assert.equal(await page.locator('#dual-dock-toggle').isVisible(),false);
  assert.equal(await page.locator('#dual-pause').isVisible(),true);
  assert.equal(await page.locator('#dual-status').isVisible(),true);
  await page.screenshot({path:'.reports/visual-ui-active-task.png'});
  assert.equal(await page.locator('#dual-perspective').getAttribute('aria-pressed'),'true');
  checkCameraUnchanged(await cameraState(),cameraBeforeStart);
  await page.locator('#dual-pause').click({force:true});
  console.log('UI: task started and paused');
  const paused=await page.evaluate(()=>window.rebotDual.state().time);await page.waitForTimeout(600);
  assert.equal(await page.evaluate(()=>window.rebotDual.state().time),paused);checks.pause=true;
  assert.match(await page.locator('#dual-status').textContent(),/^已暂停 · /);
  assert.equal(await page.locator('#dual-task-details').isVisible(),false);
  await page.locator('#dual-pause').click({force:true});
  await page.waitForFunction(()=>{const s=window.rebotDual.state();return s.cooperation.complete||Boolean(s.error);},null,{timeout:taskTimeout});
  const final=await page.evaluate(()=>window.rebotDual.state());
  assert.equal(final.error,'',JSON.stringify(final.cooperation.failure));assert.equal(final.cooperation.complete,true);
  await page.locator('#dual-task-details').waitFor({state:'visible'});
  assert.equal(final.cooperation.controlMode,'visual-rgbd');assert(final.cooperation.vision.history.some(h=>h.stage==='settled-verification'));
  checks.final=final;checks.camerasAfter=await cameraPixels();
  assert.equal(final.cooperation.graspMode,'contact-only');
  checks.renderAfter=await page.evaluate(()=>window.rebotDual.renderMetrics());
  console.log('UI: visual cooperation passed',JSON.stringify(checks.renderAfter));
  assert(checks.camerasAfter.every((c,i)=>c.hash!==camerasBefore[i].hash));
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'.reports/visual-ui-desktop.png'});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(600);
  const mobile=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,viewButtons:[...document.querySelectorAll('.dual-view-switch button')].map(button=>{const r=button.getBoundingClientRect();return {id:button.id,accessible:button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};}),canvases:['overhead-camera-canvas','left-wrist-camera-canvas','right-wrist-camera-canvas'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})}));
  assert(mobile.scroll<=mobile.width);assert(mobile.canvases.every(c=>c.width>0&&c.x>=0&&c.x+c.width<=mobile.width+1));checks.mobile=mobile;
  assert.equal(mobile.viewButtons.length,6);assert(mobile.viewButtons.every(button=>button.accessible),'All six mobile view buttons must remain reachable above the camera monitors');
  await page.screenshot({path:'.reports/visual-ui-mobile.png'});
  await page.locator('#dual-reset').click();
  assert.equal(await page.evaluate(()=>window.rebotDual.state().cooperation.complete),false);checks.reset=true;
  await page.locator('#dual-task-select').selectOption('present-and-return');
  await page.locator('#dual-speed').selectOption('4');
  await page.locator('#dual-start').click({force:true});
  await page.waitForFunction(()=>{const state=window.rebotDual.state();return state.cooperation.complete||Boolean(state.error);},null,{timeout:taskTimeout});
  checks.returned=await page.evaluate(()=>window.rebotDual.state().cooperation);
  assert.equal(checks.returned.error,'',JSON.stringify(checks.returned.failure));assert.equal(checks.returned.complete,true);
  assert.equal(checks.returned.task,'present-and-return');assert.equal(checks.returned.inserted,false);
  assert(checks.returned.history.some(entry=>entry.phase==='return-objects'));
  assert(checks.returned.vision.history.some(entry=>entry.stage==='settled-verification'));
  await page.locator('#dual-reset').click();
  await page.locator('#dual-task-select').selectOption('coffee-feeding');
  assert.equal(await page.locator('#dual-grasp-mode').textContent(),'辅助夹持演示');
  assert.equal(await page.locator('#dual-layout-controls').isVisible(),false);
  await page.locator('#dual-close').click();
  const cameraBeforeCoffee=await cameraState();
  await page.locator('#dual-speed').selectOption('4');
  await page.locator('#dual-start').click({force:true});
  await page.waitForFunction(()=>{const state=window.rebotDual.state();return state.cooperation.complete||Boolean(state.error);},null,{timeout:taskTimeout});
  checks.coffee=await page.evaluate(()=>window.rebotDual.state().cooperation);
  assert.equal(checks.coffee.error,'',JSON.stringify(checks.coffee.failure));assert.equal(checks.coffee.complete,true);
  assert.equal(checks.coffee.task,'coffee-feeding');assert.equal(checks.coffee.graspMode,'assisted-weld');
  assert.equal(checks.coffee.coffeeFill,1);assert.equal(checks.coffee.fed,true);
  assert(checks.coffee.stirringTravel>.03);assert(checks.coffee.minimumMouthDistance<.015);
  assert.equal(await page.locator('#dual-close').getAttribute('aria-pressed'),'true');
  checkCameraUnchanged(await cameraState(),cameraBeforeCoffee);
  await page.screenshot({path:'.reports/visual-ui-coffee.png'});
  await page.locator('#dual-reset').click();
  assert.equal(await page.evaluate(()=>window.rebotDual.state().cooperation.coffeeFill || 0),0);
  await page.locator('#dual-task-select').selectOption('spoon-in-cup');
  await page.locator('#dual-mode-sort').click();assert.equal(await page.locator('#dual-grasp-mode').textContent(),'接触物理抓取');
  await page.locator('#dual-task-select').selectOption('egg');
  await page.locator('#dual-start').click({force:true});
  assert.equal(await page.locator('#dual-task-details').isVisible(),false);
  assert.match(await page.locator('#dual-status').textContent(),/左臂 · 鸡蛋 · .+/);
  await page.locator('#dual-reset').click();
  assert.equal(await page.locator('#dual-task-details').isVisible(),true);
  await page.locator('#dual-mode-coop').click();assert.match(await page.locator('#dual-grasp-mode').textContent(),/RGB-D/);checks.modeSwitch=true;
  assert.deepEqual(errors,[]);checks.errors=errors;
  console.log('Actual UI: two pure-contact Worker RGB-D tasks, assisted coffee/feeding task, three independent cameras, pause, fold, mobile, reset and mode switching passed');
} catch(error) {
  checks.failure={message:error.message};
  if(page&&!page.isClosed()) {
    checks.failure.runtime=await page.evaluate(()=>({state:window.rebotDual?.state(),render:window.rebotDual?.renderMetrics(),status:document.getElementById('dual-status')?.textContent})).catch(cause=>({error:cause.message}));
  }
  console.error('UI failure snapshot',JSON.stringify(checks.failure));
  throw error;
} finally {await writeFile(`.reports/${externalUrl?'visual-ui-production':'visual-ui'}.json`,JSON.stringify({url:externalUrl||'development',checks,errors},null,2));await browser.close();await server?.close();}

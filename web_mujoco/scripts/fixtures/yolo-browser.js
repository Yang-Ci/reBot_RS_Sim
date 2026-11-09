import { observeYoloGrasp } from '../../src/yolo-grasp.js';
try {
const image=new Image(); image.src='./yolo-browser-frame.png'; await image.decode();
const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
const source=ctx.getImageData(0,0,640,480).data, rgb=new Uint8Array(source.length), depth=new Float32Array(640*480);
const fx=240/Math.tan(35*Math.PI/180), camera={fx,fy:fx,cx:319.5,cy:239.5,matrixWorld:[1,0,0,0,0,1,0,0,0,0,1,0,.34,0,.78,1]};
for(let row=0;row<480;row++)for(let col=0;col<640;col++){
 const i=row*640+col, screen=((479-row)*640+col)*4;rgb.set(source.subarray(screen,screen+4),i*4);
 let d=.68;
 for(const o of [{x:.24,y:-.3,z:.145,a:.0225,b:.0225},{x:.34,y:.06,z:.138,a:.026,b:.016},{x:.33,y:-.2,z:.152,a:.020,b:.020,round:true}]) {
  const distance=.78-o.z, x=.34+(col-319.5)*distance/fx, y=(row-239.5)*distance/fx;
  if(o.round ? Math.hypot(x-o.x,y-o.y)<o.a : Math.abs(x-o.x)<o.a&&Math.abs(y-o.y)<o.b) d=distance;
 }
 depth[i]=d;
}
const frame={width:640,height:480,rgb,depth,camera,timestamp:1};
const view={captureCamera:async()=>frame};
const results={};
for(const id of ['red','blue','yellow'])results[id]=await observeYoloGrasp(view,id,new AbortController().signal);
depth.fill(.68);
results.flatMarker = await observeYoloGrasp(view, 'red', new AbortController().signal);
document.querySelector('#status').textContent=JSON.stringify(results);
} catch(e) { document.querySelector('#status').textContent='ERROR '+e.stack; }

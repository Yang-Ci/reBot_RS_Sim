import * as THREE from 'three';

// This is a sensor boundary: only rasterized colour/depth and camera calibration
// leave the renderer. No body names, segmentation IDs or object poses are sent.
export function createCameraSampler(renderer, scene,{prepareScene}={}) {
  const targets = new Map();
  const statistics={captures:0,totalMs:0,maxMs:0,cpuMs:0,maxCpuMs:0};
  let queue=Promise.resolve(),pendingCaptures=0,disposed=false;
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, blending: THREE.NoBlending });
  depthMaterial.toneMapped = false;
  const clearColour = new THREE.Color();
  function buffers(width, height) {
    const key = `${width}x${height}`;
    if (!targets.has(key)) {
      const colour = new THREE.WebGLRenderTarget(width, height, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      colour.texture.colorSpace = THREE.SRGBColorSpace;
      const depth = new THREE.WebGLRenderTarget(width, height, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      targets.set(key, { colour, depth, rgb: new Uint8Array(width * height * 4), packed: new Uint8Array(width * height * 4) });
    }
    return targets.get(key);
  }
  function capture(camera, { width = 960, height = 720, timestamp = 0, withDepth = true, zoom = 1, asyncReadback = false } = {}) {
    if(disposed)throw new Error('Camera sampler disposed');
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 2048 * 2048) throw new RangeError('Invalid camera resolution');
    const began = performance.now(), buffer = buffers(width, height);
    const sensorCamera = camera.clone();
    sensorCamera.aspect = width / height; sensorCamera.zoom = zoom; sensorCamera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    sensorCamera.matrix.copy(camera.matrix); sensorCamera.matrixWorld.copy(camera.matrixWorld);
    sensorCamera.matrixWorldInverse.copy(camera.matrixWorldInverse);
    const original = { target: renderer.getRenderTarget(), shadows: renderer.shadowMap.enabled,
      override: scene.overrideMaterial, background: scene.background, alpha: renderer.getClearAlpha(), toneMapping: renderer.toneMapping };
    renderer.getClearColor(clearColour);
    const reads=[];
    let submittedMs=0;
    function read(target,destination) {
      if(!asyncReadback)renderer.readRenderTargetPixels(target,0,0,width,height,destination);
      else {
        const gl=renderer.getContext();
        // Three r170 leaves PIXEL_PACK_BUFFER bound during/after its async
        // read. Unbind it so subsequent rendering and synchronous reads work.
        reads.push(renderer.readRenderTargetPixelsAsync(target,0,0,width,height,destination)
          .finally(()=>gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null)));
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
      }
    }
    function finish() {
      const conversionBegan=performance.now();
      let depth=null;
      if(withDepth) {
        depth=new Float32Array(width*height);
        const near=sensorCamera.near,far=sensorCamera.far;
        for(let i=0;i<depth.length;i++) {
          const p=i*4,bytes=buffer.packed;
          // Inverse of Three r170's packing.glsl.js / packDepthToRGBA.
          const d=(bytes[p]+(bytes[p+1]+(bytes[p+2]+bytes[p+3]/255)/256)/256)/256;
          depth[i]=d<.9999999?near*far/(far-(far-near)*d):Infinity;
        }
      }
      const renderMs=performance.now()-began,cpuMs=submittedMs+performance.now()-conversionBegan;
      statistics.captures++;statistics.totalMs+=renderMs;statistics.maxMs=Math.max(statistics.maxMs,renderMs);
      statistics.cpuMs+=cpuMs;statistics.maxCpuMs=Math.max(statistics.maxCpuMs,cpuMs);
      return {source:'rendered-rgbd',origin:'bottom-left',width,height,timestamp,
        rgb:withDepth||asyncReadback?buffer.rgb.slice():buffer.rgb,depth,
        camera:{matrixWorld:sensorCamera.matrixWorld.toArray(),
          fx:sensorCamera.projectionMatrix.elements[0]*width/2,fy:sensorCamera.projectionMatrix.elements[5]*height/2,
          cx:width/2-.5,cy:height/2-.5,near:sensorCamera.near,far:sensorCamera.far},renderMs,cpuMs};
    }
    try {
      prepareScene?.(sensorCamera,height);
      renderer.shadowMap.enabled = false;
      renderer.setRenderTarget(buffer.colour); renderer.render(scene, sensorCamera);
      read(buffer.colour,buffer.rgb);
      if (withDepth) {
        // Override materials make the transparent IK control aid opaque.
        const hiddenHelpers = [];
        scene.traverse(object => {
          if (object.visible && object.userData.bodyName === 'ik_target') {
            hiddenHelpers.push(object);
            object.visible = false;
          }
        });
        scene.overrideMaterial = depthMaterial; scene.background = null;
        renderer.toneMapping = THREE.NoToneMapping; renderer.setClearColor(0xffffff, 1);
        try {
          renderer.setRenderTarget(buffer.depth); renderer.render(scene, sensorCamera);
          read(buffer.depth,buffer.packed);
        } finally {
          hiddenHelpers.forEach(object => { object.visible = true; });
        }
      }
      submittedMs=performance.now()-began;
      return asyncReadback?Promise.all(reads).then(finish):finish();
    } finally {
      scene.overrideMaterial = original.override; scene.background = original.background;
      renderer.toneMapping = original.toneMapping; renderer.shadowMap.enabled = original.shadows;
      renderer.setClearColor(clearColour, original.alpha); renderer.setRenderTarget(original.target);
    }
  }
  return {capture,
    captureAsync(camera,options={}) {
      pendingCaptures++;
      const result=queue.then(()=>capture(camera, {...options,asyncReadback:true}));
      queue=result.catch(()=>{});
      return result.finally(()=>{pendingCaptures--;});
    },
    get busy() {return pendingCaptures>0;},
    statistics() {return {...statistics,pendingCaptures,renderTargets:targets.size*2,pixelBufferBytes:[...targets.values()].reduce((sum,b)=>sum+b.rgb.byteLength+b.packed.byteLength,0)};},
    dispose() {disposed=true;for(const buffer of targets.values()){buffer.colour.dispose();buffer.depth.dispose();}targets.clear();depthMaterial.dispose();}
  };
}

export function paintCameraFrame(context, frame, imageData = context.createImageData(frame.width, frame.height)) {
  const stride = frame.width * 4;
  for (let row = 0; row < frame.height; row++) imageData.data.set(frame.rgb.subarray(row * stride, (row + 1) * stride), (frame.height - 1 - row) * stride);
  context.putImageData(imageData, 0, 0);
  return imageData;
}

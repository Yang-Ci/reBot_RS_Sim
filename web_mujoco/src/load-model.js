import {fetchModelResource, abortable} from './model-download.js';
import {parseIncludesAndMeshes,extractMaterialProps} from './model-source.js';
import {createModelFileStore} from './model-file-store.js';
import {unpackStl} from './stl-transfer.js';
import { compileRemoteWasm,initializeCompiledWasm } from './wasm-loader.js';

const MODEL_DIR = `${import.meta.env.BASE_URL}models`;
const DEFAULT_SCENE_XML = 'rs_grasp_scene.xml';
const DOWNLOAD_CONCURRENCY = 6;
const MAX_BUFFERED_MESH_BYTES = 16 * 1024 * 1024;
const MODEL_VERSIONS = typeof __MODEL_VERSIONS__ === 'undefined' ? {} : __MODEL_VERSIONS__;
const PACKED_MESH_FILES = typeof __PACKED_MESH_FILES__ === 'undefined' ? {} : __PACKED_MESH_FILES__;
const USE_PACKED_MESHES = new URLSearchParams(globalThis.location?.search||'').get('meshTransfer')!=='gzip';
const SUPPORTS_GZIP_STREAM = typeof DecompressionStream === 'function';
const MUJOCO_CDN_BASE =
  typeof __MUJOCO_VERSION__ !== 'undefined'
    ? `https://cdn.jsdelivr.net/npm/@mujoco/mujoco@${__MUJOCO_VERSION__}/`
    : 'https://cdn.jsdelivr.net/npm/@mujoco/mujoco@3.12.0/';

function shouldLoadWasmFromCdn() {
  if (import.meta.env.DEV) return false;
  return import.meta.env.VITE_MUJOCO_WASM_CDN !== 'local';
}

function isMeshFile(relative) {
  return /\.(?:stl|obj|msh)$/i.test(relative);
}

function modelUrl(relative, compressed = false, packed = false) {
  const version = import.meta.env.DEV ? '' : `?v=${MODEL_VERSIONS[relative] || 'dev'}`;
  return `${MODEL_DIR}/${relative}${packed ? '.stlp1.gzbin' : compressed ? '.gzbin' : ''}${version}`;
}

export async function loadMujocoModule() {
  const loaderReady = import('@mujoco/mujoco');
  if (!shouldLoadWasmFromCdn()) {
    const { default: loadMujoco } = await loaderReady;
    return loadMujoco();
  }
  const cdnWasmUrl = `${MUJOCO_CDN_BASE}mujoco.wasm`;
  // Download/compile alongside the JS loader, without a preliminary HEAD.
  // Resolve failures immediately to avoid an unhandled rejection while importing.
  const compiledReady = compileRemoteWasm(cdnWasmUrl).then(
    (module) => ({ module }),
    (error) => ({ error })
  );
  const { default: loadMujoco } = await loaderReady;
  try {
    const compiled = await compiledReady;
    if (compiled.error) throw compiled.error;
    return await initializeCompiledWasm(loadMujoco,compiled.module);
  } catch (error) {
    console.warn(`MuJoCo WASM CDN 不可用，回退本地资源：${error?.message || error}`);
    return loadMujoco();
  }
}

async function decompressGzip(bytes) {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function fetchModelBytes(relative, onChunk, options) {
  const compressed = SUPPORTS_GZIP_STREAM && isMeshFile(relative);
  if(compressed&&!import.meta.env.DEV&&USE_PACKED_MESHES&&PACKED_MESH_FILES[relative]) {
    try {
      const packed=await fetchModelResource(modelUrl(relative,true,true), {...options, onProgress:onChunk});
      return {bytes:unpackStl(await decompressGzip(packed)),transferred:packed.byteLength};
    } catch(error) {options.signal.throwIfAborted();console.warn(`紧凑模型读取失败，回退 gzip 资源：${relative}`,error);}
  }
  if (compressed) {
    try {
      const packed = await fetchModelResource(modelUrl(relative, true), {...options, onProgress:onChunk});
      return { bytes: await decompressGzip(packed), transferred: packed.byteLength };
    } catch (error) {
      options.signal.throwIfAborted();
      console.warn(`压缩模型读取失败，回退原始资源：${relative}`, error);
    }
  }
  const bytes = await fetchModelResource(modelUrl(relative), {...options, onProgress:onChunk});
  return { bytes, transferred: bytes.byteLength };
}

function report(onProgress, key, vars = {}) {
  onProgress?.({ key, vars });
}

export async function loadRsScene(
  mujoco,
  onProgress,
  { signal: externalSignal, downloadOptions = {}, sceneXml = DEFAULT_SCENE_XML, fileBackend = new URLSearchParams(globalThis.location?.search||'').get('modelFiles')==='vfs'?'vfs':'auto' } = {}
) {
  const downloadsController = new AbortController();
  const signal = downloadsController.signal;
  const cancel = () => downloadsController.abort(externalSignal.reason);
  externalSignal?.addEventListener('abort', cancel, { once: true });
  const options = {...downloadOptions, signal};
  const began=performance.now(),startup={format:'xml'};
  // Keep the comparatively expensive WASM startup and model downloads in
  // flight together. Before WASM is ready, buffer at most 16 MiB plus the
  // in-flight requests; afterwards copy meshes into the native file store.
  let runtimeReady = false;
  const mujocoReady = Promise.resolve(mujoco).then(
    (value) => {
      startup.runtimeReadyMs=performance.now()-began;
      runtimeReady = true;
      return { value };
    },
    (error) => ({ error })
  );
  const xmlQueue = [sceneXml];
  const seen = new Set();
  const meshFiles = new Set();
  const files = {};
  let loadedBytes = 0;
  let transferredBytes = 0;
  let fileStore = null;
  const bufferedMeshes = new Map();
  let bufferedBytes = 0;

  async function requireRuntime() {
    const runtime = await abortable(mujocoReady, signal);
    signal.throwIfAborted();
    if (runtime.error) throw runtime.error;
    if (!fileStore) fileStore = createModelFileStore(runtime.value,{backend:fileBackend});
    for (const [name, bytes] of bufferedMeshes) fileStore.add(name, bytes);
    bufferedMeshes.clear();
    bufferedBytes = 0;
    return runtime.value;
  }

  try {
    externalSignal?.throwIfAborted();
    // Resolve the small XML dependency graph first so every mesh is known
    // before starting the parallel download pool.
    while (xmlQueue.length) {
      const relative = xmlQueue.shift();
      if (seen.has(relative)) continue;
      seen.add(relative);
      report(onProgress, 'status.download', { file: relative });
      const { bytes, transferred } = await fetchModelBytes(relative, (received, total) => {
        const mb = total ? `${(received / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB` : '';
        report(onProgress, 'status.downloadProgress', { file: relative, mb });
      }, options);
      files[relative] = bytes;
      loadedBytes += bytes.byteLength;
      transferredBytes += transferred;

      const xml = new TextDecoder().decode(bytes);
      for (const extra of parseIncludesAndMeshes(xml)) {
        if (extra.toLowerCase().endsWith('.xml')) {
          if (!seen.has(extra)) xmlQueue.push(extra);
        } else {
          meshFiles.add(extra);
        }
      }
    }

    const pending = [...meshFiles].filter((relative) => !seen.has(relative));
    const totalAssets = seen.size + pending.length;
    let completedAssets = seen.size;
    const activeBytes = new Map();
    let lastProgressAt = 0;

    function reportAssetProgress(force = false) {
      const now = Date.now();
      if (!force && now - lastProgressAt < 80) return;
      lastProgressAt = now;
      const inFlightBytes = [...activeBytes.values()].reduce((sum, value) => sum + value, 0);
      report(onProgress, 'status.loadingAssets', {
        done: completedAssets,
        total: totalAssets,
        mb: ((transferredBytes + inFlightBytes) / 1048576).toFixed(1)
      });
    }

    let nextIndex = 0;
    async function downloadWorker() {
      while (nextIndex < pending.length) {
        const relative = pending[nextIndex];
        nextIndex += 1;
        seen.add(relative);
        activeBytes.set(relative, 0);
        reportAssetProgress(true);
        const { bytes, transferred } = await fetchModelBytes(relative, (received) => {
          activeBytes.set(relative, received);
          reportAssetProgress();
        }, options);
        activeBytes.delete(relative);
        if (runtimeReady) {
          await requireRuntime();
          fileStore.add(relative, bytes);
        } else {
          bufferedMeshes.set(relative, bytes);
          bufferedBytes += bytes.byteLength;
          if (bufferedBytes >= MAX_BUFFERED_MESH_BYTES) await requireRuntime();
        }
        loadedBytes += bytes.byteLength;
        transferredBytes += transferred;
        completedAssets += 1;
        reportAssetProgress(true);
      }
    }

    const workerCount = Math.min(DOWNLOAD_CONCURRENCY, pending.length);
    // Let in-flight workers finish before deleting their shared files on error.
    const downloads = await Promise.allSettled(Array.from({ length: workerCount }, () => downloadWorker().catch(error => {
      downloadsController.abort(error);
      throw error;
    })));
    const failed = downloads.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
    startup.assetsReadyMs=performance.now()-began;

    report(onProgress, 'status.preparingRuntime');
    const resolvedMujoco = await requireRuntime();
    Object.entries(files).forEach(([name, bytes]) => fileStore.add(name, bytes));
    const materialProps = extractMaterialProps(files, sceneXml);
    report(onProgress, 'status.compiling', { mb: (loadedBytes / 1048576).toFixed(1) });
    const compileBegan=performance.now();
    const model = fileStore.load(sceneXml);
    startup.compileMs=performance.now()-compileBegan;
    const dataBegan=performance.now();
    const data = new resolvedMujoco.MjData(model);
    resolvedMujoco.mj_forward(model, data);
    startup.dataMs=performance.now()-dataBegan;startup.totalMs=performance.now()-began;
    startup.loadedBytes=loadedBytes;startup.transferredBytes=transferredBytes;
    startup.fileBackend=fileStore.statistics.backend;startup.fileWriteMs=fileStore.statistics.writeMs;
    return { mujoco: resolvedMujoco, model, data, loadedBytes, files: [...seen], materialProps,startup };
  } finally {
    externalSignal?.removeEventListener('abort', cancel);
    downloadsController.abort();
    bufferedMeshes.clear();
    fileStore?.dispose();
  }
}

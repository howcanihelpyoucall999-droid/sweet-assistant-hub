import { ModelProgress } from './types';

const DB_NAME = 'PassportAIPhotoMakerDB';
const STORE_NAME = 'models';
const DB_VERSION = 1;

// Initialize IndexedDB
function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

async function getModelFromCache(name: string): Promise<ArrayBuffer | null> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(name);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result || null);
    });
  } catch (err) {
    console.warn('Error reading from IndexedDB cache:', err);
    return null;
  }
}

async function saveModelToCache(name: string, data: ArrayBuffer): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(data, name);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve();
    });
  } catch (err) {
    console.warn('Error saving to IndexedDB cache:', err);
  }
}

function downloadWithProgress(
  url: string,
  onProgress: (loaded: number, total: number) => void
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';

    xhr.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded, event.total);
      } else {
        onProgress(event.loaded, Math.max(event.loaded, 44_000_000));
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) resolve(xhr.response);
      else reject(new Error(`Failed to download model. Status ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Network error during model download.'));
    xhr.send();
  });
}

// ISNet (RMBG-1.4) — a compact, fast IS-Net background matting model.
// Quantized to ~44MB and runs a single forward pass in ~1-3s on WASM.
export const MODEL_URLS = {
  isnet: 'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_quantized.onnx',
};

const ISNET_INPUT_SIZE = 1024;

let isnetSession: any = null;

export async function loadModels(
  onProgressUpdate: (progress: Record<string, ModelProgress>) => void
): Promise<void> {
  const progress: Record<string, ModelProgress> = {
    isnet: { name: 'AI Model', loaded: 0, total: 44_000_000, status: 'idle' },
  };
  onProgressUpdate({ ...progress });

  const ort = (window as any).ort;
  if (!ort) throw new Error('ONNX Runtime Web is not loaded.');

  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.0/dist/';
  ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 4, 4);
  try { ort.env.wasm.simd = true; } catch {}

  progress.isnet.status = 'downloading';
  onProgressUpdate({ ...progress });

  let modelBuffer = await getModelFromCache('isnet');
  if (!modelBuffer) {
    modelBuffer = await downloadWithProgress(MODEL_URLS.isnet, (loaded, total) => {
      progress.isnet.loaded = loaded;
      progress.isnet.total = total;
      onProgressUpdate({ ...progress });
    });
    await saveModelToCache('isnet', modelBuffer);
  } else {
    progress.isnet.loaded = progress.isnet.total;
    onProgressUpdate({ ...progress });
  }

  progress.isnet.status = 'compiling';
  onProgressUpdate({ ...progress });

  isnetSession = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });

  progress.isnet.status = 'ready';
  onProgressUpdate({ ...progress });
}

function getTensorDims(tensor: any, defaultH: number, defaultW: number): { h: number; w: number } {
  try {
    const d = tensor?.dims;
    if (d && d.length >= 2) {
      const h = d[d.length - 2];
      const w = d[d.length - 1];
      if (h > 0 && w > 0) return { h, w };
    }
  } catch {}
  return { h: defaultH, w: defaultW };
}

// Edge feathering / hole-fill for a clean alpha edge
function refineAlphaMask(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  try {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.filter = 'blur(1px)';
    tempCtx.drawImage(ctx.canvas, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.filter = 'none';
    ctx.drawImage(tempCanvas, 0, 0);
  } catch {}
}

// Core background-removal pipeline using ISNet (single forward pass)
export async function removeBackground(
  imageElement: HTMLImageElement,
  onStageUpdate: (stage: string) => void
): Promise<HTMLCanvasElement> {
  const ort = (window as any).ort;
  if (!ort || !isnetSession) throw new Error('Model is not initialized.');

  onStageUpdate('Preparing image...');

  const rawWidth = imageElement.naturalWidth || 1024;
  const rawHeight = imageElement.naturalHeight || 1024;

  // Keep output at up to 1600px so results stay crisp but fast
  const MAX_DIMENSION = 1600;
  let originalWidth = rawWidth;
  let originalHeight = rawHeight;
  if (rawWidth > MAX_DIMENSION || rawHeight > MAX_DIMENSION) {
    if (rawWidth > rawHeight) {
      originalWidth = MAX_DIMENSION;
      originalHeight = Math.round((rawHeight * MAX_DIMENSION) / rawWidth);
    } else {
      originalHeight = MAX_DIMENSION;
      originalWidth = Math.round((rawWidth * MAX_DIMENSION) / rawHeight);
    }
  }

  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = originalWidth;
  baseCanvas.height = originalHeight;
  const baseCtx = baseCanvas.getContext('2d')!;
  baseCtx.imageSmoothingEnabled = true;
  baseCtx.imageSmoothingQuality = 'high';
  baseCtx.drawImage(imageElement, 0, 0, originalWidth, originalHeight);

  // Resize to model input (1024x1024)
  const inputCanvas = document.createElement('canvas');
  inputCanvas.width = ISNET_INPUT_SIZE;
  inputCanvas.height = ISNET_INPUT_SIZE;
  const inputCtx = inputCanvas.getContext('2d')!;
  inputCtx.imageSmoothingEnabled = true;
  inputCtx.imageSmoothingQuality = 'high';
  inputCtx.drawImage(baseCanvas, 0, 0, ISNET_INPUT_SIZE, ISNET_INPUT_SIZE);

  // Prepare NCHW float32 tensor, normalized (x/255 - 0.5) / 1.0
  const imgData = inputCtx.getImageData(0, 0, ISNET_INPUT_SIZE, ISNET_INPUT_SIZE).data;
  const total = ISNET_INPUT_SIZE * ISNET_INPUT_SIZE;
  const inputData = new Float32Array(total * 3);
  for (let i = 0; i < total; i++) {
    inputData[i]              = imgData[i * 4]     / 255 - 0.5;
    inputData[total + i]      = imgData[i * 4 + 1] / 255 - 0.5;
    inputData[total * 2 + i]  = imgData[i * 4 + 2] / 255 - 0.5;
  }

  onStageUpdate('Removing background...');
  const inputTensor = new ort.Tensor('float32', inputData, [1, 3, ISNET_INPUT_SIZE, ISNET_INPUT_SIZE]);
  const inputName = isnetSession.inputNames[0];
  const outputName = isnetSession.outputNames[0];
  const outputs = await isnetSession.run({ [inputName]: inputTensor });
  const maskTensor = outputs[outputName];
  const maskData = maskTensor.data as Float32Array;
  const { h: outH, w: outW } = getTensorDims(maskTensor, ISNET_INPUT_SIZE, ISNET_INPUT_SIZE);

  // Normalize mask to [0,1]
  let mn = maskData[0], mx = maskData[0];
  for (let i = 1; i < maskData.length; i++) {
    const v = maskData[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const range = mx - mn || 1;

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = outW;
  maskCanvas.height = outH;
  const maskCtx = maskCanvas.getContext('2d')!;
  const maskImg = maskCtx.createImageData(outW, outH);
  for (let i = 0; i < maskData.length; i++) {
    let v = (maskData[i] - mn) / range;
    // Slight contrast to firm up subject edges
    v = Math.max(0, Math.min(1, (v - 0.04) * 1.1));
    const a = Math.floor(v * 255);
    maskImg.data[i * 4] = 255;
    maskImg.data[i * 4 + 1] = 255;
    maskImg.data[i * 4 + 2] = 255;
    maskImg.data[i * 4 + 3] = a;
  }
  maskCtx.putImageData(maskImg, 0, 0);
  refineAlphaMask(maskCtx, outW, outH);

  // Upscale mask to full res via hardware-accelerated canvas
  const fullMaskCanvas = document.createElement('canvas');
  fullMaskCanvas.width = originalWidth;
  fullMaskCanvas.height = originalHeight;
  const fullMaskCtx = fullMaskCanvas.getContext('2d')!;
  fullMaskCtx.imageSmoothingEnabled = true;
  fullMaskCtx.imageSmoothingQuality = 'high';
  fullMaskCtx.drawImage(maskCanvas, 0, 0, originalWidth, originalHeight);

  // Composite: original image masked by alpha
  const outCanvas = document.createElement('canvas');
  outCanvas.width = originalWidth;
  outCanvas.height = originalHeight;
  const outCtx = outCanvas.getContext('2d')!;
  outCtx.drawImage(baseCanvas, 0, 0);
  outCtx.globalCompositeOperation = 'destination-in';
  outCtx.drawImage(fullMaskCanvas, 0, 0);
  outCtx.globalCompositeOperation = 'source-over';

  onStageUpdate('Completed');
  return outCanvas;
}

// Bounding-box detection on alpha channel to auto-center subject
export function detectSubjectBoundingBox(canvas: HTMLCanvasElement): { minX: number; minY: number; maxX: number; maxY: number } {
  const originalWidth = canvas.width;
  const originalHeight = canvas.height;
  const scanSize = 128;
  const scaleX = originalWidth / scanSize;
  const scaleY = originalHeight / scanSize;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = scanSize;
  tempCanvas.height = scanSize;
  const tempCtx = tempCanvas.getContext('2d')!;
  tempCtx.drawImage(canvas, 0, 0, scanSize, scanSize);
  const data = tempCtx.getImageData(0, 0, scanSize, scanSize).data;

  let minX = scanSize, maxX = 0, minY = scanSize, maxY = 0, found = false;
  for (let y = 0; y < scanSize; y++) {
    for (let x = 0; x < scanSize; x++) {
      const alpha = data[(y * scanSize + x) * 4 + 3];
      if (alpha > 30) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }
  if (!found) return { minX: 0, minY: 0, maxX: originalWidth, maxY: originalHeight };

  const origMinX = minX * scaleX;
  const origMaxX = maxX * scaleX;
  const origMinY = minY * scaleY;
  const origMaxY = maxY * scaleY;
  const paddingX = (origMaxX - origMinX) * 0.05;
  const paddingY = (origMaxY - origMinY) * 0.05;
  return {
    minX: Math.max(0, Math.floor(origMinX - paddingX)),
    minY: Math.max(0, Math.floor(origMinY - paddingY)),
    maxX: Math.min(originalWidth, Math.ceil(origMaxX + paddingX)),
    maxY: Math.min(originalHeight, Math.ceil(origMaxY + paddingY)),
  };
}

export function checkCanvasHasAlpha(canvas: HTMLCanvasElement): boolean {
  try {
    const ctx = canvas.getContext('2d')!;
    const w = Math.min(canvas.width, 100);
    const h = Math.min(canvas.height, 100);
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  } catch {}
  return false;
}

// High-fidelity local upscaler (unsharp mask) — used by the editor's "AI Enhance".
// The heavy RealESRGAN model is no longer preloaded to keep startup small and fast;
// this fallback is fast, mobile-friendly, and produces a crisp result.
export async function enhanceImageWithRealESRGAN(
  inputCanvas: HTMLCanvasElement,
  onProgress: (stage: string) => void
): Promise<HTMLCanvasElement> {
  const originalWidth = inputCanvas.width;
  const originalHeight = inputCanvas.height;

  onProgress('Enhancing details...');
  await new Promise((r) => setTimeout(r, 40));

  const fallbackW = originalWidth * 2;
  const fallbackH = originalHeight * 2;
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = fallbackW;
  finalCanvas.height = fallbackH;
  const finalCtx = finalCanvas.getContext('2d')!;
  finalCtx.imageSmoothingEnabled = true;
  finalCtx.imageSmoothingQuality = 'high';
  finalCtx.drawImage(inputCanvas, 0, 0, fallbackW, fallbackH);

  try {
    const imgData = finalCtx.getImageData(0, 0, fallbackW, fallbackH);
    const width = imgData.width;
    const height = imgData.height;
    const src = imgData.data;
    const output = new Uint8ClampedArray(src.length);
    output.set(src);

    const w1 = -0.3;
    const w2 = 2.2;
    for (let y = 1; y < height - 1; y++) {
      const rowOffset = y * width;
      const prevRowOffset = (y - 1) * width;
      const nextRowOffset = (y + 1) * width;
      for (let x = 1; x < width - 1; x++) {
        const idx = (rowOffset + x) * 4;
        if (src[idx + 3] === 0) continue;
        const leftIdx  = (rowOffset + x - 1) * 4;
        const rightIdx = (rowOffset + x + 1) * 4;
        const topIdx   = (prevRowOffset + x) * 4;
        const bottomIdx= (nextRowOffset + x) * 4;
        const r = src[idx]     * w2 + (src[leftIdx]     + src[rightIdx]     + src[topIdx]     + src[bottomIdx])     * w1;
        const g = src[idx + 1] * w2 + (src[leftIdx + 1] + src[rightIdx + 1] + src[topIdx + 1] + src[bottomIdx + 1]) * w1;
        const b = src[idx + 2] * w2 + (src[leftIdx + 2] + src[rightIdx + 2] + src[topIdx + 2] + src[bottomIdx + 2]) * w1;
        output[idx]     = r < 0 ? 0 : (r > 255 ? 255 : r);
        output[idx + 1] = g < 0 ? 0 : (g > 255 ? 255 : g);
        output[idx + 2] = b < 0 ? 0 : (b > 255 ? 255 : b);
      }
    }
    finalCtx.putImageData(new ImageData(output, width, height), 0, 0);
  } catch (err) {
    console.warn('Detail enhancement failed:', err);
  }

  onProgress('Completed');
  return finalCanvas;
}

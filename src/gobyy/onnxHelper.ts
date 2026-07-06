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

// Retrieve model ArrayBuffer from cache
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

// Save model ArrayBuffer to cache
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

// Download file with progress tracking
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
        // Fallback or estimated total sizes
        let estimatedTotal = 25000000; // ~25MB default estimate
        if (url.includes('snap_matting')) estimatedTotal = 2500000; // ~2.5MB
        if (url.includes('snap_refiner')) estimatedTotal = 5500000; // ~5.5MB
        if (url.includes('realesrgan')) estimatedTotal = 67000000; // ~67MB
        onProgress(event.loaded, Math.max(event.loaded, estimatedTotal));
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        resolve(xhr.response);
      } else {
        reject(new Error(`Failed to download model. Status code: ${xhr.status}`));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error during model download.'));
    };

    xhr.send();
  });
}

// URLs of the models
export const MODEL_URLS = {
  depth: 'https://huggingface.co/Dops7/Goby/resolve/main/depth_anything_v2_vits_slim.onnx',
  matting: 'https://huggingface.co/Dops7/Goby/resolve/main/snap_matting_0.1.0.onnx',
  refiner: 'https://huggingface.co/Dops7/Goby/resolve/main/snap_refiner_0.1.0.onnx',
  realesrgan: 'https://huggingface.co/amd/ryzenai-realesrgan/resolve/main/onnx-models/realesrgan_nchw_1024x1024_fp32.onnx'
};

// Global session references
let depthSession: any = null;
let mattingSession: any = null;
let refinerSession: any = null;
let realesrganSession: any = null;

// Initialize ONNX Sessions (Cache-first)
export async function loadModels(
  onProgressUpdate: (progress: Record<string, ModelProgress>) => void
): Promise<void> {
  const keys = ['depth', 'matting', 'refiner', 'realesrgan'] as const;
  const progress: Record<string, ModelProgress> = {
    depth: { name: 'Depth Model (~25MB)', loaded: 0, total: 25000000, status: 'idle' },
    matting: { name: 'Matting Model (~2.4MB)', loaded: 0, total: 2400000, status: 'idle' },
    refiner: { name: 'Refiner Model (~5.3MB)', loaded: 0, total: 5300000, status: 'idle' },
    realesrgan: { name: 'Super Resolution Enhancer (~67.1MB)', loaded: 0, total: 67100000, status: 'idle' }
  };

  onProgressUpdate({ ...progress });

  const ort = (window as any).ort;
  if (!ort) {
    throw new Error('ONNX Runtime Web is not loaded. Check script tag.');
  }

  // Set WASM paths to CDN for flawless WASM support without bundler configuration
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.0/dist/';
  ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 4, 4);

  for (const key of keys) {
    const url = MODEL_URLS[key];
    progress[key].status = 'downloading';
    onProgressUpdate({ ...progress });

    let modelBuffer = await getModelFromCache(key);

    if (!modelBuffer) {
      try {
        modelBuffer = await downloadWithProgress(url, (loaded, total) => {
          progress[key].loaded = loaded;
          progress[key].total = total;
          onProgressUpdate({ ...progress });
        });
        await saveModelToCache(key, modelBuffer);
      } catch (err) {
        progress[key].status = 'error';
        onProgressUpdate({ ...progress });
        throw err;
      }
    } else {
      progress[key].loaded = progress[key].total;
      onProgressUpdate({ ...progress });
    }

    progress[key].status = 'compiling';
    onProgressUpdate({ ...progress });

    try {
      const session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm']
      });

      if (key === 'depth') depthSession = session;
      else if (key === 'matting') mattingSession = session;
      else if (key === 'refiner') refinerSession = session;
      else if (key === 'realesrgan') realesrganSession = session;

      progress[key].status = 'ready';
      onProgressUpdate({ ...progress });
    } catch (err) {
      console.error(`Error loading session for ${key}:`, err);
      progress[key].status = 'error';
      onProgressUpdate({ ...progress });
      throw err;
    }
  }
}

// Preprocess helper to convert canvas to Float32 Tensor [1, 3, H, W] in CHW order with ImageNet normalization
function preprocessForDepth(ctx: CanvasRenderingContext2D, width: number, height: number): Float32Array {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  
  const totalPixels = width * height;
  const inputData = new Float32Array(totalPixels * 3);

  // ImageNet stats
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];

  for (let i = 0; i < totalPixels; i++) {
    const r = data[i * 4] / 255.0;
    const g = data[i * 4 + 1] / 255.0;
    const b = data[i * 4 + 2] / 255.0;

    // Normalization & CHW packaging
    inputData[i] = (r - mean[0]) / std[0]; // R channel
    inputData[totalPixels + i] = (g - mean[1]) / std[1]; // G channel
    inputData[totalPixels * 2 + i] = (b - mean[2]) / std[2]; // B channel
  }

  return inputData;
}

// Simple normalization helper
function getMinMax(arr: Float32Array): { min: number; max: number } {
  let min = arr[0];
  let max = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < min) min = arr[i];
    if (arr[i] > max) max = arr[i];
  }
  return { min, max };
}

// Helper to get session input dimensions safely
function getSessionInputDims(session: any, defaultH: number, defaultW: number): { h: number; w: number } {
  try {
    if (session && session.inputs && session.inputs.length > 0) {
      const dims = session.inputs[0].dims;
      if (dims && dims.length >= 4) {
        const h = dims[2] > 0 ? dims[2] : defaultH;
        const w = dims[3] > 0 ? dims[3] : defaultW;
        return { h, w };
      }
    }
  } catch (err) {
    console.warn('Failed to read session input dims:', err);
  }
  return { h: defaultH, w: defaultW };
}

// Helper to get tensor dimensions safely
function getTensorDims(tensor: any, defaultH: number, defaultW: number): { h: number; w: number } {
  try {
    if (tensor && tensor.dims && tensor.dims.length >= 3) {
      const dims = tensor.dims;
      const h = dims[dims.length - 2];
      const w = dims[dims.length - 1];
      if (h > 0 && w > 0) {
        return { h, w };
      }
    }
  } catch (err) {
    console.warn('Failed to read tensor dims:', err);
  }
  return { h: defaultH, w: defaultW };
}

// Professional hole-filling (BFS Flood-Fill) and edge smoothing algorithm on the alpha channel
function refineAlphaMask(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  // Create a 1D alpha array for easier processing
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    alpha[i] = data[i * 4 + 3];
  }

  // 1. Hole Filling: Flood fill background from the image borders
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  // Helper to push to queue if the pixel qualifies as background candidate
  const enqueue = (x: number, y: number) => {
    const idx = y * width + x;
    if (visited[idx] === 0 && alpha[idx] < 128) {
      visited[idx] = 1;
      queue[tail++] = idx;
    }
  };

  // Push all border pixels to queue
  for (let x = 0; x < width; x++) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  // BFS Flood Fill
  while (head < tail) {
    const idx = queue[head++];
    const x = idx % width;
    const y = Math.floor(idx / width);

    // Check 4-connected neighbors
    if (x > 0) enqueue(x - 1, y);
    if (x < width - 1) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y < height - 1) enqueue(x, y + 1);
  }

  // Any pixel not visited by the background flood fill is considered "subject".
  // If it's inside the subject, fill transparent or semi-transparent holes.
  const refinedAlpha = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    if (visited[i] === 0) {
      // It is inside the subject! Fill holes completely (alpha = 255)
      refinedAlpha[i] = 255;
    } else {
      // It is background. Keep its original low alpha.
      refinedAlpha[i] = alpha[i];
    }
  }

  // Write back to canvas
  for (let i = 0; i < width * height; i++) {
    data[i * 4 + 3] = refinedAlpha[i];
  }
  ctx.putImageData(imgData, 0, 0);

  // Apply high-performance hardware-accelerated canvas blur filter to smooth edges
  try {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d')!;
    
    // Smooth transition
    tempCtx.filter = 'blur(1.5px)';
    tempCtx.drawImage(ctx.canvas, 0, 0);
    
    ctx.clearRect(0, 0, width, height);
    ctx.filter = 'none';
    ctx.drawImage(tempCanvas, 0, 0);
  } catch (err) {
    console.warn('Canvas filter blur failed, proceeding with refined alpha:', err);
  }
}

// Core background removal pipeline
export async function removeBackground(
  imageElement: HTMLImageElement,
  onStageUpdate: (stage: string) => void
): Promise<HTMLCanvasElement> {
  const ort = (window as any).ort;
  if (!ort || !depthSession) {
    throw new Error('Models are not initialized.');
  }

  onStageUpdate('Preparing image metadata...');
  await new Promise((resolve) => setTimeout(resolve, 80)); // Allow UI to render and breathe

  const rawWidth = imageElement.naturalWidth || (imageElement as any).width || 1024;
  const rawHeight = imageElement.naturalHeight || (imageElement as any).height || 1024;

  // Cap processing resolution to 1024 max dimension to speed up model runs and prevent mobile overheating
  const MAX_DIMENSION = 1024;
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

  // Draw original image scaled to optimized processing dimensions
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = originalWidth;
  baseCanvas.height = originalHeight;
  const baseCtx = baseCanvas.getContext('2d')!;
  baseCtx.imageSmoothingEnabled = true;
  baseCtx.imageSmoothingQuality = 'high';
  baseCtx.drawImage(imageElement, 0, 0, originalWidth, originalHeight);

  // Dynamically resolve input shape of Depth Anything V2 Slim
  const { h: depthInputH, w: depthInputW } = getSessionInputDims(depthSession, 378, 378);

  const preCanvas = document.createElement('canvas');
  preCanvas.width = depthInputW;
  preCanvas.height = depthInputH;
  const preCtx = preCanvas.getContext('2d')!;
  preCtx.drawImage(baseCanvas, 0, 0, depthInputW, depthInputH);

  const preprocessedDepthInput = preprocessForDepth(preCtx, depthInputW, depthInputH);

  // Run Depth Anything V2 Slim
  onStageUpdate('Analyzing depth of portrait (Stage 1/3)...');
  await new Promise((resolve) => setTimeout(resolve, 120));

  const depthInputTensor = new ort.Tensor('float32', preprocessedDepthInput, [1, 3, depthInputH, depthInputW]);
  
  const depthInputName = depthSession.inputNames[0];
  const depthOutputName = depthSession.outputNames[0];

  const depthOutputs = await depthSession.run({ [depthInputName]: depthInputTensor });
  const depthOutput = depthOutputs[depthOutputName];
  const depthData = depthOutput.data as Float32Array;

  // Dynamically resolve actual output shape of Depth model
  const { h: depthOutH, w: depthOutW } = getTensorDims(depthOutput, depthInputH, depthInputW);

  // Normalize depth map to [0, 1]
  const { min: depthMin, max: depthMax } = getMinMax(depthData);
  const depthRange = depthMax - depthMin || 1.0;
  
  const normalizedDepth = new Float32Array(depthData.length);
  for (let i = 0; i < depthData.length; i++) {
    normalizedDepth[i] = (depthData[i] - depthMin) / depthRange;
  }

  // Draw depth map onto a canvas of its own actual size!
  const depthCanvas = document.createElement('canvas');
  depthCanvas.width = depthOutW;
  depthCanvas.height = depthOutH;
  const depthCtx = depthCanvas.getContext('2d')!;
  const depthImgData = depthCtx.createImageData(depthOutW, depthOutH);
  
  for (let i = 0; i < normalizedDepth.length; i++) {
    const val = Math.floor(normalizedDepth[i] * 255);
    depthImgData.data[i * 4] = val;     // R
    depthImgData.data[i * 4 + 1] = val; // G
    depthImgData.data[i * 4 + 2] = val; // B
    depthImgData.data[i * 4 + 3] = 255; // A
  }
  depthCtx.putImageData(depthImgData, 0, 0);

  // Stage 2: Run Matting Model
  onStageUpdate('Extracting subject silhouette (Stage 2/3)...');
  await new Promise((resolve) => setTimeout(resolve, 80));

  // Dynamically resolve input shape of Matting model
  const { h: matInputH, w: matInputW } = getSessionInputDims(mattingSession, 512, 512);

  const matImgCanvas = document.createElement('canvas');
  matImgCanvas.width = matInputW;
  matImgCanvas.height = matInputH;
  const matImgCtx = matImgCanvas.getContext('2d')!;
  imgCtxDraw(matImgCtx, baseCanvas, matInputW, matInputH);

  function imgCtxDraw(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, w: number, h: number) {
    ctx.drawImage(img, 0, 0, w, h);
  }

  const matDepthCanvas = document.createElement('canvas');
  matDepthCanvas.width = matInputW;
  matDepthCanvas.height = matInputH;
  const matDepthCtx = matDepthCanvas.getContext('2d')!;
  matDepthCtx.drawImage(depthCanvas, 0, 0, matInputW, matInputH);

  // Preprocess image for Matting: shape [1, 3, H, W] in CHW format
  const matImgData = matImgCtx.getImageData(0, 0, matInputW, matInputH);
  const matImgFloats = new Float32Array(matInputW * matInputH * 3);
  for (let i = 0; i < matInputW * matInputH; i++) {
    matImgFloats[i] = matImgData.data[i * 4] / 255.0; // R
    matImgFloats[matInputW * matInputH + i] = matImgData.data[i * 4 + 1] / 255.0; // G
    matImgFloats[matInputW * matInputH * 2 + i] = matImgData.data[i * 4 + 2] / 255.0; // B
  }

  // Preprocess depth map as a single channel mask: shape [1, 1, H, W]
  const matDepthData = matDepthCtx.getImageData(0, 0, matInputW, matInputH);
  const matDepthFloats = new Float32Array(matInputW * matInputH);
  for (let i = 0; i < matInputW * matInputH; i++) {
    matDepthFloats[i] = matDepthData.data[i * 4] / 255.0;
  }

  const matImgTensor = new ort.Tensor('float32', matImgFloats, [1, 3, matInputH, matInputW]);
  const matMaskTensor = new ort.Tensor('float32', matDepthFloats, [1, 1, matInputH, matInputW]);

  let coarseAlphaData: Float32Array;
  let matOutH = matInputH;
  let matOutW = matInputW;

  const matInputNameImage = mattingSession.inputNames[0];
  const matInputNameMask = mattingSession.inputNames[1];
  const matOutputNameMatte = mattingSession.outputNames[0];

  try {
    const mattingOutputs = await mattingSession.run({
      [matInputNameImage]: matImgTensor,
      [matInputNameMask]: matMaskTensor
    });
    const mattingOutput = mattingOutputs[matOutputNameMatte];
    coarseAlphaData = mattingOutput.data as Float32Array;
    
    const matDims = getTensorDims(mattingOutput, matInputH, matInputW);
    matOutH = matDims.h;
    matOutW = matDims.w;
  } catch (err) {
    console.warn('Matting model run failed, falling back to pure depth thresholding:', err);
    coarseAlphaData = matDepthFloats;
  }

  // Stage 3: Run Refiner Model (if loaded)
  let finalAlphaData = coarseAlphaData;
  let finalH = matOutH;
  let finalW = matOutW;

  if (refinerSession) {
    onStageUpdate('Refining hair and edges (Stage 3/3)...');
    await new Promise((resolve) => setTimeout(resolve, 80));

    const refInputNameImage = refinerSession.inputNames[0];
    const refInputNameAlpha = refinerSession.inputNames[1];
    const refOutputNameAlpha = refinerSession.outputNames[0];

    // Dynamically resolve input shape of Refiner model
    const { h: refInputH, w: refInputW } = getSessionInputDims(refinerSession, 512, 512);

    const refImgCanvas = document.createElement('canvas');
    refImgCanvas.width = refInputW;
    refImgCanvas.height = refInputH;
    const refImgCtx = refImgCanvas.getContext('2d')!;
    refImgCtx.drawImage(baseCanvas, 0, 0, refInputW, refInputH);

    const refImgData = refImgCtx.getImageData(0, 0, refInputW, refInputH);
    const refImgFloats = new Float32Array(refInputW * refInputH * 3);
    for (let i = 0; i < refInputW * refInputH; i++) {
      refImgFloats[i] = refImgData.data[i * 4] / 255.0; // R
      refImgFloats[refInputW * refInputH + i] = refImgData.data[i * 4 + 1] / 255.0; // G
      refImgFloats[refInputW * refInputH * 2 + i] = refImgData.data[i * 4 + 2] / 255.0; // B
    }

    // Coarse alpha map as input to refiner
    // Resize coarse alpha to match refiner input size
    const refCoarseCanvas = document.createElement('canvas');
    refCoarseCanvas.width = refInputW;
    refCoarseCanvas.height = refInputH;
    const refCoarseCtx = refCoarseCanvas.getContext('2d')!;
    
    // Draw the coarse alpha onto helper canvas
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = matOutW;
    tempCanvas.height = matOutH;
    const tempCtx = tempCanvas.getContext('2d')!;
    const tempImgData = tempCtx.createImageData(matOutW, matOutH);
    for (let i = 0; i < coarseAlphaData.length; i++) {
      const val = Math.floor(coarseAlphaData[i] * 255);
      tempImgData.data[i * 4] = val;
      tempImgData.data[i * 4 + 1] = val;
      tempImgData.data[i * 4 + 2] = val;
      tempImgData.data[i * 4 + 3] = 255;
    }
    tempCtx.putImageData(tempImgData, 0, 0);
    
    // Draw it scaled to refCoarseCanvas
    refCoarseCtx.drawImage(tempCanvas, 0, 0, refInputW, refInputH);
    const refCoarseData = refCoarseCtx.getImageData(0, 0, refInputW, refInputH);
    
    const refCoarseAlphaFloats = new Float32Array(refInputW * refInputH);
    for (let i = 0; i < refInputW * refInputH; i++) {
      refCoarseAlphaFloats[i] = refCoarseData.data[i * 4] / 255.0;
    }

    const refImgTensor = new ort.Tensor('float32', refImgFloats, [1, 3, refInputH, refInputW]);
    const refAlphaTensor = new ort.Tensor('float32', refCoarseAlphaFloats, [1, 1, refInputH, refInputW]);

    try {
      const refinerOutputs = await refinerSession.run({
        [refInputNameImage]: refImgTensor,
        [refInputNameAlpha]: refAlphaTensor
      });
      const refinerOutput = refinerOutputs[refOutputNameAlpha];
      finalAlphaData = refinerOutput.data as Float32Array;
      
      const refDims = getTensorDims(refinerOutput, refInputH, refInputW);
      finalH = refDims.h;
      finalW = refDims.w;
    } catch (err) {
      console.warn('Refiner failed, using coarse matting output:', err);
      finalAlphaData = coarseAlphaData;
      finalH = matOutH;
      finalW = matOutW;
    }
  }

  onStageUpdate('Assembling high-resolution portrait...');
  await new Promise((resolve) => setTimeout(resolve, 80));

  // Resize finalAlpha map onto alphaCanvas of exactly finalW x finalH
  const alphaCanvas = document.createElement('canvas');
  alphaCanvas.width = finalW;
  alphaCanvas.height = finalH;
  const alphaCtx = alphaCanvas.getContext('2d')!;
  const alphaImgData = alphaCtx.createImageData(finalW, finalH);

  for (let i = 0; i < finalW * finalH; i++) {
    // Enhance contrast of alpha matte slightly but preserve soft features
    let val = finalAlphaData[i];
    val = Math.max(0, Math.min(1, (val - 0.05) * 1.15));
    const alphaByte = Math.floor(val * 255);
    
    alphaImgData.data[i * 4] = 255;
    alphaImgData.data[i * 4 + 1] = 255;
    alphaImgData.data[i * 4 + 2] = 255;
    alphaImgData.data[i * 4 + 3] = alphaByte;
  }
  alphaCtx.putImageData(alphaImgData, 0, 0);

  // Apply professional hole-filling and edge smoothing directly to the intermediate canvas
  refineAlphaMask(alphaCtx, finalW, finalH);

  // Draw alpha canvas onto a full-resolution helper canvas to scale up using Canvas bilinear interpolation
  const fullAlphaCanvas = document.createElement('canvas');
  fullAlphaCanvas.width = originalWidth;
  fullAlphaCanvas.height = originalHeight;
  const fullAlphaCtx = fullAlphaCanvas.getContext('2d')!;
  fullAlphaCtx.drawImage(alphaCanvas, 0, 0, originalWidth, originalHeight);

  // Generate final output canvas at full original resolution!
  const outCanvas = document.createElement('canvas');
  outCanvas.width = originalWidth;
  outCanvas.height = originalHeight;
  const outCtx = outCanvas.getContext('2d')!;

  // 1. Draw original full-res image
  outCtx.drawImage(baseCanvas, 0, 0, originalWidth, originalHeight);

  // 2. Mask the original image using destination-in composite operation
  // This is hardware-accelerated by the browser and runs in microseconds instead of blocking JS loops!
  outCtx.globalCompositeOperation = 'destination-in';
  outCtx.drawImage(fullAlphaCanvas, 0, 0, originalWidth, originalHeight);
  
  // Restore default composition
  outCtx.globalCompositeOperation = 'source-over';

  onStageUpdate('Completed');
  return outCanvas;
}

// Bounding box detection on the alpha channel to locate and auto-center face
export function detectSubjectBoundingBox(canvas: HTMLCanvasElement): { minX: number; minY: number; maxX: number; maxY: number } {
  const originalWidth = canvas.width;
  const originalHeight = canvas.height;

  // Use a small fixed size for detection to avoid scanning high-res images (e.g., 12MP) which freezes devices
  const scanSize = 128;
  const scaleX = originalWidth / scanSize;
  const scaleY = originalHeight / scanSize;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = scanSize;
  tempCanvas.height = scanSize;
  const tempCtx = tempCanvas.getContext('2d')!;
  
  // Draw the original canvas scaled down to 128x128
  tempCtx.drawImage(canvas, 0, 0, scanSize, scanSize);
  const imgData = tempCtx.getImageData(0, 0, scanSize, scanSize);
  const data = imgData.data;

  let minX = scanSize;
  let maxX = 0;
  let minY = scanSize;
  let maxY = 0;
  let found = false;

  for (let y = 0; y < scanSize; y++) {
    for (let x = 0; x < scanSize; x++) {
      const idx = (y * scanSize + x) * 4;
      const alpha = data[idx + 3];

      // If pixel is non-transparent (threshold 30)
      if (alpha > 30) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }

  if (!found) {
    return { minX: 0, minY: 0, maxX: originalWidth, maxY: originalHeight };
  }

  // Scale bounds back to original resolution
  let origMinX = minX * scaleX;
  let origMaxX = maxX * scaleX;
  let origMinY = minY * scaleY;
  let origMaxY = maxY * scaleY;

  // Add 10% padding to bounds, clamping to canvas size
  const paddingX = (origMaxX - origMinX) * 0.05;
  const paddingY = (origMaxY - origMinY) * 0.05;

  return {
    minX: Math.max(0, Math.floor(origMinX - paddingX)),
    minY: Math.max(0, Math.floor(origMinY - paddingY)),
    maxX: Math.min(originalWidth, Math.ceil(origMaxX + paddingX)),
    maxY: Math.min(originalHeight, Math.ceil(origMaxY + paddingY))
  };
}

// Check if a canvas has any non-opaque pixels
export function checkCanvasHasAlpha(canvas: HTMLCanvasElement): boolean {
  try {
    const ctx = canvas.getContext('2d')!;
    const w = Math.min(canvas.width, 100);
    const h = Math.min(canvas.height, 100);
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
  } catch (err) {
    console.warn('Failed to check alpha channel:', err);
  }
  return false;
}

// Enhance image resolution using RyzenAI RealESRGAN ONNX model (1024x1024 fp32)
export async function enhanceImageWithRealESRGAN(
  inputCanvas: HTMLCanvasElement,
  onProgress: (stage: string) => void
): Promise<HTMLCanvasElement> {
  const ort = (window as any).ort;
  if (!ort) {
    throw new Error('ONNX Runtime is not loaded.');
  }

  const originalWidth = inputCanvas.width;
  const originalHeight = inputCanvas.height;

  // We wrap the ONNX execution in a try-catch block. If it fails (due to WASM memory limit on larger models, etc.),
  // we gracefully fall back to a high-fidelity local detail-preserving unsharp-mask upscaler.
  try {
    if (!realesrganSession) {
      throw new Error('RealESRGAN model is not initialized or still compiling.');
    }

    onProgress('Preparing portrait details...');
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The model has a fixed input shape of [1, 3, 1024, 1024]
    const inputSize = 1024;
    
    // Create an intermediate 1024x1024 canvas to resize the input image
    const resizeCanvas = document.createElement('canvas');
    resizeCanvas.width = inputSize;
    resizeCanvas.height = inputSize;
    const resizeCtx = resizeCanvas.getContext('2d')!;
    
    // Clean off-white background padding
    resizeCtx.fillStyle = '#FFFFFF';
    resizeCtx.fillRect(0, 0, inputSize, inputSize);
    
    // Draw maintaining aspect ratio to prevent distorting faces
    const scale = Math.min(inputSize / originalWidth, inputSize / originalHeight);
    const drawW = originalWidth * scale;
    const drawH = originalHeight * scale;
    const drawX = (inputSize - drawW) / 2;
    const drawY = (inputSize - drawH) / 2;
    
    resizeCtx.drawImage(inputCanvas, drawX, drawY, drawW, drawH);

    onProgress('Normalizing neural inputs...');
    await new Promise((resolve) => setTimeout(resolve, 50));

    const imgData = resizeCtx.getImageData(0, 0, inputSize, inputSize);
    const data = imgData.data;
    
    // Prepare float32 array in NCHW format: [1, 3, 1024, 1024]
    const totalPixels = inputSize * inputSize;
    const inputData = new Float32Array(totalPixels * 3);

    // RealESRGAN expects standard [0, 1] RGB values, shape [1, 3, H, W]
    for (let i = 0; i < totalPixels; i++) {
      inputData[i] = data[i * 4] / 255.0;                  // R channel
      inputData[totalPixels + i] = data[i * 4 + 1] / 255.0; // G channel
      inputData[totalPixels * 2 + i] = data[i * 4 + 2] / 255.0; // B channel
    }

    onProgress('Running local neural super-resolution (RealESRGAN)...');
    await new Promise((resolve) => setTimeout(resolve, 80));

    const inputTensor = new ort.Tensor('float32', inputData, [1, 3, inputSize, inputSize]);
    
    const inputName = realesrganSession.inputNames[0];
    const outputName = realesrganSession.outputNames[0];

    const outputs = await realesrganSession.run({ [inputName]: inputTensor });
    const outputTensor = outputs[outputName];
    const outputData = outputTensor.data as Float32Array;

    const dims = outputTensor.dims;
    const outH = dims[2] || 1024;
    const outW = dims[3] || 1024;

    onProgress('Reconstructing enhanced pixels...');
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Create canvas for the upscaled output
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = outW;
    outputCanvas.height = outH;
    const outputCtx = outputCanvas.getContext('2d')!;
    const outputImgData = outputCtx.createImageData(outW, outH);

    const outTotalPixels = outW * outH;
    for (let i = 0; i < outTotalPixels; i++) {
      // Map outputs from float back to [0, 255] bytes
      const r = Math.max(0, Math.min(255, Math.floor(outputData[i] * 255)));
      const g = Math.max(0, Math.min(255, Math.floor(outputData[outTotalPixels + i] * 255)));
      const b = Math.max(0, Math.min(255, Math.floor(outputData[outTotalPixels * 2 + i] * 255)));

      outputImgData.data[i * 4] = r;
      outputImgData.data[i * 4 + 1] = g;
      outputImgData.data[i * 4 + 2] = b;
      outputImgData.data[i * 4 + 3] = 255;
    }
    outputCtx.putImageData(outputImgData, 0, 0);

    onProgress('Applying enhanced detail mask...');
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Crop out the padded areas to restore original aspect ratio but 4x sharper!
    const finalW = Math.round(originalWidth * (outW / inputSize));
    const finalH = Math.round(originalHeight * (outH / inputSize));
    
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = finalW;
    finalCanvas.height = finalH;
    const finalCtx = finalCanvas.getContext('2d')!;

    // Source coordinates of the non-padded region inside the upscaled image
    const srcX = Math.round(drawX * (outW / inputSize));
    const srcY = Math.round(drawY * (outH / inputSize));
    const srcW = Math.round(drawW * (outW / inputSize));
    const srcH = Math.round(drawH * (outH / inputSize));

    finalCtx.drawImage(
      outputCanvas,
      srcX, srcY, srcW, srcH,
      0, 0, finalW, finalH
    );

    // If the input canvas has transparency, scale up and re-apply alpha channel to preserve transparency!
    const hasAlpha = checkCanvasHasAlpha(inputCanvas);
    if (hasAlpha) {
      const alphaCanvas = document.createElement('canvas');
      alphaCanvas.width = finalW;
      alphaCanvas.height = finalH;
      const alphaCtx = alphaCanvas.getContext('2d')!;
      
      // Draw original canvas on it (this stretches/interpolates the alpha channel to high-res!)
      alphaCtx.drawImage(inputCanvas, 0, 0, finalW, finalH);
      
      // Mask final upscaled canvas using destination-in operation
      finalCtx.globalCompositeOperation = 'destination-in';
      finalCtx.drawImage(alphaCanvas, 0, 0, finalW, finalH);
      finalCtx.globalCompositeOperation = 'source-over';
    }

    onProgress('Completed');
    return finalCanvas;
  } catch (onnxError) {
    console.warn('RealESRGAN ONNX Runtime execution failed, falling back to high-fidelity Unsharp Mask Detail Enhancer:', onnxError);
    
    onProgress('Optimizing detail enhancement pipeline...');
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Fallback: Build a stunning 2x upscale with a highly optimized, real-time unsharp 3x3 sharpening convolution!
    // This runs in milliseconds, keeps mobile completely cool, has 0 lighting artifacts, and returns an outstanding, crisp portrait.
    const fallbackW = originalWidth * 2;
    const fallbackH = originalHeight * 2;

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = fallbackW;
    finalCanvas.height = fallbackH;
    const finalCtx = finalCanvas.getContext('2d')!;

    // Draw original image upscaled
    finalCtx.imageSmoothingEnabled = true;
    finalCtx.imageSmoothingQuality = 'high';
    finalCtx.drawImage(inputCanvas, 0, 0, fallbackW, fallbackH);

    // Apply high-frequency sharpening to crisp up facial lines, hair, eyes
    onProgress('Enhancing facial micro-contrast...');
    await new Promise((resolve) => setTimeout(resolve, 60));

    try {
      const imgData = finalCtx.getImageData(0, 0, fallbackW, fallbackH);
      const width = imgData.width;
      const height = imgData.height;
      const src = imgData.data;
      const output = new Uint8ClampedArray(src.length);

      // Copy original pixels first as a baseline
      output.set(src);

      // Professional 3x3 high-pass sharpening convolution:
      // [  0,  -0.3,   0  ]
      // [ -0.3,  2.2, -0.3 ]
      // [  0,  -0.3,   0  ]
      const w1 = -0.3;
      const w2 = 2.2;

      for (let y = 1; y < height - 1; y++) {
        const rowOffset = y * width;
        const prevRowOffset = (y - 1) * width;
        const nextRowOffset = (y + 1) * width;

        for (let x = 1; x < width - 1; x++) {
          const idx = (rowOffset + x) * 4;

          // Skip fully transparent pixels
          if (src[idx + 3] === 0) continue;

          const leftIdx  = (rowOffset + x - 1) * 4;
          const rightIdx = (rowOffset + x + 1) * 4;
          const topIdx   = (prevRowOffset + x) * 4;
          const bottomIdx= (nextRowOffset + x) * 4;

          // Process RGB channels with the high-performance localized convolution
          const r = src[idx] * w2 + (src[leftIdx] + src[rightIdx] + src[topIdx] + src[bottomIdx]) * w1;
          const g = src[idx + 1] * w2 + (src[leftIdx + 1] + src[rightIdx + 1] + src[topIdx + 1] + src[bottomIdx + 1]) * w1;
          const b = src[idx + 2] * w2 + (src[leftIdx + 2] + src[rightIdx + 2] + src[topIdx + 2] + src[bottomIdx + 2]) * w1;

          output[idx]     = r < 0 ? 0 : (r > 255 ? 255 : r);
          output[idx + 1] = g < 0 ? 0 : (g > 255 ? 255 : g);
          output[idx + 2] = b < 0 ? 0 : (b > 255 ? 255 : b);
        }
      }

      const outputImgData = new ImageData(output, width, height);
      finalCtx.putImageData(outputImgData, 0, 0);
    } catch (err) {
      console.warn('Fallback detail enhancement shader failed:', err);
    }

    onProgress('Completed');
    return finalCanvas;
  }
}


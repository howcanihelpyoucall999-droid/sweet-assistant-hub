import React, { useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { EditorState, PRESET_SIZES } from './types';
import { loadModels, removeBackground } from './onnxHelper';
import EditorZone from './EditorZone';
import PrintSheetZone from './PrintSheetZone';
import {
  Zap, Shield, Menu, Upload, Sparkles, AlertTriangle,
  Lock, Cpu, ImageIcon, Wand2, X, User,
} from 'lucide-react';
import gobyLogo from '@/assets/goby-logo.png.asset.json';
import {
  Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const INITIAL_EDITOR_STATE: EditorState = {
  scale: 1.0, panX: 0, panY: 0, rotation: 0,
  backgroundColor: '#FFFFFF',
  selectedSize: PRESET_SIZES[0],
  customWidthMm: 35, customHeightMm: 45, gridCount: 8,
};

/* -------------------------------------------------------------------------- */
/* Crystal — contained behind hero text only, lightweight.                    */
/* -------------------------------------------------------------------------- */
function CrystalBehindText() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement!;
    const getSize = () => ({
      w: parent.clientWidth,
      h: parent.clientHeight,
    });

    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: true, powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    let { w, h } = getSize();
    renderer.setSize(w, h, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    camera.position.set(2.6, 1.6, 4);
    camera.lookAt(0, 0, 0);

    const geometry = new THREE.IcosahedronGeometry(1.25, 0);
    const group = new THREE.Group();

    const core = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: 0x1a0b2e, metalness: 0.85, roughness: 0.3 }),
    );
    core.scale.setScalar(0.94);
    group.add(core);

    const shell = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0x7c5cff, transparent: true, opacity: 0.5, metalness: 0.3, roughness: 0.15,
      }),
    );
    group.add(shell);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0xbeaaff, transparent: true, opacity: 0.75 }),
    );
    group.add(edges);

    scene.add(group);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(3, 4, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8b5cf6, 0.9);
    rim.position.set(-3, 1, -3);
    scene.add(rim);

    let rafId = 0;
    let running = true;
    const animate = () => {
      if (!running) return;
      rafId = requestAnimationFrame(animate);
      const t = performance.now() * 0.001;
      group.rotation.y += 0.004;
      group.rotation.x = Math.sin(t * 0.4) * 0.15;
      group.position.y = Math.sin(t * 0.6) * 0.12;
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const s = getSize();
      w = s.w; h = s.h;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(parent);

    const onVis = () => {
      if (document.hidden) { running = false; cancelAnimationFrame(rafId); }
      else if (!running) { running = true; animate(); }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      geometry.dispose();
      (core.material as THREE.Material).dispose();
      (shell.material as THREE.Material).dispose();
      (edges.material as THREE.Material).dispose();
      (edges.geometry as THREE.BufferGeometry).dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="absolute inset-0 w-full h-full pointer-events-none opacity-80"
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Friendly progress messages (no technical wording)                          */
/* -------------------------------------------------------------------------- */
const INIT_MESSAGES = [
  'Preparing your workspace...',
  'Setting everything up...',
  'Warming up the studio...',
  'Almost ready...',
];

const PROCESS_MESSAGES = [
  'Analyzing your image...',
  'Enhancing your photo...',
  'Optimizing facial alignment...',
  'Creating your passport photo...',
  'Finalizing your result...',
];

/* -------------------------------------------------------------------------- */
/* Dedicated processing page — smooth 0→100, always advancing, premium look   */
/* -------------------------------------------------------------------------- */
function ProcessingPage({
  mode,
  target,
  done,
  error,
  onRetry,
}: {
  mode: 'init' | 'process';
  target: number; // 0..0.98 — where the bar should be heading right now
  done: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const doneRef = useRef(done);
  const targetRef = useRef(target);
  doneRef.current = done;
  targetRef.current = target;

  const messages = mode === 'init' ? INIT_MESSAGES : PROCESS_MESSAGES;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      setProgress((prev) => {
        if (doneRef.current) {
          // Snap smoothly to 100
          const next = prev + Math.max(0.6, (100 - prev) * 0.18) * (dt / 16);
          return next >= 100 ? 100 : next;
        }
        const tgt = Math.min(98, targetRef.current * 100);
        // Ease toward target, but always creep forward so it never freezes.
        const gap = tgt - prev;
        const ease = gap > 0 ? gap * 0.045 * (dt / 16) : 0;
        // Minimum forward drift: ~1.2% per second while below 96
        const drift = prev < 96 ? 0.02 * (dt / 16) : 0;
        const next = prev + Math.max(drift, ease);
        return next > 98 ? 98 : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const pct = Math.min(100, Math.round(progress));
  const msgIdx = Math.min(
    messages.length - 1,
    Math.floor((pct / 100) * messages.length),
  );

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="relative w-full max-w-xl rounded-3xl border border-[rgba(190,170,255,0.28)] bg-[rgba(20,8,40,0.6)] backdrop-blur-2xl p-8 md:p-14 text-center shadow-[0_0_80px_rgba(124,92,255,0.3)] animate-fadeIn overflow-hidden">
        <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-[#7c5cff]/25 blur-3xl animate-pulse" />

        <div className="relative flex justify-center mb-8">
          <div className="relative w-24 h-24 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border-2 border-[#7c5cff]/25" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#beaaff] border-r-[#a78bfa] animate-spin" />
            <Sparkles className="w-9 h-9 text-[#beaaff] drop-shadow-[0_0_12px_rgba(190,170,255,0.9)]" />
          </div>
        </div>

        <h3 className="relative text-2xl md:text-3xl font-black tracking-tight bg-gradient-to-r from-white via-[#e6d9ff] to-[#beaaff] bg-clip-text text-transparent min-h-[2.2em]">
          {messages[msgIdx]}
        </h3>
        <p className="relative mt-3 text-sm text-white/60 font-medium">
          Sit back — this only takes a moment.
        </p>

        <div className="relative mt-10">
          <div className="flex justify-between text-[11px] font-mono font-bold text-white/60 mb-2">
            <span className="tracking-wider">PROGRESS</span>
            <span className="text-[#beaaff]">{pct}%</span>
          </div>
          <div className="w-full h-2.5 rounded-full bg-white/5 overflow-hidden border border-[rgba(190,170,255,0.18)]">
            <div
              className="h-full bg-gradient-to-r from-[#7c5cff] via-[#a78bfa] to-[#beaaff] shadow-[0_0_14px_rgba(167,139,250,0.9)]"
              style={{ width: `${pct}%`, transition: 'width 180ms linear' }}
            />
          </div>
        </div>

        <div className="relative mt-8 flex justify-center gap-2">
          {messages.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                i <= msgIdx ? 'w-6 bg-[#beaaff] shadow-[0_0_8px_rgba(190,170,255,0.8)]' : 'w-1.5 bg-white/15'
              }`}
            />
          ))}
        </div>

        {error && (
          <div className="relative mt-8 p-4 rounded-2xl bg-rose-950/40 border border-rose-500/30 text-left">
            <div className="flex items-center gap-2 text-rose-300 font-bold text-sm mb-1">
              <AlertTriangle className="w-4 h-4" /> Something went wrong
            </div>
            <p className="text-xs text-rose-200/80 mb-3">{error}</p>
            <button
              onClick={onRetry}
              className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


/* -------------------------------------------------------------------------- */
/* Upload panel                                                               */
/* -------------------------------------------------------------------------- */
function UploadPanel({
  onImageSelected,
}: {
  onImageSelected: (src: string) => void;
}) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = (file: File) => {
    if (!file.type.startsWith('image/')) { setError('Please upload an image (PNG, JPG, WEBP).'); return; }
    if (file.size > 15 * 1024 * 1024) { setError('File too large. Max 15MB.'); return; }
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => { if (e.target?.result) onImageSelected(e.target.result as string); };
    reader.readAsDataURL(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setIsDragActive(true);
    else if (e.type === 'dragleave') setIsDragActive(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragActive(false);
    if (e.dataTransfer.files?.[0]) processFile(e.dataTransfer.files[0]);
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) processFile(e.target.files[0]);
  };
  const trigger = () => fileInputRef.current?.click();

  return (
    <div className="w-full max-w-2xl mx-auto animate-fadeIn">
      <div
        onDragEnter={handleDrag} onDragOver={handleDrag} onDragLeave={handleDrag}
        onDrop={handleDrop} onClick={trigger}
        className={`relative rounded-3xl border-2 border-dashed p-8 md:p-14 text-center cursor-pointer transition-all duration-300 backdrop-blur-2xl group overflow-hidden ${
          isDragActive
            ? 'border-[#beaaff] bg-[rgba(124,92,255,0.15)] scale-[0.99]'
            : 'border-[rgba(190,170,255,0.35)] bg-[rgba(20,8,40,0.55)] hover:border-[#a78bfa] hover:bg-[rgba(30,15,60,0.65)] hover:shadow-[0_0_50px_rgba(124,92,255,0.35)]'
        }`}
      >
        <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-[#7c5cff]/20 blur-3xl" />

        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

        <div className="relative flex justify-center mb-5">
          <div className="w-16 h-16 rounded-2xl border border-[rgba(190,170,255,0.4)] bg-gradient-to-br from-[rgba(124,92,255,0.25)] to-[rgba(167,139,250,0.15)] flex items-center justify-center text-[#beaaff] transition-transform group-hover:scale-110 shadow-[0_0_25px_rgba(124,92,255,0.4)]">
            <Upload className="w-7 h-7" strokeWidth={2} />
          </div>
        </div>

        <h3 className="relative text-2xl md:text-3xl font-black tracking-tight bg-gradient-to-b from-white to-[#beaaff] bg-clip-text text-transparent">
          Upload Your Picture
        </h3>
        <p className="relative mt-2 text-sm text-white/60 font-medium">
          Drag and drop your image here, or click to browse
        </p>

        <button
          onClick={(e) => { e.stopPropagation(); trigger(); }}
          className="relative mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#7c5cff] to-[#8b5cf6] hover:from-[#8b5cf6] hover:to-[#a78bfa] text-white font-bold px-8 py-3 shadow-[0_0_30px_rgba(124,92,255,0.55)] hover:shadow-[0_0_40px_rgba(167,139,250,0.75)] active:scale-95 transition-all"
        >
          Choose File
        </button>

        <p className="relative mt-5 text-[10px] font-bold uppercase tracking-widest text-white/30">
          PNG · JPG · WEBP · up to 15MB
        </p>

        {error && (
          <div className="absolute bottom-4 left-4 right-4 p-3 rounded-xl bg-rose-950/50 border border-rose-500/40 text-rose-200 text-xs font-semibold">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Header — logo (display only), menu Sheet, circular profile avatar          */
/* -------------------------------------------------------------------------- */
function Header() {
  return (
    <header className="sticky top-0 z-50 px-4 md:px-8 pt-4">
      <div className="max-w-6xl mx-auto grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-full border border-[rgba(190,170,255,0.25)] bg-[rgba(10,5,20,0.65)] backdrop-blur-xl px-4 py-2 shadow-[0_0_30px_rgba(124,92,255,0.15)]">
        {/* Logo — display only, not clickable */}
        <div className="flex items-center min-w-0 select-none" aria-label="Goby.pics">
          <img
            src={gobyLogo.url}
            alt="Goby.pics"
            draggable={false}
            className="h-11 md:h-12 w-auto object-contain drop-shadow-[0_0_10px_rgba(124,92,255,0.4)]"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Menu sheet */}
          <Sheet>
            <SheetTrigger asChild>
              <button
                aria-label="Open menu"
                className="h-11 w-11 rounded-full border border-[rgba(190,170,255,0.35)] bg-[rgba(20,8,40,0.7)] hover:bg-[rgba(30,15,60,0.85)] flex items-center justify-center text-[#beaaff] transition-all hover:shadow-[0_0_18px_rgba(124,92,255,0.5)] active:scale-95"
              >
                <Menu className="w-5 h-5" />
              </button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="bg-[rgba(10,5,20,0.95)] backdrop-blur-2xl border-l border-[rgba(190,170,255,0.2)] text-white"
            >
              <SheetHeader>
                <SheetTitle className="text-white text-xl font-black tracking-tight">
                  <span className="bg-gradient-to-r from-white to-[#beaaff] bg-clip-text text-transparent">
                    Menu
                  </span>
                </SheetTitle>
              </SheetHeader>
              <nav className="mt-8 flex flex-col gap-1">
                {[
                  { icon: <ImageIcon className="w-4 h-4" />, label: 'New Photo' },
                  { icon: <Wand2 className="w-4 h-4" />, label: 'AI Enhance' },
                  { icon: <Sparkles className="w-4 h-4" />, label: 'Templates' },
                  { icon: <Shield className="w-4 h-4" />, label: 'Privacy' },
                  { icon: <Cpu className="w-4 h-4" />, label: 'About AI' },
                ].map((it) => (
                  <button
                    key={it.label}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl text-white/80 hover:text-white hover:bg-[rgba(124,92,255,0.15)] border border-transparent hover:border-[rgba(190,170,255,0.25)] transition-all text-sm font-semibold"
                  >
                    <span className="text-[#beaaff]">{it.icon}</span>
                    {it.label}
                  </button>
                ))}
              </nav>
              <div className="absolute bottom-6 left-6 right-6 text-[11px] font-mono text-white/40">
                © 2026 Goby.pics
              </div>
            </SheetContent>
          </Sheet>

          {/* Profile avatar */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Profile"
                className="rounded-full ring-2 ring-[rgba(190,170,255,0.5)] hover:ring-[#beaaff] transition-all shadow-[0_0_18px_rgba(124,92,255,0.45)] active:scale-95"
              >
                <Avatar className="h-11 w-11 md:h-12 md:w-12">
                  <AvatarImage src="" alt="Profile" />
                  <AvatarFallback className="bg-gradient-to-br from-[#7c5cff] to-[#a78bfa] text-white font-black">
                    <User className="w-5 h-5" />
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="bg-[rgba(15,8,30,0.95)] backdrop-blur-xl border border-[rgba(190,170,255,0.25)] text-white w-56"
            >
              <DropdownMenuLabel className="text-[#beaaff] font-bold">Guest User</DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-[rgba(190,170,255,0.15)]" />
              <DropdownMenuItem className="focus:bg-[rgba(124,92,255,0.2)] focus:text-white cursor-pointer">
                <User className="w-4 h-4 mr-2 text-[#beaaff]" /> Profile
              </DropdownMenuItem>
              <DropdownMenuItem className="focus:bg-[rgba(124,92,255,0.2)] focus:text-white cursor-pointer">
                <ImageIcon className="w-4 h-4 mr-2 text-[#beaaff]" /> My Photos
              </DropdownMenuItem>
              <DropdownMenuItem className="focus:bg-[rgba(124,92,255,0.2)] focus:text-white cursor-pointer">
                <Shield className="w-4 h-4 mr-2 text-[#beaaff]" /> Privacy
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-[rgba(190,170,255,0.15)]" />
              <DropdownMenuItem className="focus:bg-[rgba(124,92,255,0.2)] focus:text-white cursor-pointer">
                <X className="w-4 h-4 mr-2 text-[#beaaff]" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Main App                                                                    */
/* -------------------------------------------------------------------------- */
export default function App() {
  const [activeStep, setActiveStep] = useState<'upload' | 'processing' | 'edit' | 'export'>('upload');
  const [, setSelectedImageSrc] = useState<string | null>(null);
  const [processedCanvas, setProcessedCanvas] = useState<HTMLCanvasElement | null>(null);
  const [croppedImageSrc, setCroppedImageSrc] = useState<string | null>(null);

  const [modelsLoaded, setModelsLoaded] = useState(() => {
    try { return localStorage.getItem('goby-initialized') === '1'; } catch { return false; }
  });
  const [processError, setProcessError] = useState<string | null>(null);
  const [processingDone, setProcessingDone] = useState(false);
  const [procMode, setProcMode] = useState<'init' | 'process'>('process');
  const [procTarget, setProcTarget] = useState(0);

  const [editorState, setEditorState] = useState<EditorState>(INITIAL_EDITOR_STATE);

  const handleImageSelected = async (imageSrc: string) => {
    setSelectedImageSrc(imageSrc);
    setProcessError(null);
    setProcessingDone(false);
    setProcTarget(0);
    const firstTime = !modelsLoaded;
    setProcMode(firstTime ? 'init' : 'process');
    setActiveStep('processing');

    // Gentle stage timer so the bar keeps advancing even when a stage stalls.
    let stageTimer: number | undefined;
    const scheduleStages = (stages: number[], perStageMs: number) => {
      let i = 0;
      const step = () => {
        if (i < stages.length) {
          setProcTarget(stages[i]);
          i++;
          stageTimer = window.setTimeout(step, perStageMs);
        }
      };
      step();
    };

    try {
      if (firstTime) {
        // Drive target from real model-download bytes across all files.
        await loadModels((p) => {
          const entries = Object.values(p);
          if (!entries.length) return;
          let loaded = 0, total = 0;
          for (const e of entries) {
            loaded += e.loaded || 0;
            total += e.total || 0;
          }
          const frac = total > 0 ? loaded / total : 0;
          // Init phase occupies 0..0.85 of the bar
          setProcTarget(Math.min(0.85, 0.05 + frac * 0.8));
        });
        setModelsLoaded(true);
        try { localStorage.setItem('goby-initialized', '1'); } catch {}
        // Transition into processing phase visually
        setProcTarget(0.9);
        setProcMode('process');
        setProcTarget(0.15);
      }

      // Processing stages (used every generation)
      scheduleStages([0.25, 0.45, 0.65, 0.82, 0.92], 900);

      const img = new Image();
      img.crossOrigin = 'anonymous';
      const imgReady = new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Could not load image.'));
      });
      img.src = imageSrc;
      await imgReady;

      let processed: HTMLCanvasElement;
      try {
        processed = await removeBackground(img, () => {});
      } catch {
        processed = document.createElement('canvas');
        processed.width = img.naturalWidth || 1024;
        processed.height = img.naturalHeight || 1024;
        processed.getContext('2d')!.drawImage(img, 0, 0);
      }

      if (stageTimer) clearTimeout(stageTimer);
      setProcessedCanvas(processed);
      setProcessingDone(true);
      // Let the progress bar snap to 100 briefly, then transition.
      setTimeout(() => {
        setActiveStep('edit');
        setTimeout(() => document.getElementById('auto-align-btn')?.click(), 250);
      }, 550);
    } catch (err: any) {
      if (stageTimer) clearTimeout(stageTimer);
      setProcessError(err?.message || 'Something went wrong. Please try another photo.');
    }
  };



  const handleReset = () => {
    setSelectedImageSrc(null);
    setProcessedCanvas(null);
    setCroppedImageSrc(null);
    setEditorState(INITIAL_EDITOR_STATE);
    setActiveStep('upload');
  };

  return (
    <div className="min-h-screen flex flex-col font-sans" id="main-app">
      <Header />

      <main className="flex-1 w-full px-4 md:px-8 py-10 md:py-16">
        {activeStep === 'upload' && (
          <div className="max-w-4xl mx-auto flex flex-col items-center">
            {/* Hero with contained crystal behind text */}
            <section className="relative w-full text-center pt-4 pb-14 md:pt-8 md:pb-20">
              <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[360px] h-[360px] md:w-[520px] md:h-[520px] opacity-90">
                <CrystalBehindText />
              </div>

              <h1 className="relative z-10 text-4xl sm:text-5xl md:text-6xl font-black tracking-tight leading-[1.05]">
                <span className="bg-gradient-to-b from-[#e6d9ff] via-[#a78bfa] to-[#7c5cff] bg-clip-text text-transparent drop-shadow-[0_0_35px_rgba(124,92,255,0.35)]">
                  Professional Photos<br />in Seconds
                </span>
              </h1>
              <p className="relative z-10 mt-5 text-sm md:text-base text-white/65 max-w-md mx-auto font-medium">
                Upload your photo and get studio-quality passport-ready results, instantly.
              </p>
            </section>

            {/* Feature icons row */}
            <section className="grid grid-cols-3 gap-3 md:gap-8 w-full max-w-2xl mb-10 md:mb-14">
              {[
                { icon: <Zap className="w-6 h-6" strokeWidth={2} />, title: 'Instant Results', desc: 'Photos in seconds.' },
                { icon: <div className="w-8 h-6 rounded-md border-2 border-current flex items-center justify-center text-[10px] font-black tracking-tight">HD</div>, title: 'High Quality', desc: 'Studio-grade output.' },
                { icon: <Shield className="w-6 h-6" strokeWidth={2} />, title: 'Secure & Private', desc: 'Runs on your device.' },
              ].map((f, i) => (
                <div key={i} className="flex flex-col items-center text-center gap-2">
                  <div className="text-[#a78bfa] mb-1">{f.icon}</div>
                  <h4 className="text-[#beaaff] text-xs md:text-sm font-bold">{f.title}</h4>
                  <p className="text-white/50 text-[11px] md:text-xs leading-snug max-w-[140px]">{f.desc}</p>
                </div>
              ))}
            </section>

            <UploadPanel onImageSelected={handleImageSelected} />


            {/* About / trust section */}
            <section className="w-full max-w-4xl mt-16 md:mt-24 grid gap-8 md:gap-10">
              <div className="text-center">
                <h2 className="text-2xl md:text-3xl font-black tracking-tight bg-gradient-to-b from-white to-[#beaaff] bg-clip-text text-transparent">
                  Why Goby.pics
                </h2>
                <p className="mt-3 text-sm md:text-base text-white/60 max-w-2xl mx-auto font-medium">
                  A premium AI photo studio in your browser. We use on-device neural networks so your photos never leave your computer — no uploads, no servers, no waiting queues.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
                {[
                  { icon: <Cpu className="w-5 h-5" />, title: 'On-Device AI', desc: 'Neural background removal, enhancement, and cropping — all local.' },
                  { icon: <Lock className="w-5 h-5" />, title: 'Zero Uploads', desc: 'Your image data stays in your browser. Nothing is ever sent to a server.' },
                  { icon: <Wand2 className="w-5 h-5" />, title: 'Print-Ready PDF', desc: 'Export a clean A4 sheet with your chosen passport size, ready to print.' },
                ].map((f) => (
                  <div
                    key={f.title}
                    className="rounded-2xl border border-[rgba(190,170,255,0.2)] bg-[rgba(20,8,40,0.55)] backdrop-blur-xl p-5 md:p-6 hover:border-[rgba(190,170,255,0.4)] hover:shadow-[0_0_30px_rgba(124,92,255,0.2)] transition-all"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[rgba(124,92,255,0.18)] border border-[rgba(190,170,255,0.3)] flex items-center justify-center text-[#beaaff] mb-3">
                      {f.icon}
                    </div>
                    <h3 className="text-white font-bold text-sm md:text-base">{f.title}</h3>
                    <p className="text-white/55 text-xs md:text-sm mt-1.5 leading-relaxed font-medium">{f.desc}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
        {activeStep === 'processing' && (
          <ProcessingPage mode={procMode} target={procTarget} done={processingDone} error={processError} onRetry={handleReset} />
        )}


        {activeStep === 'edit' && processedCanvas && (
          <div className="max-w-7xl mx-auto">
            <EditorZone
              originalImage={new Image()}
              processedCanvas={processedCanvas}
              editorState={editorState}
              setEditorState={setEditorState}
              onNext={(img) => { setCroppedImageSrc(img); setActiveStep('export'); }}
              onBack={handleReset}
            />
          </div>
        )}

        {activeStep === 'export' && croppedImageSrc && (
          <div className="max-w-7xl mx-auto">
            <PrintSheetZone
              croppedImageSrc={croppedImageSrc}
              editorState={editorState}
              onBack={() => setActiveStep('edit')}
            />
          </div>
        )}
      </main>

      <footer className="py-6 px-4 text-center text-white/40 text-xs font-medium">
        © 2026 Goby.pics. All rights reserved.
      </footer>
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { PRESET_SIZES, PRESET_COLORS, PassportSize, EditorState } from './types';
import { 
  ZoomIn, ZoomOut, RotateCcw, Paintbrush, Move, Scan, 
  RotateCw, ArrowLeft, ArrowRight, ShieldCheck, CheckCircle,
  Loader2, Sparkles
} from 'lucide-react';
import { detectSubjectBoundingBox, enhanceImageWithRealESRGAN } from './onnxHelper';

interface EditorZoneProps {
  originalImage: HTMLImageElement;
  processedCanvas: HTMLCanvasElement;
  editorState: EditorState;
  setEditorState: React.Dispatch<React.SetStateAction<EditorState>>;
  onNext: (croppedImageSrc: string) => void;
  onBack: () => void;
}

export default function EditorZone({
  originalImage,
  processedCanvas,
  editorState,
  setEditorState,
  onNext,
  onBack
}: EditorZoneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Size helper
  const isCustomSize = editorState.selectedSize.id === 'custom';
  const widthMm = isCustomSize ? editorState.customWidthMm : editorState.selectedSize.widthMm;
  const heightMm = isCustomSize ? editorState.customHeightMm : editorState.selectedSize.heightMm;
  const aspectRatio = widthMm / heightMm;

  // Render crop canvas
  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d')!;
    const width = canvas.width;
    const height = canvas.height;

    // Clear with selected background color
    ctx.fillStyle = editorState.backgroundColor;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    
    // Apply center transformations for panning, zooming, and rotating
    ctx.translate(width / 2 + editorState.panX, height / 2 + editorState.panY);
    ctx.scale(editorState.scale, editorState.scale);
    ctx.rotate((editorState.rotation * Math.PI) / 180);

    // Draw the transparent processed portrait
    const activeCanvas = processedCanvas;
    const imgRatio = activeCanvas.width / activeCanvas.height;
    let drawW = width;
    let drawH = width / imgRatio;

    if (drawH < height) {
      drawH = height;
      drawW = height * imgRatio;
    }

    // Center the image draw command relative to the transformed origin
    ctx.drawImage(activeCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  };

  // Redraw whenever editor state or canvas size shifts
  useEffect(() => {
    // Set standard render dimensions for high resolution
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = 600;
      canvas.height = Math.round(600 / aspectRatio);
    }
  }, [aspectRatio]);

  useEffect(() => {
    drawCanvas();
  }, [editorState, processedCanvas, aspectRatio]);

  // Handle Drag / Pan Events
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - editorState.panX, y: e.clientY - editorState.panY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    setEditorState(prev => ({ ...prev, panX: dx, panY: dy }));
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  // Touch Events for Mobile support
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      setDragStart({ x: e.touches[0].clientX - editorState.panX, y: e.touches[0].clientY - editorState.panY });
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - dragStart.x;
    const dy = e.touches[0].clientY - dragStart.y;
    setEditorState(prev => ({ ...prev, panX: dx, panY: dy }));
  };

  // Auto-centering face alignment heuristic
  const handleAutoAlign = () => {
    const bbox = detectSubjectBoundingBox(processedCanvas);
    const canvas = canvasRef.current;
    if (!canvas) return;

    const imgW = processedCanvas.width;
    const imgH = processedCanvas.height;

    // Center of detected bounding box
    const bboxCenterX = (bbox.minX + bbox.maxX) / 2;
    const bboxCenterY = (bbox.minY + bbox.maxY) / 2;

    // Bounding box dimensions
    const bboxW = bbox.maxX - bbox.minX;
    const bboxH = bbox.maxY - bbox.minY;

    // Target height should be roughly 65% of the crop window
    const cropH = canvas.height;
    const cropW = canvas.width;

    // Scale calculations
    const scale = (cropH * 0.70) / (bboxH || 1);

    // Pan calculations (offset from image center to crop box center)
    const panX = (imgW / 2 - bboxCenterX) * scale;
    // Shift slightly upward so the face is aligned upper-middle
    const panY = (imgH / 2 - bboxCenterY) * scale - (cropH * 0.05);

    setEditorState(prev => ({
      ...prev,
      scale: Math.min(Math.max(scale, 0.4), 3.5),
      panX,
      panY,
      rotation: 0
    }));
  };

  // Save/Export cropped canvas
  const handleCropAndProceed = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png', 1.0);
    onNext(dataUrl);
  };

  return (
    <div id="editor-zone" className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start max-w-6xl mx-auto w-full animate-fadeIn">
      {/* Left Column: Canvas Preview */}
      <div className="lg:col-span-7 flex flex-col items-center">
        <div className="w-full flex items-center justify-between mb-4">
          <button
            id="back-btn"
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors py-1.5 px-3 rounded-lg hover:bg-slate-100 border border-transparent hover:border-slate-200 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" /> Start Over
          </button>
          
          <button
            id="auto-align-btn"
            onClick={handleAutoAlign}
            className="flex items-center gap-1.5 text-xs font-extrabold text-orange-700 bg-orange-50 hover:bg-orange-100 active:scale-95 transition-all py-1.5 px-3.5 rounded-full border border-orange-200/60 shadow-sm cursor-pointer"
            title="Auto center and size face inside passport margins"
          >
            <Scan className="w-4 h-4" /> Auto-Align Face
          </button>
        </div>

        {/* Viewport container - Styled as real passport photo paper frame */}
        <div 
          ref={containerRef}
          id="canvas-viewport"
          className="relative overflow-hidden border-[10px] border-white ring-1 ring-slate-200/80 bg-slate-50 shadow-2xl cursor-move select-none touch-none w-full max-w-[360px] aspect-[3.5/4.5] flex items-center justify-center p-0 rounded-lg"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={handleMouseUpOrLeave}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleMouseUpOrLeave}
        >
          {/* Main Drawing Canvas */}
          <canvas 
            ref={canvasRef} 
            className="w-full h-full object-contain"
          />

          {/* Guidelines HUD Overlay */}
          <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4 border-2 border-orange-500/15 rounded">
            {/* Top Indicator */}
            <div className="w-full flex justify-between items-start text-[9px] text-slate-400 font-bold font-mono">
              <span className="bg-white/90 backdrop-blur-sm px-1.5 py-0.5 rounded border border-slate-100">{widthMm}x{heightMm} mm</span>
              <span className="bg-orange-50/95 text-orange-700 backdrop-blur-sm px-1.5 py-0.5 rounded border border-orange-100/60">GUIDES ACTIVE</span>
            </div>

            {/* Passport Face Guidelines */}
            <div className="absolute inset-0 flex items-center justify-center opacity-70">
              {/* Face Guide Oval */}
              <div className="w-[50%] h-[58%] rounded-[50%/48%] border border-dashed border-orange-500/80 flex flex-col items-center justify-start pt-[12%] bg-orange-500/[0.01]">
                {/* Eyes guidelines */}
                <div className="w-full border-b border-orange-500/30 border-dotted h-0" />
                <span className="text-[7px] text-orange-600 font-bold font-mono mt-1 tracking-wider uppercase bg-white/80 px-1 py-0.5 rounded-sm">Eyes Line</span>
                
                {/* Nose and mouth area */}
                <div className="w-1.5 h-6 border-l border-orange-500/30 border-dotted mt-4" />
                <span className="text-[7px] text-orange-600 font-bold font-mono mt-1 tracking-wider uppercase bg-white/80 px-1 py-0.5 rounded-sm">Chin Limit</span>
              </div>
            </div>

            {/* Bottom HUD */}
            <div className="w-full flex justify-between items-end text-[8px] text-slate-500 font-bold font-mono bg-white/90 backdrop-blur-sm p-1.5 rounded border border-slate-200/50 shadow-sm">
              <span>Drag / pinch to align</span>
              <span>100% Biometric Scale</span>
            </div>
          </div>
        </div>
        
        <p className="text-[11px] text-slate-400 mt-4 text-center max-w-xs leading-relaxed font-semibold">
          Keep the subject’s head centered inside the dotted oval guide. Eyes should align near the eye-line indicator.
        </p>
      </div>

      {/* Right Column: Editing Controls */}
      <div className="lg:col-span-5 space-y-6">
        {/* Step Header */}
        <div>
          <div className="text-[10px] font-bold text-orange-600 tracking-widest uppercase mb-1 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 stroke-[2.5px]" /> Step 2 of 3
          </div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight">Crop & Background</h2>
          <p className="text-slate-500 text-xs mt-1 font-semibold">Configure dimensions, adjust positioning, and replace background color.</p>
        </div>

        {/* Dimension Select */}
        <div id="dimension-card" className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
          <label className="block text-xs font-bold text-slate-400 tracking-wider uppercase">Passport Dimension</label>
          <div className="grid grid-cols-1 gap-2.5">
            {PRESET_SIZES.map((size) => (
              <button
                key={size.id}
                id={`btn-size-${size.id}`}
                onClick={() => setEditorState(prev => ({ ...prev, selectedSize: size }))}
                className={`p-3.5 rounded-xl border text-left flex items-center justify-between transition-all duration-200 cursor-pointer ${
                  editorState.selectedSize.id === size.id
                    ? 'border-orange-500 bg-orange-50/35 text-orange-950 shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50/50'
                }`}
              >
                <div>
                  <div className="text-xs font-bold">{size.name}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5 font-semibold">{size.description}</div>
                </div>
                {editorState.selectedSize.id === size.id && (
                  <CheckCircle className="w-4 h-4 text-orange-600 shrink-0" />
                )}
              </button>
            ))}
          </div>

          {/* Custom size input blocks */}
          {isCustomSize && (
            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 animate-fadeIn">
              <div>
                <label className="block text-[10px] text-slate-500 font-bold mb-1">Width (mm)</label>
                <input
                  id="custom-width-input"
                  type="number"
                  min="20"
                  max="150"
                  value={editorState.customWidthMm}
                  onChange={(e) => setEditorState(prev => ({ ...prev, customWidthMm: Math.max(20, parseFloat(e.target.value) || 20) }))}
                  className="w-full p-2.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 font-bold mb-1">Height (mm)</label>
                <input
                  id="custom-height-input"
                  type="number"
                  min="20"
                  max="150"
                  value={editorState.customHeightMm}
                  onChange={(e) => setEditorState(prev => ({ ...prev, customHeightMm: Math.max(20, parseFloat(e.target.value) || 20) }))}
                  className="w-full p-2.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-mono"
                />
              </div>
            </div>
          )}
        </div>

        {/* Background Colors card */}
        <div id="background-card" className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-1.5">
            <Paintbrush className="w-4 h-4 text-orange-500" />
            <span className="text-xs font-bold text-slate-400 tracking-wider uppercase">Background Color</span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {PRESET_COLORS.map((color) => (
              <button
                key={color.id}
                id={`btn-color-${color.id}`}
                onClick={() => setEditorState(prev => ({ ...prev, backgroundColor: color.hex }))}
                className={`relative w-9 h-9 rounded-xl border shadow-sm transition-all active:scale-90 cursor-pointer ${
                  editorState.backgroundColor.toLowerCase() === color.hex.toLowerCase()
                    ? 'scale-110 border-orange-600 ring-2 ring-orange-500/20'
                    : 'border-slate-200 hover:scale-105'
                }`}
                style={{ backgroundColor: color.hex }}
                title={color.name}
              >
                {editorState.backgroundColor.toLowerCase() === color.hex.toLowerCase() && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 rounded-full animate-fadeIn" style={{ backgroundColor: color.hex === '#FFFFFF' ? '#000000' : '#FFFFFF' }} />
                  </div>
                )}
              </button>
            ))}

            {/* Custom Color Picker */}
            <div className="h-8 w-px bg-slate-200 mx-1" />
            
            <div className="relative flex items-center gap-2">
              <input
                id="custom-color-picker"
                type="color"
                value={editorState.backgroundColor}
                onChange={(e) => setEditorState(prev => ({ ...prev, backgroundColor: e.target.value }))}
                className="w-9 h-9 rounded-xl border border-slate-350 cursor-pointer overflow-hidden p-0 bg-transparent"
                title="Select Custom Color"
              />
              <span className="text-[10px] font-mono text-slate-500 select-all font-bold uppercase bg-slate-50 px-2 py-1 rounded border border-slate-150">{editorState.backgroundColor}</span>
            </div>
          </div>
        </div>



        {/* Alignment controls card */}
        <div id="alignment-controls" className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-5">
          <label className="block text-xs font-bold text-slate-400 tracking-wider uppercase">Scale & Rotation Fine-tuning</label>
          
          {/* Zoom slider */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs text-slate-600 font-bold">
              <span className="flex items-center gap-1"><ZoomOut className="w-4 h-4 text-slate-450" /> Image Zoom</span>
              <span className="font-mono text-[11px] font-bold text-orange-600">{(editorState.scale * 100).toFixed(0)}%</span>
            </div>
            <input
              id="zoom-slider"
              type="range"
              min="0.3"
              max="3.5"
              step="0.05"
              value={editorState.scale}
              onChange={(e) => setEditorState(prev => ({ ...prev, scale: parseFloat(e.target.value) }))}
              className="w-full accent-orange-500 cursor-ew-resize h-1 bg-slate-100 rounded-lg appearance-none"
            />
          </div>

          {/* Rotation slider */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs text-slate-600 font-bold">
              <span className="flex items-center gap-1"><RotateCw className="w-4 h-4 text-slate-450" /> Rotate Profile</span>
              <span className="font-mono text-[11px] font-bold text-orange-600">{editorState.rotation}°</span>
            </div>
            <div className="flex gap-3 items-center">
              <button 
                id="reset-rot-btn"
                onClick={() => setEditorState(prev => ({ ...prev, rotation: 0 }))}
                className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-colors shrink-0 cursor-pointer"
                title="Reset Rotation to 0"
              >
                <RotateCcw className="w-4 h-4 text-slate-500" />
              </button>
              <input
                id="rotation-slider"
                type="range"
                min="-180"
                max="180"
                step="1"
                value={editorState.rotation}
                onChange={(e) => setEditorState(prev => ({ ...prev, rotation: parseInt(e.target.value) }))}
                className="w-full accent-orange-500 cursor-ew-resize h-1 bg-slate-100 rounded-lg appearance-none"
              />
            </div>
          </div>
        </div>

        {/* Action Button */}
        <button
          id="apply-crop-btn"
          onClick={handleCropAndProceed}
          className="w-full py-4 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 active:scale-[0.99] transition-all text-white rounded-2xl text-sm font-extrabold shadow-md shadow-orange-600/10 flex items-center justify-center gap-2 cursor-pointer"
        >
          <span>Generate A4 Print Pack</span>
          <ArrowRight className="w-4 h-4 stroke-[2.5px]" />
        </button>
      </div>
    </div>
  );
}

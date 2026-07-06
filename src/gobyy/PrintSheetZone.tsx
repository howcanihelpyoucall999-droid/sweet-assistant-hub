import React, { useState } from 'react';
import { PassportSize, EditorState } from './types';
import { jsPDF } from 'jspdf';
import { 
  Download, Printer, ArrowLeft, Check, Sparkles, 
  FileText, Image as ImageIcon, CheckCircle, Info, Move
} from 'lucide-react';

interface PrintSheetZoneProps {
  croppedImageSrc: string;
  editorState: EditorState;
  onBack: () => void;
}

export default function PrintSheetZone({
  croppedImageSrc,
  editorState,
  onBack
}: PrintSheetZoneProps) {
  const [gridCount, setGridCount] = useState<number>(8); // default to 8 photos
  const [isDownloading, setIsDownloading] = useState<string | null>(null);

  const isCustomSize = editorState.selectedSize.id === 'custom';
  const widthMm = isCustomSize ? editorState.customWidthMm : editorState.selectedSize.widthMm;
  const heightMm = isCustomSize ? editorState.customHeightMm : editorState.selectedSize.heightMm;

  // Grid layout options
  const layoutOptions = [
    { count: 4, cols: 2, rows: 2, label: '4 Photos', desc: 'Saves paper, large spacing' },
    { count: 6, cols: 3, rows: 2, label: '6 Photos', desc: 'Standard mini-grid' },
    { count: 8, cols: 4, rows: 2, label: '8 Photos (Recommended)', desc: 'Perfect density' },
    { count: 12, cols: 4, rows: 3, label: '12 Photos', desc: 'Max density, easy cutting' }
  ];

  const currentLayout = layoutOptions.find(o => o.count === gridCount) || layoutOptions[2];

  // Drag and reposition states
  const [gridOffset, setGridOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Calculate grid preview positioning (A4 is 210mm x 297mm)
  const a4Width = 210;
  const a4Height = 297;
  const gapMm = 5;

  const totalGridWidth = currentLayout.cols * widthMm + (currentLayout.cols - 1) * gapMm;
  const totalGridHeight = currentLayout.rows * heightMm + (currentLayout.rows - 1) * gapMm;

  const startX = ((a4Width - totalGridWidth) / 2) + gridOffset.x;
  const startY = ((a4Height - totalGridHeight) / 2) + gridOffset.y;

  // Handle Drag/Move events for the A4 grid preview
  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDragging(true);
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setDragStart({ x: clientX, y: clientY });
  };

  const handleDragMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    const dx = clientX - dragStart.x;
    const dy = clientY - dragStart.y;
    
    const paperElement = document.getElementById('paper-container');
    const scale = paperElement ? 210 / paperElement.clientWidth : 0.54;
    
    const dxMm = dx * scale;
    const dyMm = dy * scale;
    
    setGridOffset(prev => {
      const newX = prev.x + dxMm;
      const newY = prev.y + dyMm;
      
      const maxOffsetX = (a4Width - totalGridWidth) / 2 - 5;
      const minOffsetX = -((a4Width - totalGridWidth) / 2 - 5);
      const maxOffsetY = (a4Height - totalGridHeight) / 2 - 5;
      const minOffsetY = -((a4Height - totalGridHeight) / 2 - 15);
      
      return {
        x: Math.max(minOffsetX, Math.min(maxOffsetX, newX)),
        y: Math.max(minOffsetY, Math.min(maxOffsetY, newY))
      };
    });
    
    setDragStart({ x: clientX, y: clientY });
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  const handleNudge = (direction: 'left' | 'right' | 'up' | 'down') => {
    setGridOffset(prev => {
      let dx = 0;
      let dy = 0;
      if (direction === 'left') dx = -1.5;
      else if (direction === 'right') dx = 1.5;
      else if (direction === 'up') dy = -1.5;
      else if (direction === 'down') dy = 1.5;

      const newX = prev.x + dx;
      const newY = prev.y + dy;

      const maxOffsetX = (a4Width - totalGridWidth) / 2 - 5;
      const minOffsetX = -((a4Width - totalGridWidth) / 2 - 5);
      const maxOffsetY = (a4Height - totalGridHeight) / 2 - 5;
      const minOffsetY = -((a4Height - totalGridHeight) / 2 - 15);

      return {
        x: Math.max(minOffsetX, Math.min(maxOffsetX, newX)),
        y: Math.max(minOffsetY, Math.min(maxOffsetY, newY))
      };
    });
  };

  // Single photo download (PNG / JPG)
  const downloadSingle = (format: 'png' | 'jpeg') => {
    setIsDownloading(format);
    setTimeout(() => {
      const link = document.createElement('a');
      link.download = `passport_photo_${widthMm}x${heightMm}.${format}`;
      link.href = croppedImageSrc;
      link.click();
      setIsDownloading(null);
    }, 400);
  };

  // High-res A4 PDF generator
  const downloadPDF = async () => {
    setIsDownloading('pdf');
    await new Promise((resolve) => setTimeout(resolve, 300)); // allow spin to render

    try {
      // Create PDF in portrait mode, with millimeters as units, size A4
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      // Load image into jsPDF
      const img = new Image();
      img.src = croppedImageSrc;

      img.onload = () => {
        // Draw arranged photos onto PDF canvas
        for (let r = 0; r < currentLayout.rows; r++) {
          for (let c = 0; c < currentLayout.cols; c++) {
            const x = startX + c * (widthMm + gapMm);
            const y = startY + r * (heightMm + gapMm);

            // Draw Photo
            pdf.addImage(img, 'PNG', x, y, widthMm, heightMm);

            // Draw thin grey cut lines (corners)
            pdf.setDrawColor(200, 200, 200);
            pdf.setLineWidth(0.1);

            // Corner ticks (lengths of 3mm)
            const tick = 3;
            // Top Left corner ticks
            pdf.line(x - 1, y, x - 1 - tick, y);
            pdf.line(x, y - 1, x, y - 1 - tick);

            // Top Right corner ticks
            pdf.line(x + widthMm + 1, y, x + widthMm + 1 + tick, y);
            pdf.line(x + widthMm, y - 1, x + widthMm, y - 1 - tick);

            // Bottom Left corner ticks
            pdf.line(x - 1, y + heightMm, x - 1 - tick, y + heightMm);
            pdf.line(x, y + heightMm + 1, x, y + heightMm + 1 + tick);

            // Bottom Right corner ticks
            pdf.line(x + widthMm + 1, y + heightMm, x + widthMm + 1 + tick, y + heightMm);
            pdf.line(x + widthMm, y + heightMm + 1, x + widthMm, y + heightMm + 1 + tick);
          }
        }

        // Add header information at the top (extremely high-end touch)
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(150, 150, 150);
        pdf.text('Passport AI Photo Maker - High Resolution Print Sheet', 15, 12);
        pdf.text(`Photo Size: ${widthMm}x${heightMm} mm | Sheet Size: A4 (210x297 mm) | Print at 100% scale`, 15, 16);
        pdf.line(15, 19, 195, 19);

        // Save file
        pdf.save(`passport_print_sheet_${gridCount}_pack.pdf`);
        setIsDownloading(null);
      };
    } catch (err) {
      console.error('Error generating PDF:', err);
      setIsDownloading(null);
    }
  };

  // Generate cutting lines/crosshair array for preview grid
  const renderGridPreview = () => {
    const boxes = [];
    for (let r = 0; r < currentLayout.rows; r++) {
      for (let c = 0; c < currentLayout.cols; c++) {
        // Percentage coordinates inside A4 container
        const xPercent = (startX + c * (widthMm + gapMm)) / a4Width * 100;
        const yPercent = (startY + r * (heightMm + gapMm)) / a4Height * 100;
        const wPercent = widthMm / a4Width * 100;
        const hPercent = heightMm / a4Height * 100;

        boxes.push(
          <div
            key={`${r}-${c}`}
            className="absolute overflow-hidden animate-fadeIn"
            style={{
              left: `${xPercent}%`,
              top: `${yPercent}%`,
              width: `${wPercent}%`,
              height: `${hPercent}%`,
            }}
          >
            <img
              src={croppedImageSrc}
              alt="Passport preview"
              className="w-full h-full object-cover"
            />
          </div>
        );

      }
    }
    return boxes;
  };

  return (
    <div id="print-sheet-zone" className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start max-w-6xl mx-auto w-full animate-fadeIn">
      {/* Left Column: Interactive Page Preview */}
      <div className="lg:col-span-6 flex flex-col items-center">
        <div className="w-full flex items-center justify-between mb-4">
          <button
            id="back-editor-btn"
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors py-1.5 px-3 rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" /> Adjust Crop & Color
          </button>
          
          <span className="text-[10px] bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-bold font-mono uppercase tracking-wide">
            A4 Print Preview (210 x 297 mm)
          </span>
        </div>

        {/* Minimal white paper — only the photos, no header/decoration */}
        <div
          id="paper-container"
          className="relative bg-white aspect-[1/1.414] w-full max-w-[340px] md:max-w-[385px] shadow-2xl rounded-sm overflow-hidden"
        >
          <div
            id="draggable-grid-area"
            onMouseDown={handleDragStart}
            onMouseMove={handleDragMove}
            onMouseUp={handleDragEnd}
            onMouseLeave={handleDragEnd}
            onTouchStart={handleDragStart}
            onTouchMove={handleDragMove}
            onTouchEnd={handleDragEnd}
            className={`relative w-full h-full select-none overflow-hidden ${
              isDragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
            title="Drag to reposition photos on the A4 sheet"
          >
            {renderGridPreview()}
          </div>
        </div>


        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-4 max-w-xs text-center justify-center font-semibold">
          <Info className="w-3.5 h-3.5 shrink-0 text-orange-400" />
          <span>Cut ticks (orange lines) will print on final PDF document.</span>
        </div>
      </div>

      {/* Right Column: PDF Settings & Exporters */}
      <div className="lg:col-span-6 space-y-6">
        <div>
          <div className="text-[10px] font-bold text-orange-600 tracking-widest uppercase mb-1 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 stroke-[2.5px]" /> Step 3 of 3
          </div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight">Print Layout & Export</h2>
          <p className="text-slate-500 text-xs mt-1 font-semibold">Select sheet density, download individual photo cards, or generate a print-ready PDF document.</p>
        </div>

        {/* Single Photo Card Export */}
        <div id="single-export-card" className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3.5">
          <label className="block text-xs font-bold text-slate-400 tracking-wider uppercase">Single Photo Download</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              id="download-png-btn"
              onClick={() => downloadSingle('png')}
              disabled={isDownloading !== null}
              className="flex-1 py-3 bg-slate-50 border border-slate-200 hover:border-orange-300 hover:bg-white active:scale-[0.98] transition-all rounded-xl text-slate-700 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
            >
              <ImageIcon className="w-4 h-4 text-orange-500" />
              <span>Download PNG</span>
            </button>
            <button
              id="download-jpg-btn"
              onClick={() => downloadSingle('jpeg')}
              disabled={isDownloading !== null}
              className="flex-1 py-3 bg-slate-50 border border-slate-200 hover:border-orange-300 hover:bg-white active:scale-[0.98] transition-all rounded-xl text-slate-700 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4 text-orange-500" />
              <span>Download JPG</span>
            </button>
          </div>
        </div>

        {/* Layout Density grid selection */}
        <div id="layout-grid-card" className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex justify-between items-center">
            <label className="block text-xs font-bold text-slate-400 tracking-wider uppercase font-extrabold">A4 Page Grid Count</label>
            <span className="text-[10px] font-mono text-orange-700 bg-orange-50 border border-orange-100 px-2.5 py-0.5 rounded-full font-extrabold">A4 Size Target</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {layoutOptions.map((layout) => (
              <button
                key={layout.count}
                id={`btn-layout-${layout.count}`}
                onClick={() => setGridCount(layout.count)}
                className={`p-3.5 rounded-xl border text-left flex flex-col justify-between transition-all duration-200 cursor-pointer ${
                  gridCount === layout.count
                    ? 'border-orange-500 bg-orange-50/35 text-orange-950 shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50/50'
                }`}
              >
                <div className="text-xs font-bold">{layout.label}</div>
                <div className="text-[10px] text-slate-400 mt-1 font-semibold">{layout.desc}</div>
                {gridCount === layout.count && (
                  <div className="self-end mt-2 text-orange-600">
                    <Check className="w-4 h-4 stroke-[3px]" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Nudge/Reposition controls card */}
        <div id="reposition-card" className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 pb-2">
            <label className="block text-xs font-black text-slate-700 tracking-wider uppercase flex items-center gap-1.5">
              <Move className="w-4 h-4 text-orange-500" /> Reposition Photos on A4
            </label>
            <button
              onClick={() => setGridOffset({ x: 0, y: 0 })}
              disabled={gridOffset.x === 0 && gridOffset.y === 0}
              className="text-[10px] text-orange-600 hover:text-orange-700 disabled:text-slate-300 disabled:no-underline font-extrabold cursor-pointer hover:underline"
            >
              Reset Position
            </button>
          </div>
          <p className="text-[11px] text-slate-500 font-semibold leading-relaxed">
            Drag the photo grid directly on the A4 page preview to position it, or use the nudge buttons below for fine-tuned precision alignment.
          </p>

          <div className="flex items-center justify-center gap-3 pt-1">
            <button
              onClick={() => handleNudge('left')}
              className="py-2.5 px-3.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl font-bold text-xs text-slate-700 active:scale-95 transition-all cursor-pointer flex items-center gap-1"
              title="Move Left 1.5mm"
            >
              ◀ Left
            </button>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => handleNudge('up')}
                className="py-2 px-3.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl font-bold text-xs text-slate-700 active:scale-95 transition-all cursor-pointer flex justify-center items-center gap-1"
                title="Move Up 1.5mm"
              >
                ▲ Up
              </button>
              <button
                onClick={() => handleNudge('down')}
                className="py-2 px-3.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl font-bold text-xs text-slate-700 active:scale-95 transition-all cursor-pointer flex justify-center items-center gap-1"
                title="Move Down 1.5mm"
              >
                ▼ Down
              </button>
            </div>
            <button
              onClick={() => handleNudge('right')}
              className="py-2.5 px-3.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl font-bold text-xs text-slate-700 active:scale-95 transition-all cursor-pointer flex items-center gap-1"
              title="Move Right 1.5mm"
            >
              Right ▶
            </button>
          </div>
          
          <div className="text-[10px] font-semibold text-slate-400 text-center font-mono uppercase tracking-wider">
            Current Offset: X: <span className="text-orange-600 font-bold">{gridOffset.x.toFixed(1)}mm</span>, Y: <span className="text-orange-600 font-bold">{gridOffset.y.toFixed(1)}mm</span>
          </div>
        </div>

        {/* Big Print/Download printable PDF block */}
        <div id="pdf-export-card" className="bg-gradient-to-br from-orange-500 to-amber-500 rounded-2xl p-6 text-white shadow-lg shadow-orange-600/10 space-y-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-white/10 text-white mt-0.5 shrink-0">
              <Printer className="w-5 h-5 stroke-[2.5px]" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold tracking-tight">Printable PDF document (A4 Scale)</h3>
              <p className="text-orange-50 text-[11px] leading-relaxed mt-1 font-semibold">
                Generates a crisp, vectorized PDF configured at exactly 100% scale. Print instantly at home or any print lab on glossy photo paper.
              </p>
            </div>
          </div>

          <button
            id="download-pdf-btn"
            onClick={downloadPDF}
            disabled={isDownloading !== null}
            className="w-full py-4 bg-white hover:bg-orange-50 text-orange-950 font-extrabold text-xs tracking-wide uppercase rounded-xl transition-all shadow-md active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer"
          >
            {isDownloading === 'pdf' ? (
              <>
                <div className="w-4 h-4 border-2 border-orange-950 border-t-transparent rounded-full animate-spin" />
                <span>Generating high-res PDF pack...</span>
              </>
            ) : (
              <>
                <FileText className="w-4 h-4 text-orange-600 stroke-[2.5px]" />
                <span>Download Print-Ready PDF</span>
              </>
            )}
          </button>
        </div>

        {/* Helpful Print Guidelines */}
        <div id="print-guide-card" className="bg-white border border-slate-200 rounded-2xl p-5 text-xs text-slate-600 space-y-3 shadow-sm">
          <div className="font-bold text-slate-800 flex items-center gap-1.5">
            <CheckCircle className="w-4 h-4 text-orange-500 stroke-[2.5px]" />
            <span className="font-extrabold tracking-tight">Calibration Instructions</span>
          </div>
          <ul className="list-disc pl-4 space-y-1.5 text-slate-500 text-[11px] leading-relaxed font-semibold">
            <li>Select **A4 Paper Size** inside your system print configuration window.</li>
            <li>Verify scale is configured to **100%** (do not select "Fit to Page" or margin scaling).</li>
            <li>Employ high-quality glossy photopaper for government compliance.</li>
            <li>Cut precisely using a utility blade and ruler along the integrated tick marks.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

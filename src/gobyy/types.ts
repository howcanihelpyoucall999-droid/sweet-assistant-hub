export interface PassportSize {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  description: string;
}

export const PRESET_SIZES: PassportSize[] = [
  { id: 'standard', name: 'Standard EU / Schengen', widthMm: 35, heightMm: 45, description: '35 x 45 mm (UK, Schengen, Europe, India)' },
  { id: 'us', name: 'United States Passport', widthMm: 50.8, heightMm: 50.8, description: '2 x 2 inches (51 x 51 mm)' },
  { id: 'china', name: 'China Passport', widthMm: 33, heightMm: 48, description: '33 x 48 mm' },
  { id: 'custom', name: 'Custom Size', widthMm: 35, heightMm: 45, description: 'Define custom dimensions in mm' }
];

export interface BackgroundColor {
  id: string;
  name: string;
  hex: string;
}

export const PRESET_COLORS: BackgroundColor[] = [
  { id: 'white', name: 'Off-White', hex: '#FFFFFF' },
  { id: 'blue', name: 'Passport Blue', hex: '#0047AB' },
  { id: 'light-blue', name: 'Light Blue', hex: '#A1CAF1' },
  { id: 'light-gray', name: 'Light Gray', hex: '#F0F2F5' }
];

export interface EditorState {
  scale: number; // Zoom multiplier (1.0 = original)
  panX: number; // Horizontal offset in px
  panY: number; // Vertical offset in px
  rotation: number; // Rotation in degrees (usually 0)
  backgroundColor: string; // Hex color
  selectedSize: PassportSize;
  customWidthMm: number;
  customHeightMm: number;
  gridCount: number; // 4, 6, 8, 12, etc.
}

export interface ModelProgress {
  name: string;
  loaded: number;
  total: number;
  status: 'idle' | 'downloading' | 'compiling' | 'ready' | 'error';
}

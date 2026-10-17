// The four layout widths from SPEC page 1 (Responsive layout) and AGENTS.md.
export const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'desktop', width: 1920, height: 1080 },
] as const;

export const COLOR_SCHEMES = ['light', 'dark'] as const;

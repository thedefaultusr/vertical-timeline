/**
 * Default styles. Theme values are CSS custom properties on `.vt-root`; the
 * canvas colours are read from them too (see VerticalTimeline.refreshTheme),
 * so CSS is the single source of truth for both DOM and canvas.
 *
 * Defaults are wrapped in :where() (zero specificity), so any user rule such
 * as `.vt-root { --vt-accent: tomato }` overrides them.
 */
const LIGHT = `
  --vt-font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  --vt-bg: #fbfbfa;
  --vt-accent: #4a6fa5;
  --vt-axis-text: #6b6b66;
  --vt-grid-major: rgba(0, 0, 0, 0.10);
  --vt-grid-minor: rgba(0, 0, 0, 0.04);
  --vt-track: #d8d8d3;
  --vt-minimap-density: rgba(74, 111, 165, 0.55);
  --vt-minimap-viewport: rgba(74, 111, 165, 0.12);
  --vt-card-bg: #ffffff;
  --vt-card-border: #e4e4e0;
  --vt-card-text: #1d1d1b;
  --vt-card-muted: #6b6b66;
  --vt-card-radius: 8px;
  --vt-card-shadow: 0 4px 16px rgb(0 0 0 / 0.08);
  color-scheme: light;
`;

const DARK = `
  --vt-bg: #141517;
  --vt-accent: #7fa3d8;
  --vt-axis-text: #9b9c98;
  --vt-grid-major: rgba(255, 255, 255, 0.12);
  --vt-grid-minor: rgba(255, 255, 255, 0.05);
  --vt-track: #3a3d42;
  --vt-minimap-density: rgba(127, 163, 216, 0.5);
  --vt-minimap-viewport: rgba(127, 163, 216, 0.16);
  --vt-card-bg: #1d1f22;
  --vt-card-border: #33363b;
  --vt-card-text: #e6e6e3;
  --vt-card-muted: #9b9c98;
  --vt-card-shadow: 0 4px 18px rgb(0 0 0 / 0.45);
  color-scheme: dark;
`;

const CSS = `
:where(.vt-root) {${LIGHT}}
:where(.vt-root[data-theme="dark"]) {${DARK}}
@media (prefers-color-scheme: dark) {
  :where(.vt-root:not([data-theme="light"])) {${DARK}}
}
.vt-root {
  position: relative;
  display: flex;
  overflow: hidden;
  background: var(--vt-bg);
  font: var(--vt-font);
  color: var(--vt-card-text);
  touch-action: none;
  outline: none;
}
.vt-minimap {
  flex: none;
  cursor: grab;
  border-right: 1px solid var(--vt-card-border);
  user-select: none;
}
.vt-main {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.vt-body {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.vt-body > canvas {
  position: absolute;
  left: 0;
  top: 0;
  user-select: none;
}
.vt-connectors { pointer-events: none; }
.vt-cards {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 16px;
  max-width: 560px;
}
.vt-card {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  box-sizing: border-box;
  background: var(--vt-card-bg);
  border: 1px solid var(--vt-card-border);
  border-left: 3px solid var(--vt-item-color, var(--vt-accent));
  border-radius: var(--vt-card-radius);
  padding: 10px 12px;
  z-index: 1;
  will-change: transform;
  contain: layout style;
  transition: box-shadow 120ms, border-color 120ms;
}
.vt-card--compact { padding: 6px 10px; }
.vt-card--hover {
  border-color: var(--vt-item-color, var(--vt-accent));
  box-shadow: var(--vt-card-shadow);
}
.vt-card--selected {
  border-color: var(--vt-item-color, var(--vt-accent));
  box-shadow: 0 0 0 1px var(--vt-item-color, var(--vt-accent)), var(--vt-card-shadow);
}
.vt-card__date { color: var(--vt-card-muted); font-size: 11px; }
.vt-card__title { font-weight: 600; }
`;

let injected = false;

export function injectStyles(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const style = document.createElement('style');
  style.dataset.verticalTimeline = '';
  style.textContent = CSS;
  // First in <head>, so page styles loaded later win at equal specificity.
  document.head.prepend(style);
}

/** CSS custom property that feeds each canvas theme colour. */
export const THEME_VARS = {
  background: '--vt-bg',
  axisText: '--vt-axis-text',
  gridMajor: '--vt-grid-major',
  gridMinor: '--vt-grid-minor',
  track: '--vt-track',
  item: '--vt-accent',
  minimapDensity: '--vt-minimap-density',
  minimapViewport: '--vt-minimap-viewport',
} as const;

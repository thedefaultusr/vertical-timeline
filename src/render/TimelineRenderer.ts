import { scaleTime } from 'd3-scale';
import type { Viewport } from '../core/Viewport';
import type { StorylineColumn } from '../layout/storylines';
import type { Item, TimelineTheme } from '../types';
import { crisp, type HiDpiCanvas } from './canvas';

export interface NormalizedBand {
  start: number;
  end: number;
  color: string;
  label?: string;
}

export interface TrackGeometry {
  axisWidth: number;
  laneWidth: number;
  /** One per storyline (plus the main lane), indexed by Item.storyline. */
  columns: StorylineColumn[];
  /** Right edge of the track. */
  trackRight: number;
  /** Where grid lines stop (the cards' left edge). */
  gridRight: number;
}

export const POINT_R = 4;
const LABEL_FONT_SIZE = 11;
/** Keep sticky storyline labels this far inside the viewport / rail ends. */
const LABEL_INSET = 8;

interface LabelHit {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Left x of a span's bar, or null when its lane isn't drawn. */
export function spanX(geo: TrackGeometry, it: Item): number | null {
  const col = geo.columns[it.storyline];
  return it.lane < col.lanes ? col.laneX + it.lane * geo.laneWidth : null;
}

/** Where an item's connector starts: the dot's edge, or the bar's right edge. */
export function connectorX(geo: TrackGeometry, it: Item): number {
  const col = geo.columns[it.storyline];
  if (!it.isSpan) return col.pointX + POINT_R;
  const lane = Math.min(it.lane, Math.max(0, col.lanes - 1));
  return col.laneX + lane * geo.laneWidth + geo.laneWidth - 2;
}

/** Axis, grid, bands and event markers. */
export class TimelineRenderer {
  /** Storyline labels as last drawn, for hit testing. */
  private labels: LabelHit[] = [];

  constructor(
    private canvas: HiDpiCanvas,
    private theme: TimelineTheme,
  ) {}

  draw(
    vp: Viewport,
    geo: TrackGeometry,
    bands: NormalizedBand[],
    visible: Item[],
    hoverId: string | null,
    selectedId: string | null,
    hoverStorylineId: string | null,
  ): void {
    const ctx = this.canvas.begin();
    const w = this.canvas.width;
    const h = this.canvas.height;
    const theme = this.theme;

    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, w, h);

    // Bands (full width, behind everything).
    for (const b of bands) {
      if (b.end < vp.t0 || b.start > vp.t1) continue;
      const y0 = Math.max(-1, vp.timeToY(b.start));
      const y1 = Math.min(h + 1, vp.timeToY(b.end));
      ctx.fillStyle = b.color;
      ctx.fillRect(0, y0, w, y1 - y0);
      if (b.label && y1 - y0 > 16) {
        ctx.save();
        ctx.font = `600 10px ${theme.font}`;
        ctx.fillStyle = theme.axisText;
        ctx.globalAlpha = 0.7;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(b.label.toUpperCase(), geo.gridRight - 8, Math.max(y0, 0) + 4);
        ctx.restore();
      }
    }

    // Grid + axis labels.
    const scale = scaleTime().domain([new Date(vp.t0), new Date(vp.t1)]).range([0, h]);
    const majorCount = Math.max(2, Math.floor(h / 90));
    const major = scale.ticks(majorCount);
    const minor = scale.ticks(majorCount * 5);
    const format = scale.tickFormat(majorCount);

    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.gridMinor;
    ctx.beginPath();
    for (const d of minor) {
      const y = crisp(scale(d));
      ctx.moveTo(geo.axisWidth - 4, y);
      ctx.lineTo(geo.gridRight, y);
    }
    ctx.stroke();

    ctx.strokeStyle = theme.gridMajor;
    ctx.beginPath();
    for (const d of major) {
      const y = crisp(scale(d));
      ctx.moveTo(geo.axisWidth - 8, y);
      ctx.lineTo(geo.gridRight, y);
    }
    ctx.stroke();

    ctx.font = `11px ${theme.font}`;
    ctx.fillStyle = theme.axisText;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const d of major) ctx.fillText(format(d), geo.axisWidth - 12, scale(d));

    // Main lane spine, full height.
    const cols = geo.columns;
    ctx.strokeStyle = theme.track;
    ctx.lineWidth = 2;
    for (const col of cols) {
      if (!col.main || col.hidden) continue;
      ctx.beginPath();
      ctx.moveTo(col.pointX, 0);
      ctx.lineTo(col.pointX, h);
      ctx.stroke();
    }

    // Storyline rails: a line from the first to the last event, with caps,
    // and the title running down the rail, sticky while the rail is visible.
    this.labels = [];
    ctx.font = `600 ${LABEL_FONT_SIZE}px ${theme.font}`;
    for (const col of cols) {
      if (col.main || col.hidden || col.slot < 0 || col.end < vp.t0 || col.start > vp.t1) continue;
      const color = col.color ?? theme.item;
      const y0 = vp.timeToY(col.start);
      const y1 = Math.max(y0 + 1, vp.timeToY(col.end));
      const emphasized = col.id === hoverStorylineId;
      ctx.strokeStyle = color;
      ctx.globalAlpha = emphasized ? 0.7 : 0.35;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(col.pointX, Math.max(y0, -4));
      ctx.lineTo(col.pointX, Math.min(y1, h + 4));
      ctx.moveTo(col.pointX - 5, y0);
      ctx.lineTo(col.pointX + 5, y0);
      ctx.moveTo(col.pointX - 5, y1);
      ctx.lineTo(col.pointX + 5, y1);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.globalAlpha = 1;

      const top = Math.max(y0, 0) + LABEL_INSET;
      const room = Math.min(y1, h) - LABEL_INSET - top;
      if (room < 24) continue;
      const text = fitText(ctx, col.title, room);
      if (!text) continue;
      const len = ctx.measureText(text).width;
      ctx.save();
      ctx.translate(col.labelX, top);
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 0, 0);
      ctx.restore();
      const half = LABEL_FONT_SIZE / 2 + 2;
      this.labels.push({ id: col.id, x0: col.labelX - half, y0: top - 2, x1: col.labelX + half, y1: top + len + 2 });
    }

    // Markers, batched into one path per colour (thousands of markers would
    // otherwise be thousands of draw calls). Hovered / selected ones are
    // drawn last, on top, with their own style.
    const spans = new Map<string, Item[]>();
    const points = new Map<string, Item[]>();
    const emphasized: Item[] = [];
    for (const it of visible) {
      if (it.id === hoverId || it.id === selectedId) {
        emphasized.push(it);
        continue;
      }
      const byColor = it.isSpan ? spans : points;
      const color = it.color ?? theme.item;
      let list = byColor.get(color);
      if (!list) byColor.set(color, (list = []));
      list.push(it);
    }

    ctx.globalAlpha = 0.75;
    for (const [color, list] of spans) {
      ctx.beginPath();
      for (const it of list) this.spanPath(ctx, vp, geo, it);
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.lineWidth = 2;
    ctx.fillStyle = theme.background;
    for (const [color, list] of points) {
      ctx.beginPath();
      for (const it of list) pointPath(ctx, cols[it.storyline].pointX, vp.timeToY(it.start), POINT_R);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
    }

    for (const it of emphasized) {
      const color = it.color ?? theme.item;
      const selected = it.id === selectedId;
      ctx.beginPath();
      if (it.isSpan) {
        if (!this.spanPath(ctx, vp, geo, it)) continue;
        ctx.fillStyle = color;
        ctx.fill();
        if (selected) {
          const x = spanX(geo, it)!;
          const y0 = vp.timeToY(it.start);
          const y1 = Math.max(y0 + 2, vp.timeToY(it.end));
          ctx.beginPath();
          ctx.roundRect(x - 0.5, y0 - 1.5, geo.laneWidth + 1, y1 - y0 + 3, 4);
          ctx.strokeStyle = theme.axisText;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      } else {
        pointPath(ctx, cols[it.storyline].pointX, vp.timeToY(it.start), POINT_R + 2);
        ctx.fillStyle = selected ? color : theme.background;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  /** Adds a span's bar to the current path; false if its lane isn't drawn. */
  private spanPath(ctx: CanvasRenderingContext2D, vp: Viewport, geo: TrackGeometry, it: Item): boolean {
    const x = spanX(geo, it);
    if (x === null) return false;
    const y0 = vp.timeToY(it.start);
    const h = Math.max(2, vp.timeToY(it.end) - y0);
    const w = geo.laneWidth - 2;
    ctx.roundRect(x + 1, y0, w, h, Math.min(3, w / 2, h / 2));
    return true;
  }

  /** Returns the id of the storyline whose label is under (x, y), if any. */
  labelAt(x: number, y: number): string | null {
    for (const l of this.labels) if (x >= l.x0 && x <= l.x1 && y >= l.y0 && y <= l.y1) return l.id;
    return null;
  }

  /** Returns the id of the event marker under (x, y), if any. */
  hitTest(vp: Viewport, geo: TrackGeometry, visible: Item[], x: number, y: number): string | null {
    let best: string | null = null;
    let bestD = 8;
    for (const it of visible) {
      if (it.isSpan) {
        const lx = spanX(geo, it);
        if (lx === null) continue;
        const y0 = vp.timeToY(it.start);
        const y1 = Math.max(y0 + 2, vp.timeToY(it.end));
        if (x >= lx - 2 && x <= lx + geo.laneWidth + 2 && y >= y0 - 2 && y <= y1 + 2) return it.id;
      } else {
        const d = Math.hypot(x - geo.columns[it.storyline].pointX, y - vp.timeToY(it.start));
        if (d < bestD) {
          bestD = d;
          best = it.id;
        }
      }
    }
    return best;
  }
}

/** Adds a circle as its own subpath (no line joining it to the previous one). */
function pointPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

/** `text`, truncated with an ellipsis to fit `max` px; '' if not even that fits. */
function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo).trimEnd() + '…' : '';
}

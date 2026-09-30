import type { Item, TimelineTheme } from '../types';
import type { HiDpiCanvas } from './canvas';

export interface Connector {
  item: Item;
  /** Event end of the connector (marker on the track). */
  x0: number;
  y0: number;
  /** Card end of the connector. */
  y1: number;
}

/**
 * Curves linking event markers to their cards. The canvas spans from the
 * timeline's left edge to the cards' left edge, so connectors end at its
 * right edge.
 */
export class ConnectorRenderer {
  constructor(
    private canvas: HiDpiCanvas,
    private theme: TimelineTheme,
  ) {}

  draw(connectors: Connector[], hoverId: string | null, selectedId: string | null): void {
    const ctx = this.canvas.begin();
    const x1 = this.canvas.width;
    const h = this.canvas.height;

    ctx.lineCap = 'round';
    // Draw emphasized connectors last so they sit on top.
    const rank = (c: Connector) => (c.item.id === hoverId ? 2 : c.item.id === selectedId ? 1 : 0);
    const ordered = hoverId || selectedId ? [...connectors].sort((a, b) => rank(a) - rank(b)) : connectors;

    for (const c of ordered) {
      if ((c.y0 < -h && c.y1 < -h) || (c.y0 > 2 * h && c.y1 > 2 * h)) continue;
      const hover = c.item.id === hoverId || c.item.id === selectedId;
      const color = c.item.color ?? this.theme.item;
      ctx.strokeStyle = color;
      ctx.globalAlpha = hover ? 1 : hoverId && hoverId !== selectedId ? 0.25 : 0.6;
      ctx.lineWidth = hover ? 2 : 1.25;

      const xs = c.x0 + 2;
      const dx = (x1 - xs) * 0.5;
      ctx.beginPath();
      ctx.moveTo(xs, c.y0);
      ctx.bezierCurveTo(xs + dx, c.y0, x1 - dx, c.y1, x1, c.y1);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x1 - 1, c.y1, hover ? 3 : 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

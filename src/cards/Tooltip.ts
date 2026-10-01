import type { Item, RenderTooltip } from '../types';

/** Space kept between the tooltip and the edges of its container, px. */
const MARGIN = 4;

/**
 * A tooltip for a hovered event whose card isn't shown. One element, reused;
 * its content is rendered only when the event changes, and it's repositioned
 * every frame so it follows the event while scrolling or zooming.
 */
export class Tooltip {
  readonly el: HTMLDivElement;
  private itemId: string | null = null;
  private cleanup: (() => void) | undefined;

  constructor(
    parent: HTMLElement,
    private render: RenderTooltip,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'vt-tooltip';
    this.el.setAttribute('role', 'tooltip');
    this.el.hidden = true;
    parent.appendChild(this.el);
  }

  /**
   * Shows the tooltip for `item`, vertically centred on y with its left edge
   * at x, kept inside a container of the given size.
   */
  show(item: Item, x: number, y: number, width: number, height: number): void {
    if (item.id !== this.itemId) {
      this.clear();
      this.itemId = item.id;
      if (item.color) this.el.style.setProperty('--vt-item-color', item.color);
      else this.el.style.removeProperty('--vt-item-color');
      this.cleanup = this.render(item.src, this.el) || undefined;
    }
    this.el.hidden = false;
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const left = Math.max(MARGIN, Math.min(x, width - w - MARGIN));
    const top = Math.max(MARGIN, Math.min(y - h / 2, height - h - MARGIN));
    this.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  hide(): void {
    if (this.itemId === null) return;
    this.clear();
    this.el.hidden = true;
  }

  destroy(): void {
    this.clear();
    this.el.remove();
  }

  private clear(): void {
    this.cleanup?.();
    this.cleanup = undefined;
    this.el.replaceChildren();
    this.itemId = null;
  }
}

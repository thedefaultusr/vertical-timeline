import type { CardLod, Item, RenderCard } from '../types';

export interface MountedCard {
  item: Item;
  el: HTMLDivElement;
  lod: CardLod;
  height: number;
  /** Top of the card in viewport px, set by place(). */
  y: number;
  /** Eased offset from the layout target, px; > 0 while sliding up. */
  offset: number;
  cleanup: (() => void) | undefined;
}

export interface CardRequest {
  item: Item;
  lod: CardLod;
}

/**
 * Virtualized DOM cards. Only requested cards are mounted; their content is
 * produced by the user's renderCard. Cards are positioned exclusively with
 * transforms so zoom/pan never triggers layout of card content.
 */
export class CardLayer {
  readonly el: HTMLDivElement;
  private mounted = new Map<string, MountedCard>();
  private pool: HTMLDivElement[] = [];
  private resizeObserver: ResizeObserver;
  private hoverId: string | null = null;
  private selectedId: string | null = null;

  constructor(
    parent: HTMLElement,
    private renderCard: RenderCard,
    private onInvalidate: () => void,
    private onHover: (id: string | null) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'vt-cards';
    parent.appendChild(this.el);

    this.resizeObserver = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const card = this.mounted.get((entry.target as HTMLElement).dataset.id!);
        // The entry already carries the size; rounded like offsetHeight (used
        // when mounting) so the two agree.
        const h = Math.round(entry.borderBoxSize[0].blockSize);
        if (card && h !== card.height) {
          card.height = h;
          changed = true;
        }
      }
      if (changed) this.onInvalidate();
    });

    this.el.addEventListener('pointerover', (e) => this.onHover(this.cardIdFrom(e.target)));
    this.el.addEventListener('pointerleave', () => this.onHover(null));
  }

  get(id: string): MountedCard | undefined {
    return this.mounted.get(id);
  }

  /**
   * Mounts, re-renders and unmounts so exactly `requests` are present.
   * New cards are measured in one batch (a single forced layout).
   */
  sync(requests: CardRequest[]): MountedCard[] {
    const wanted = new Set<string>();
    for (const r of requests) wanted.add(r.item.id);

    for (const [id, card] of this.mounted) {
      if (!wanted.has(id)) this.unmount(card);
    }

    const result: MountedCard[] = [];
    const toMeasure: MountedCard[] = [];
    for (const { item, lod } of requests) {
      let card = this.mounted.get(item.id);
      if (!card) {
        const el = this.pool.pop() ?? document.createElement('div');
        el.dataset.id = item.id;
        card = { item, el, lod, height: 0, y: NaN, offset: 0, cleanup: undefined };
        this.mounted.set(item.id, card);
        this.render(card);
        this.el.appendChild(el);
        this.resizeObserver.observe(el);
        toMeasure.push(card);
      } else if (card.lod !== lod) {
        card.lod = lod;
        this.render(card);
        toMeasure.push(card);
      }
      result.push(card);
    }

    for (const card of toMeasure) card.height = card.el.offsetHeight;
    return result;
  }

  place(card: MountedCard, y: number): void {
    if (card.y !== y) {
      card.y = y;
      card.el.style.transform = `translate3d(0, ${y}px, 0)`;
    }
    // Cards sliding up pass behind their neighbours; sliding down, in front.
    const z = card.offset > 0 ? '0' : card.offset < 0 ? '2' : '1';
    if (card.el.style.zIndex !== z) card.el.style.zIndex = z;
  }

  setHighlight(id: string | null): void {
    this.hoverId = id;
    for (const card of this.mounted.values()) this.applyState(card);
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
    for (const card of this.mounted.values()) this.applyState(card);
  }

  private applyState(card: MountedCard): void {
    card.el.classList.toggle('vt-card--hover', card.item.id === this.hoverId);
    card.el.classList.toggle('vt-card--selected', card.item.id === this.selectedId);
  }

  destroy(): void {
    for (const card of [...this.mounted.values()]) this.unmount(card);
    this.resizeObserver.disconnect();
    this.el.remove();
  }

  private render(card: MountedCard): void {
    card.cleanup?.();
    card.el.replaceChildren();
    card.el.className = `vt-card vt-card--${card.lod}`;
    if (card.item.color) card.el.style.setProperty('--vt-item-color', card.item.color);
    else card.el.style.removeProperty('--vt-item-color');
    card.cleanup = this.renderCard(card.item.src, card.el, card.lod) || undefined;
    this.applyState(card);
  }

  private unmount(card: MountedCard): void {
    card.cleanup?.();
    this.resizeObserver.unobserve(card.el);
    card.el.remove();
    card.el.replaceChildren();
    this.mounted.delete(card.item.id);
    if (this.pool.length < 64) this.pool.push(card.el);
  }

  private cardIdFrom(target: EventTarget | null): string | null {
    const el = (target as HTMLElement | null)?.closest?.('.vt-card') as HTMLElement | null;
    return el?.dataset.id ?? null;
  }
}

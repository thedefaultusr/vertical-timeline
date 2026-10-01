/** Elements that take text input. `contenteditable="false"` marks content that is not editable. */
export const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** Elements that handle clicks themselves. */
export const INTERACTIVE = `a, button, label, ${EDITABLE}`;

/**
 * The closest element matching `selector` from `target` up to `within`, or null. Matching ancestors
 * outside `within` don't count: the timeline may be embedded in editable content (e.g. a
 * contenteditable editor) without everything in it acting like an input.
 */
export function closestWithin(target: EventTarget | null, selector: string, within: Element): Element | null {
  const match = (target as Element | null)?.closest?.(selector);
  return match && within.contains(match) ? match : null;
}

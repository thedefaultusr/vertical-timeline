/** Per-box limits on the top position: lo[i] <= top[i] <= hi[i]. */
export interface DodgeBounds {
  lo: ArrayLike<number>;
  hi: ArrayLike<number>;
}

/**
 * 1-D non-overlapping placement. Given boxes sorted by desired top position,
 * returns tops such that boxes keep their order, don't overlap (with `gap`
 * between them), stay within their optional bounds, and the sum of squared
 * displacements is minimal.
 *
 * Block-merge (pool-adjacent-violators): each box starts as its own block
 * placed at its desired position; while a block overlaps its predecessor the
 * two merge. A block sits at the mean of its members' desired positions
 * (adjusted for their offsets within the block), clamped to the range its
 * members' bounds allow; the clamped mean is the block's optimum, so PAV stays
 * exact. If a block's bounds conflict (e.g. a box taller than the space), its
 * lower bound wins. O(n) amortized.
 *
 * The result is continuous in the inputs, so cards glide while zooming.
 */
export function dodge(
  desired: ArrayLike<number>,
  heights: ArrayLike<number>,
  gap: number,
  bounds?: DodgeBounds,
  out: Float64Array = new Float64Array(desired.length),
): Float64Array {
  const n = desired.length;
  // Block stack. For block k: first member index, member count, total height
  // (including inner gaps), sum of (desired_i - offset_i within block), and
  // the range of block tops all members' bounds allow.
  const first = new Int32Array(n);
  const count = new Int32Array(n);
  const size = new Float64Array(n);
  const sum = new Float64Array(n);
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  const pos = (k: number) => Math.max(lo[k], Math.min(sum[k] / count[k], hi[k]));
  let top = -1;

  for (let i = 0; i < n; i++) {
    top++;
    first[top] = i;
    count[top] = 1;
    size[top] = heights[i];
    sum[top] = desired[i];
    lo[top] = bounds ? bounds.lo[i] : -Infinity;
    hi[top] = bounds ? bounds.hi[i] : Infinity;

    while (top > 0) {
      const prev = top - 1;
      if (pos(prev) + size[prev] + gap <= pos(top)) break;
      // Merge top into prev: its members shift down by prev's size + gap.
      const shift = size[prev] + gap;
      sum[prev] += sum[top] - count[top] * shift;
      count[prev] += count[top];
      size[prev] += gap + size[top];
      lo[prev] = Math.max(lo[prev], lo[top] - shift);
      hi[prev] = Math.min(hi[prev], hi[top] - shift);
      top--;
    }
  }

  for (let k = 0; k <= top; k++) {
    let y = pos(k);
    const end = first[k] + count[k];
    for (let i = first[k]; i < end; i++) {
      out[i] = y;
      y += heights[i] + gap;
    }
  }
  return out;
}

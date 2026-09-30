/**
 * 1-D non-overlapping placement. Given boxes sorted by desired top position,
 * returns tops such that boxes keep their order, don't overlap (with `gap`
 * between them), and the sum of squared displacements is minimal.
 *
 * Block-merge (pool-adjacent-violators): each box starts as its own block
 * placed at its desired position; while a block overlaps its predecessor the
 * two merge and the merged block sits at the mean of its members' desired
 * positions (adjusted for their offsets within the block). O(n) amortized.
 *
 * The result is continuous in the inputs, so cards glide while zooming.
 */
export function dodge(
  desired: ArrayLike<number>,
  heights: ArrayLike<number>,
  gap: number,
  out: Float64Array = new Float64Array(desired.length),
): Float64Array {
  const n = desired.length;
  // Block stack. For block k: first member index, member count, total height
  // (including inner gaps), and sum of (desired_i - offset_i within block).
  const first = new Int32Array(n);
  const count = new Int32Array(n);
  const size = new Float64Array(n);
  const sum = new Float64Array(n);
  let top = -1;

  for (let i = 0; i < n; i++) {
    top++;
    first[top] = i;
    count[top] = 1;
    size[top] = heights[i];
    sum[top] = desired[i];

    while (top > 0) {
      const prev = top - 1;
      const prevPos = sum[prev] / count[prev];
      const curPos = sum[top] / count[top];
      if (prevPos + size[prev] + gap <= curPos) break;
      // Merge top into prev: its members shift down by prev's size + gap.
      const shift = size[prev] + gap;
      sum[prev] += sum[top] - count[top] * shift;
      count[prev] += count[top];
      size[prev] += gap + size[top];
      top--;
    }
  }

  for (let k = 0; k <= top; k++) {
    let y = sum[k] / count[k];
    const end = first[k] + count[k];
    for (let i = first[k]; i < end; i++) {
      out[i] = y;
      y += heights[i] + gap;
    }
  }
  return out;
}

export const canvas = document.getElementById('c') as HTMLCanvasElement;
export const ctx = canvas.getContext('2d')!;

/** Matches the backing store to the window size and DPI. */
export function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(innerWidth * dpr);
  const h = Math.round(innerHeight * dpr);
  // Assigning canvas.width clears the canvas even if unchanged, which shows as a blank frame.
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w;
  canvas.height = h;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

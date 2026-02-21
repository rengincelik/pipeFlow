'use strict';

// ═══════════════════════════════════════════════════════════
// INTERPOLASYON — tablo + monotone cubic spline
// ═══════════════════════════════════════════════════════════

/** İki nokta arası linear interpolasyon */
export function lerp(x, x0, x1, y0, y1) {
  if (x1 === x0) return y0;
  return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
}

/**
 * Sıralı tablo üzerinde linear interpolasyon.
 * Kapsam dışı → clamp (extrapolate:true ile ekstrapolasyon).
 * @returns {{ value:number, clamped:boolean, warning:string|null }}
 */
export function tableInterp(xs, ys, x, { extrapolate = false } = {}) {
  const n = xs.length;
  if (n === 0) throw new Error('tableInterp: boş tablo');

  if (x <= xs[0]) {
    if (!extrapolate) return { value: ys[0], clamped: true, warning: `clamp @ ${xs[0]}` };
    return { value: lerp(x, xs[0], xs[1], ys[0], ys[1]), clamped: false, warning: `extrapolate < ${xs[0]}` };
  }
  if (x >= xs[n - 1]) {
    if (!extrapolate) return { value: ys[n - 1], clamped: true, warning: `clamp @ ${xs[n-1]}` };
    return { value: lerp(x, xs[n-2], xs[n-1], ys[n-2], ys[n-1]), clamped: false, warning: `extrapolate > ${xs[n-1]}` };
  }

  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; xs[m] <= x ? lo = m : hi = m; }
  return { value: lerp(x, xs[lo], xs[hi], ys[lo], ys[hi]), clamped: false, warning: null };
}

/**
 * Fritsch-Carlson monotone cubic spline.
 * Aşım yok, pürüzsüz. n<3 ise tableInterp'e düşer.
 * @returns {{ value:number, clamped:boolean, warning:string|null }}
 */
export function splineInterp(xs, ys, x, opts = {}) {
  const n = xs.length;
  if (n < 3) return tableInterp(xs, ys, x, opts);

  const { extrapolate = false } = opts;
  if (x <= xs[0])     return extrapolate
    ? { value: lerp(x, xs[0], xs[1], ys[0], ys[1]), clamped: false, warning: `extrapolate < ${xs[0]}` }
    : { value: ys[0],     clamped: true,  warning: `clamp @ ${xs[0]}` };
  if (x >= xs[n - 1]) return extrapolate
    ? { value: lerp(x, xs[n-2], xs[n-1], ys[n-2], ys[n-1]), clamped: false, warning: `extrapolate > ${xs[n-1]}` }
    : { value: ys[n - 1], clamped: true,  warning: `clamp @ ${xs[n-1]}` };

  // Fritsch-Carlson türevleri
  const h = [], delta = [];
  for (let i = 0; i < n - 1; i++) {
    h[i]     = xs[i + 1] - xs[i];
    delta[i] = (ys[i + 1] - ys[i]) / h[i];
  }
  const m = new Array(n);
  m[0]     = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] * delta[i] <= 0) { m[i] = 0; continue; }
    const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
    m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
  }
  // monotonluk güvencesi
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(delta[i]) < 1e-10) { m[i] = m[i + 1] = 0; continue; }
    const alpha = m[i] / delta[i], beta = m[i + 1] / delta[i];
    const tau = alpha * alpha + beta * beta;
    if (tau > 9) {
      const s = 3 * delta[i] / Math.sqrt(tau);
      m[i] = s * alpha; m[i + 1] = s * beta;
    }
  }

  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; xs[mid] <= x ? lo = mid : hi = mid; }

  const t = (x - xs[lo]) / h[lo], t2 = t * t, t3 = t2 * t;
  return {
    value:   (2*t3 - 3*t2 + 1) * ys[lo]
           + (t3 - 2*t2 + t)   * h[lo] * m[lo]
           + (-2*t3 + 3*t2)    * ys[hi]
           + (t3 - t2)         * h[lo] * m[hi],
    clamped: false,
    warning: null,
  };
}

/**
 * interpolate.js
 * Tablo verisinden değer hesaplama.
 * Bağımlılık yok — saf JS.
 */

'use strict';

/**
 * Linear interpolasyon (iki nokta arası).
 */
function linearInterp(x, x0, x1, y0, y1) {
  if (x1 === x0) return y0;
  return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
}

/**
 * Sıralanmış tablo üzerinde linear interpolasyon.
 * Tablo dışı → clamp + uyarı.
 *
 * @param {number[]} xs    - X ekseni (artan sıralı)
 * @param {number[]} ys    - Y değerleri
 * @param {number}   x     - Sorgu noktası
 * @param {object}   opts  - { extrapolate: bool }
 * @returns {{ value: number, clamped: boolean, warning: string|null }}
 */
function tableInterp(xs, ys, x, opts = {}) {
  const n = xs.length;
  if (n === 0) throw new Error('interpolate: boş tablo');
  if (n !== ys.length) throw new Error('interpolate: xs ve ys uzunluk uyumsuz');

  if (x <= xs[0]) {
    if (!opts.extrapolate)
      return { value: ys[0], clamped: true, warning: `${x} < min (${xs[0]}), clamp uygulandı` };
    return { value: linearInterp(x, xs[0], xs[1], ys[0], ys[1]), clamped: false,
             warning: `Ekstrapolasyon: ${x} < ${xs[0]}` };
  }
  if (x >= xs[n - 1]) {
    if (!opts.extrapolate)
      return { value: ys[n-1], clamped: true, warning: `${x} > max (${xs[n-1]}), clamp uygulandı` };
    return { value: linearInterp(x, xs[n-2], xs[n-1], ys[n-2], ys[n-1]), clamped: false,
             warning: `Ekstrapolasyon: ${x} > ${xs[n-1]}` };
  }

  // Binary search
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid; else hi = mid;
  }

  return { value: linearInterp(x, xs[lo], xs[hi], ys[lo], ys[hi]), clamped: false, warning: null };
}

/**
 * Monotone cubic spline (Fritsch-Carlson).
 * Aşım yok, pürüzsüz. Tercihen bu kullanılır.
 */
function cubicSplineInterp(xs, ys, x, opts = {}) {
  const n = xs.length;
  if (n < 3) return tableInterp(xs, ys, x, opts);

  if (x <= xs[0]) {
    if (!opts.extrapolate) return { value: ys[0], clamped: true, warning: `Clamp: ${x} < ${xs[0]}` };
  }
  if (x >= xs[n - 1]) {
    if (!opts.extrapolate) return { value: ys[n-1], clamped: true, warning: `Clamp: ${x} > ${xs[n-1]}` };
  }

  const h = [], delta = [];
  for (let i = 0; i < n - 1; i++) {
    h[i]     = xs[i+1] - xs[i];
    delta[i] = (ys[i+1] - ys[i]) / h[i];
  }

  // Fritsch-Carlson türevleri
  const m = new Array(n);
  m[0]     = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (delta[i-1] * delta[i] <= 0) { m[i] = 0; continue; }
    const w1 = 2*h[i] + h[i-1];
    const w2 = h[i] + 2*h[i-1];
    m[i] = (w1 + w2) / (w1/delta[i-1] + w2/delta[i]);
  }

  // Monotonluk güvencesi
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(delta[i]) < 1e-10) { m[i] = m[i+1] = 0; continue; }
    const alpha = m[i]   / delta[i];
    const beta  = m[i+1] / delta[i];
    const tau   = alpha*alpha + beta*beta;
    if (tau > 9) {
      const s = 3 * delta[i] / Math.sqrt(tau);
      m[i]   = s * alpha;
      m[i+1] = s * beta;
    }
  }

  // Bracket
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid; else hi = mid;
  }

  const t  = (x - xs[lo]) / h[lo];
  const t2 = t*t, t3 = t2*t;

  return {
    value:   (2*t3 - 3*t2 + 1) * ys[lo]
           + (t3 - 2*t2 + t)   * h[lo] * m[lo]
           + (-2*t3 + 3*t2)    * ys[hi]
           + (t3 - t2)         * h[lo] * m[hi],
    clamped: false,
    warning: null,
  };
}

export { linearInterp, tableInterp, cubicSplineInterp };

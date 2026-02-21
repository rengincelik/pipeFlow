'use strict';

// ═══════════════════════════════════════════════════════════
// CHART RENDERER — Basınç & Hız profili (Canvas 2D)
// ═══════════════════════════════════════════════════════════

const PAD   = { top: 18, right: 16, bottom: 28, left: 44 };
const C_P   = '#4a9eff';   // basınç çizgisi
const C_V   = '#34d399';   // hız çizgisi
const C_BG  = '#080909';
const C_GRID= 'rgba(255,255,255,0.04)';
const C_AX  = 'rgba(255,255,255,0.12)';
const C_TXT = '#424858';
const FONT  = "9px 'IBM Plex Mono', monospace";

export class ChartRenderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this._ro     = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas.parentElement);
    this._resize();
  }

  _resize() {
    const parent = this.canvas.parentElement;
    const dpr    = window.devicePixelRatio || 1;
    const w      = parent.clientWidth;
    const h      = parent.clientHeight;
    this.canvas.width  = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width  = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.scale(dpr, dpr);
    this._cw = w;
    this._ch = h;
    if (this._lastData) this.draw(this._lastData);
  }

  /** @param {{ results, components }} data */
  draw(data) {
    this._lastData = data;
    const { results, components } = data;
    const ctx = this.ctx;
    const W = this._cw, H = this._ch;
    const pl = PAD.left, pr = PAD.right, pt = PAD.top, pb = PAD.bottom;
    const gw = W - pl - pr;   // grafik genişliği
    const gh = H - pt - pb;   // grafik yüksekliği

    // ── Temizle ────────────────────────────────────────────
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = C_BG;
    ctx.fillRect(0, 0, W, H);

    if (!results || results.length === 0) return;

    // ── Veri noktaları ─────────────────────────────────────
    // Her kompanent için: x = kümülatif konum, P_in, P_out, v
    // X ekseni: eleman indeksi değil, kümülatif uzunluk (daha anlamlı)

    const N = results.length;

    // Kümülatif uzunluk hesapla
    let cumLen = [0];
    let total  = 0;
    components.forEach((comp, i) => {
      const len = comp._overrides?.length_m ?? comp.resolve?.('length_m') ?? 1;
      total += Number(len) || 1;
      cumLen.push(total);
    });

    // Basınç noktaları: her elemanın girişi ve çıkışı
    const pPoints = [];
    results.forEach((r, i) => {
      pPoints.push({ x: cumLen[i],     y: r.P_in  ?? 0 });
      pPoints.push({ x: cumLen[i + 1], y: r.P_out ?? 0 });
    });

    // Hız noktaları: her eleman ortasında
    const vPoints = results.map((r, i) => ({
      x: (cumLen[i] + cumLen[i + 1]) / 2,
      y: r.v ?? 0,
    }));

    // ── Scale ──────────────────────────────────────────────
    const pAll   = pPoints.map(p => p.y).filter(isFinite);
    const vAll   = vPoints.map(p => p.y).filter(isFinite);

    const pMin   = Math.min(0, ...pAll);
    const pMax   = Math.max(0.1, ...pAll) * 1.12;
    const vMax   = Math.max(0.1, ...vAll) * 1.15;
    const xMax   = total;

    const toX  = x  => pl + (x  / xMax)  * gw;
    const toYp = yp => pt + gh - ((yp - pMin) / (pMax - pMin)) * gh;
    const toYv = yv => pt + gh - (yv / vMax) * gh;

    // ── Grid ───────────────────────────────────────────────
    ctx.strokeStyle = C_GRID;
    ctx.lineWidth   = 1;

    // Yatay grid (basınç tarafı, 4 çizgi)
    for (let i = 0; i <= 4; i++) {
      const y = pt + (gh / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pl, y);
      ctx.lineTo(pl + gw, y);
      ctx.stroke();
    }

    // Dikey grid (eleman sınırları)
    cumLen.forEach(x => {
      const px = toX(x);
      ctx.beginPath();
      ctx.moveTo(px, pt);
      ctx.lineTo(px, pt + gh);
      ctx.stroke();
    });

    // ── Eksenler ───────────────────────────────────────────
    ctx.strokeStyle = C_AX;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(pl, pt); ctx.lineTo(pl, pt + gh);         // Y ekseni
    ctx.moveTo(pl, pt + gh); ctx.lineTo(pl + gw, pt + gh); // X ekseni
    ctx.stroke();

    // ── Eksen etiketleri ───────────────────────────────────
    ctx.fillStyle = C_TXT;
    ctx.font      = FONT;
    ctx.textAlign = 'right';

    // Basınç (sol eksen)
    for (let i = 0; i <= 4; i++) {
      const val = pMin + (pMax - pMin) * (1 - i / 4);
      const y   = pt + (gh / 4) * i;
      ctx.fillText(val.toFixed(2), pl - 4, y + 3);
    }

    // X ekseni — eleman isimleri
    ctx.textAlign = 'center';
    components.forEach((comp, i) => {
      const mx  = toX((cumLen[i] + cumLen[i + 1]) / 2);
      const lbl = (comp.name || comp.subtype || '?').slice(0, 6);
      ctx.fillText(lbl, mx, pt + gh + 16);
    });

    // Hız (sağ eksen)
    ctx.textAlign = 'left';
    for (let i = 0; i <= 3; i++) {
      const val = vMax * (1 - i / 3);
      const y   = pt + (gh / 3) * i;
      if (i > 0) ctx.fillText(val.toFixed(2), pl + gw + 4, y + 3);
    }

    // ── Sıfır çizgisi (negatif P varsa) ───────────────────
    if (pMin < 0) {
      const y0 = toYp(0);
      ctx.strokeStyle = 'rgba(248,113,113,0.25)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pl, y0); ctx.lineTo(pl + gw, y0);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Eleman bölge renklendirmesi ────────────────────────
    const zoneColors = {
      pipe:  'rgba(74,158,255,0.03)',
      elbow: 'rgba(251,191,36,0.03)',
      valve: 'rgba(251,146,60,0.04)',
      pump:  'rgba(52,211,153,0.04)',
    };
    components.forEach((comp, i) => {
      const x1 = toX(cumLen[i]);
      const x2 = toX(cumLen[i + 1]);
      ctx.fillStyle = zoneColors[comp.type] ?? 'rgba(255,255,255,0.02)';
      ctx.fillRect(x1, pt, x2 - x1, gh);
    });

    // ── Basınç eğrisi ──────────────────────────────────────
    ctx.strokeStyle = C_P;
    ctx.lineWidth   = 1.5;
    ctx.lineJoin    = 'round';
    ctx.setLineDash([]);
    ctx.beginPath();
    pPoints.forEach(({ x, y }, i) => {
      if (!isFinite(y)) return;
      i === 0 ? ctx.moveTo(toX(x), toYp(y)) : ctx.lineTo(toX(x), toYp(y));
    });
    ctx.stroke();

    // Basınç alan dolgusu
    ctx.save();
    ctx.beginPath();
    pPoints.forEach(({ x, y }, i) => {
      if (!isFinite(y)) return;
      i === 0 ? ctx.moveTo(toX(x), toYp(y)) : ctx.lineTo(toX(x), toYp(y));
    });
    const lastP = pPoints.at(-1);
    if (lastP && isFinite(lastP.y)) {
      ctx.lineTo(toX(lastP.x), pt + gh);
      ctx.lineTo(pl, pt + gh);
      ctx.closePath();
    }
    ctx.fillStyle = 'rgba(74,158,255,0.06)';
    ctx.fill();
    ctx.restore();

    // Basınç noktaları
    ctx.fillStyle = C_P;
    pPoints.filter((_, i) => i % 2 === 0).forEach(({ x, y }) => {
      if (!isFinite(y)) return;
      ctx.beginPath();
      ctx.arc(toX(x), toYp(y), 2.5, 0, Math.PI * 2);
      ctx.fill();
    });

    // ── Hız eğrisi (kesikli, sağ eksen) ───────────────────
    ctx.strokeStyle = C_V;
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    vPoints.forEach(({ x, y }, i) => {
      i === 0 ? ctx.moveTo(toX(x), toYv(y)) : ctx.lineTo(toX(x), toYv(y));
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Hız noktaları
    ctx.fillStyle = C_V;
    vPoints.forEach(({ x, y }) => {
      ctx.beginPath();
      ctx.arc(toX(x), toYv(y), 2, 0, Math.PI * 2);
      ctx.fill();
    });

    // ── Seçili eleman vurgusu ──────────────────────────────
    if (data.selectedIdx != null) {
      const i  = data.selectedIdx;
      const x1 = toX(cumLen[i]);
      const x2 = toX(cumLen[i + 1]);
      ctx.fillStyle = 'rgba(240,165,0,0.08)';
      ctx.fillRect(x1, pt, x2 - x1, gh);
      ctx.strokeStyle = 'rgba(240,165,0,0.4)';
      ctx.lineWidth   = 1;
      ctx.strokeRect(x1, pt, x2 - x1, gh);
    }

    // ── Eksen birimleri ────────────────────────────────────
    ctx.fillStyle = C_TXT;
    ctx.font      = FONT;
    ctx.textAlign = 'right';
    ctx.fillText('bar', pl - 4, pt - 4);
    ctx.textAlign = 'left';
    ctx.fillText('m/s', pl + gw + 4, pt - 4);
  }

  clear() {
    this._lastData = null;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this._cw, this._ch);
    ctx.fillStyle = C_BG;
    ctx.fillRect(0, 0, this._cw, this._ch);
  }

  destroy() { this._ro.disconnect(); }
}

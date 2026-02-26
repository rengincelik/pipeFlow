'use strict';

// ═══════════════════════════════════════════════════════════
// CHART RENDERER — Basınç & Hız profili + Major/Minor kayıp
// Canvas 2D — engine snapshot formatını bekler
// ═══════════════════════════════════════════════════════════

const PAD    = { top: 18, right: 16, bottom: 80, left: 44 };  // bottom artırıldı (bar + legend için)
const C_P    = '#4a9eff';
const C_V    = '#34d399';
const C_MAJ  = 'rgba(248,113,113,0.75)';   // major kayıp — kırmızı
const C_MIN  = 'rgba(251,191,36,0.75)';    // minor kayıp — sarı
const C_BG   = '#080909';
const C_GRID = 'rgba(255,255,255,0.04)';
const C_AX   = 'rgba(255,255,255,0.12)';
const C_TXT  = '#424858';
const FONT   = "9px 'IBM Plex Mono', monospace";

// Bar şeridi yüksekliği (px) — grafik altında sabit alan
const BAR_H       = 28;
const BAR_PAD_TOP = 8;   // basınç grafiği ile bar arasındaki boşluk

export class ChartRenderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas   = canvas;
    this.ctx      = canvas.getContext('2d');
    this._ro      = new ResizeObserver(() => this._resize());
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

  /**
   * Ana çizim fonksiyonu.
   * @param {{ results, components, selectedIdx }} data
   *   results[i] = { P_in, P_out, v, dP_major, dP_minor }  (bar cinsinden)
   */
  draw(data) {
    this._lastData = data;
    const { results, components } = data;
    const ctx = this.ctx;
    const W = this._cw, H = this._ch;
    const pl = PAD.left, pr = PAD.right, pt = PAD.top, pb = PAD.bottom;

    // Bar şeridi alanı: grafik altında
    const barAreaH = BAR_H + BAR_PAD_TOP;
    const gh = H - pt - pb;          // basınç grafiği yüksekliği
    const gw = W - pl - pr;

    // ── Temizle ────────────────────────────────────────────
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = C_BG;
    ctx.fillRect(0, 0, W, H);

    if (!results || results.length === 0) return;

    // ── Kümülatif uzunluk ──────────────────────────────────
    let cumLen = [0];
    let total  = 0;
    components.forEach(comp => {
      let len = 1;
      if (comp.type === 'pipe')       len = comp._overrides?.length_m ?? 5;
      if (comp.type === 'transition') len = comp._overrides?.length_m ?? 1;
      total += len;
      cumLen.push(total);
    });

    // ── Veri noktaları ─────────────────────────────────────
    const pPoints = [];
    results.forEach((r, i) => {
      pPoints.push({ x: cumLen[i],     y: r.P_in  ?? 0 });
      pPoints.push({ x: cumLen[i + 1], y: r.P_out ?? 0 });
    });

    const vPoints = results.map((r, i) => ({
      x: (cumLen[i] + cumLen[i + 1]) / 2,
      y: r.v ?? 0,
    }));

    // ── Scale ──────────────────────────────────────────────
    const pAll = pPoints.map(p => p.y).filter(isFinite);
    const vAll = vPoints.map(p => p.y).filter(isFinite);

    const pMin = Math.min(0, ...pAll);
    const pMax = Math.max(0.1, ...pAll) * 1.12;
    const vMax = Math.max(0.1, ...vAll) * 1.15;
    const xMax = total;

    const toX  = x  => pl + (x / xMax) * gw;
    const toYp = yp => pt + gh - ((yp - pMin) / (pMax - pMin)) * gh;
    const toYv = yv => pt + gh - (yv / vMax) * gh;

    // ── Grid ───────────────────────────────────────────────
    ctx.strokeStyle = C_GRID;
    ctx.lineWidth   = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pt + (gh / 4) * i;
      ctx.beginPath(); ctx.moveTo(pl, y); ctx.lineTo(pl + gw, y); ctx.stroke();
    }
    cumLen.forEach(x => {
      const px = toX(x);
      ctx.beginPath(); ctx.moveTo(px, pt); ctx.lineTo(px, pt + gh); ctx.stroke();
    });

    // ── Eksenler ───────────────────────────────────────────
    ctx.strokeStyle = C_AX;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(pl, pt);      ctx.lineTo(pl, pt + gh);
    ctx.moveTo(pl, pt + gh); ctx.lineTo(pl + gw, pt + gh);
    ctx.stroke();

    // ── Eksen etiketleri ───────────────────────────────────
    ctx.fillStyle = C_TXT;
    ctx.font      = FONT;
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const val = pMin + (pMax - pMin) * (1 - i / 4);
      ctx.fillText(val.toFixed(2), pl - 4, pt + (gh / 4) * i + 3);
    }

    ctx.textAlign = 'center';
    components.forEach((comp, i) => {
      const mx  = toX((cumLen[i] + cumLen[i + 1]) / 2);
      const lbl = (comp.name || comp.subtype || '?').slice(0, 6);
      ctx.fillText(lbl, mx, pt + gh + 16);
    });

    ctx.textAlign = 'left';
    for (let i = 0; i <= 3; i++) {
      const val = vMax * (1 - i / 3);
      const y   = pt + (gh / 3) * i;
      if (i > 0) ctx.fillText(val.toFixed(2), pl + gw + 4, y + 3);
    }

    // ── Sıfır çizgisi ──────────────────────────────────────
    if (pMin < 0) {
      const y0 = toYp(0);
      ctx.strokeStyle = 'rgba(248,113,113,0.25)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(pl, y0); ctx.lineTo(pl + gw, y0); ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Eleman bölge renklendirmesi ────────────────────────
    const zoneColors = {
      pipe:       'rgba(74,158,255,0.03)',
      elbow:      'rgba(251,191,36,0.03)',
      valve:      'rgba(251,146,60,0.04)',
      pump:       'rgba(52,211,153,0.04)',
      transition: 'rgba(167,139,250,0.04)',
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
      ctx.beginPath(); ctx.arc(toX(x), toYp(y), 2.5, 0, Math.PI * 2); ctx.fill();
    });

    // ── Hız eğrisi ─────────────────────────────────────────
    ctx.strokeStyle = C_V;
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    vPoints.forEach(({ x, y }, i) => {
      i === 0 ? ctx.moveTo(toX(x), toYv(y)) : ctx.lineTo(toX(x), toYv(y));
    });
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = C_V;
    vPoints.forEach(({ x, y }) => {
      ctx.beginPath(); ctx.arc(toX(x), toYv(y), 2, 0, Math.PI * 2); ctx.fill();
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

    // ══════════════════════════════════════════════════════
    // MAJOR / MINOR KAYIP BAR KATMANI
    // Grafik altında, her eleman için yatay stacked bar
    // ══════════════════════════════════════════════════════
    this._drawLossBar(ctx, results, components, cumLen, total, pl, gw, pt, gh);

    // ── Legend ─────────────────────────────────────────────
    this._drawLegend(ctx, W, H, pb);
  }

  // ── Major/Minor kayıp bar şeridi ───────────────────────────────────────
  _drawLossBar(ctx, results, components, cumLen, total, pl, gw, pt, gh) {
    if (!results.length) return;

    const barY  = pt + gh + 24;   // x ekseni etiketlerinin altı
    const toX   = x => pl + (x / total) * gw;

    // Toplam max kayıp — bar scale için
    const maxLoss = Math.max(
      0.001,
      ...results.map(r => (r.dP_major ?? 0) + (r.dP_minor ?? 0))
    );

    results.forEach((r, i) => {
      const x1    = toX(cumLen[i]);
      const x2    = toX(cumLen[i + 1]);
      const barW  = Math.max(0, x2 - x1 - 2);   // 1px boşluk her iki yanda
      const bx    = x1 + 1;

      const dPmaj = r.dP_major ?? 0;
      const dPmin = r.dP_minor ?? 0;
      const dPtot = dPmaj + dPmin;

      if (dPtot <= 0) return;

      // Toplam bar genişliği (orantılı)
      const totalBarW = (dPtot / maxLoss) * barW;
      const majW      = dPtot > 0 ? (dPmaj / dPtot) * totalBarW : 0;
      const minW      = totalBarW - majW;

      // Major (kırmızı) — soldan
      if (majW > 0) {
        ctx.fillStyle = C_MAJ;
        ctx.fillRect(bx, barY, majW, BAR_H);
      }

      // Minor (sarı) — major'ın sağından
      if (minW > 0) {
        ctx.fillStyle = C_MIN;
        ctx.fillRect(bx + majW, barY, minW, BAR_H);
      }

      // Bar arka plan (dolmayan kısım)
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(bx + totalBarW, barY, barW - totalBarW, BAR_H);

      // Değer etiketi — bar içinde veya üstünde
      const dPtot_bar = dPtot;   // zaten bar cinsinde geliyor
      if (dPtot_bar >= 0.001 && barW > 24) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font      = "8px 'IBM Plex Mono', monospace";
        ctx.textAlign = 'center';
        const mx = bx + barW / 2;
        ctx.fillText(dPtot_bar.toFixed(3), mx, barY + BAR_H / 2 + 3);
      }
    });

    // Bar şeridi sol eksen çizgisi
    ctx.strokeStyle = C_AX;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(pl, barY);
    ctx.lineTo(pl, barY + BAR_H);
    ctx.stroke();

    // "ΔP" etiketi
    ctx.fillStyle = C_TXT;
    ctx.font      = FONT;
    ctx.textAlign = 'right';
    ctx.fillText('ΔP', pl - 4, barY + BAR_H / 2 + 3);
  }

  // ── Legend ─────────────────────────────────────────────────────────────
  _drawLegend(ctx, W, H, pb) {
    const items = [
      { color: C_P,   label: 'Pressure (bar)' },
      { color: C_V,   label: 'Velocity (m/s)', dash: true },
      { color: C_MAJ, label: 'Major loss' },
      { color: C_MIN, label: 'Minor loss' },
    ];

    const legendY  = H - 14;
    const itemW    = 90;
    const startX   = W / 2 - (items.length * itemW) / 2;

    ctx.font      = FONT;
    ctx.textAlign = 'left';

    items.forEach((item, i) => {
      const x = startX + i * itemW;

      // Renk göstergesi
      ctx.save();
      if (item.dash) {
        ctx.strokeStyle = item.color;
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x, legendY - 3);
        ctx.lineTo(x + 16, legendY - 3);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = item.color;
        ctx.fillRect(x, legendY - 7, 16, 6);
      }
      ctx.restore();

      ctx.fillStyle = C_TXT;
      ctx.fillText(item.label, x + 20, legendY);
    });
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

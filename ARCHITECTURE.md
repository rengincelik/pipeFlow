# Pipeline Simulator — Refactor Mimarisi

## Dosya Yapısı

```
pipeline/
├── core/
│   ├── hydraulics.js       ← Saf hesap fonksiyonları (UI yok, test edilebilir)
│   ├── fluid-model.js      ← FluidModel sınıfı + FluidRegistry + inline su verisi
│   ├── interpolation.js    ← tableInterp, splineInterp (Fritsch-Carlson)
│   └── event-emitter.js    ← Minimal EventEmitter (Node bağımlılığı yok)
│
├── components/
│   ├── base.js             ← ComponentBase + factory (createComponent/registerComponentType)
│   ├── pipe.js             ← PipeComponent (h, vd, vu, rh, rvd, rvu, eh, evd, evu)
│   └── fittings.js         ← ElbowComponent, ValveComponent, PRVComponent, PumpComponent
│
├── renderer/
│   ├── svg-utils.js        ← svgEl(), setAttrs(), createNode() — namespace yardımcıları
│   ├── svg-renderer.js     ← SVGRenderer sınıfı + computeLayout()
│   └── pipeline.css        ← Tüm SVG görünümü (JS'de renk kalmadı)
│
├── state/
│   ├── system-config.js    ← SystemConfig singleton + OverrideMixin
│   └── pipeline-store.js   ← PipelineStore (reaktif state, hesap koordinasyonu)
│
├── data/
│   ├── catalogs.js         ← DN_LIST, MATERIALS, CATALOG_DEF, CATALOG_MAP
│   └── fluids/             ← (ileride) water.json, glycol_30.json, ...
│
└── main.js                 ← Bağlantı noktası: UI event'leri, catalog render, drag-drop
```

---

## Kritik Tasarım Kararları

### 1. ComponentBase + Override Zinciri

Her komponent kendi override'larını saklar; yoksa SystemConfig'e düşer:

```js
// Sistem geneli çap değiştir → override'sız tüm elemanlar güncellenir
SystemConfig.set('diameter_mm', 82.5)  // DN80

// Sadece bu eleman için farklı çap
myPipe.override('diameter_mm', 26.9)   // DN25

// Sistemin değerini oku (override → system zinciri)
myPipe.resolve('diameter_mm')           // → 26.9 (override var)
otherPipe.resolve('diameter_mm')        // → 82.5 (system default)

// Override sil, sisteme geri dön
myPipe.clearOverride('diameter_mm')
```

### 2. SVG DOM Tabanlı Render (string concat YOK)

**Eski yaklaşım (kırık):**
```js
// Her render'da sıfırdan string birleştirme
// compSVG her zaman pump SVG'sini döndürüyordu (bug)
body = pipeSVG_2d(...)   // atandı
body = elbowSVG_2d(...)  // üzerine yazıldı!
```

**Yeni yaklaşım:**
```js
// İlk render: DOM elementi yarat, cache'e al
const g = comp.createSVG(layout)
renderer._compEls.set(comp.id, g)

// Sonraki render'lar: sadece değişenleri patch et
comp.updateSVG(g, newLayout)
// → g.dataset.regime güncellenir
// → class toggle edilir
// → alt elementler yeniden çizilir (gerekirse)
```

### 3. Katmanlı SVG Z-Order

```
<svg>
  <g id="layer-spine">   ← bağlantı çizgileri (altta)
  <g id="layer-comps">   ← komponent SVG'leri
  <g id="layer-nodes">   ← A/B noktaları
  <g id="layer-overlay"> ← drop indicator, seçim overlay
```

### 4. CSS ile Görsel Kontrol

Tüm renkler/stiller `pipeline.css`'de, JS'de hardcoded renk yok:

```css
/* Rejim renklendirmesi — data attribute üzerinden */
.component[data-regime="L"]  .pipe-body { stroke: var(--c-laminar); }
.component[data-regime="Tr"] .pipe-body { stroke: var(--c-trans);   }
.component[data-regime="T"]  .pipe-body { stroke: var(--c-turb);    }

/* Seçim — JS class toggle ile */
.component.sel .pipe-body { stroke: var(--c-sel); stroke-width: 2; }

/* Etiket görünürlüğü — class ile kontrol */
.component .lbl          { display: none; }
.component.labels-on .lbl { display: block; }
```

### 5. Reaktif State (EventEmitter tabanlı)

```
SystemConfig.set() → emit('change')
                          ↓
                   PipelineStore._recalc()
                          ↓
                   emit('calc:done', results)
                          ↓
                   main.js → _redraw() + _renderProps()
```

---

## Eski Koddan Farklılıklar

| Konu                | Eski                          | Yeni                                    |
|---------------------|-------------------------------|-----------------------------------------|
| `compSVG()`         | `body=` 4 kez üst üste yazar | Polimorfik `comp.createSVG()` / `updateSVG()` |
| SVG üretimi         | String concat                 | `document.createElementNS()` DOM       |
| Renkler             | JS içinde hardcoded           | `pipeline.css` CSS değişkenleri        |
| Çap/malzeme         | Global her yerde              | SystemConfig + per-component override  |
| Fluid verisi        | Inline tablo + `getAllProps()` | `FluidModel` + `FluidRegistry`        |
| State               | Global değişkenler            | `PipelineStore` (EventEmitter)         |
| Sınıf hiyerarşisi   | Yok, `type==='pipe'` stringleri | `ComponentBase` → alt sınıflar       |

---

## Eksik / Sonraki Adımlar

1. **Chart renderer** (`renderer/chart-renderer.js`) — mevcut canvas chart'ı modüle taşı
2. **Fluid JSON dosyaları** (`data/fluids/water.json`) — inline veriyi dışarıya çıkar
3. **Props panel component'leri** — her komponent tipi için ayrı panel modülü
4. **Import/export** — v1 JSON formatından migration
5. **Birim testleri** — `core/hydraulics.js` artık saf fonksiyon, kolayca test edilebilir
6. **Ekspander hesabı** — şu an `pipe.js`'de reducer ile aynı path, genişleme kayıpları ayrılmalı

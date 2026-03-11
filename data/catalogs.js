'use strict';

// ═══════════════════════════════════════════════════════════
// CATALOG DATA — DN listesi, malzeme tablosu, komponent tanımları
// ═══════════════════════════════════════════════════════════

export const DN_LIST = [
  { dn:'DN15',  d:15.8  }, { dn:'DN20',  d:21.3  }, { dn:'DN25',  d:26.9  },
  { dn:'DN32',  d:35.4  }, { dn:'DN40',  d:41.9  }, { dn:'DN50',  d:53.1  },
  { dn:'DN65',  d:68.9  }, { dn:'DN80',  d:82.5  }, { dn:'DN100', d:106.1 },
  { dn:'DN125', d:131.7 }, { dn:'DN150', d:159.3 }, { dn:'DN200', d:206.5 },
];

export const MATERIALS = [
  { id:'steel_new',  name:'Seamless Steel (new)', eps:0.046  },
  { id:'steel_old',  name:'Welded Steel (old)',   eps:0.26   },
  { id:'cast_iron',  name:'Cast Iron',            eps:0.26   },
  { id:'pvc_pe',     name:'PVC / PE',             eps:0.003  },
  { id:'copper',     name:'Copper / Brass',       eps:0.0015 },
];

/**
* Katalog tanımları.
* Her item: { group, type, subtype, name, icon?, desc?, defaultOverrides? }
* defaultOverrides: makeComp sırasında uygulanacak override değerleri
*/

export const CATALOG_DEF = [
  {
    group: 'Elbows',
    items: [
      { type:'elbow', subtype:'rd', icon:'┐', desc:'Right → Down' },
      { type:'elbow', subtype:'ru', icon:'┘', desc:'Right → Up'   },
      { type:'elbow', subtype:'ur', icon:'┌', desc:'Up → Right'   },
      { type:'elbow', subtype:'dr', icon:'└', desc:'Down → Right' },
    ],
  },
  {
    group: 'Pipes',
    items: [
      { type:'pipe', subtype:'pipe', icon:'━', desc:'Straight pipe', },
    ]
  },
  {
    group: 'Transition',
    items:[
      { type:'transition', subtype:'reducer', icon:'▶', desc:'Diameter reduction', },

      { type:'transition', subtype:'expander', icon:'◀', desc:'Diameter expansion', },
    ],
  },
  {
    group: 'Valves',
    items: [
      { type:'valve', subtype:'gate', icon:'⦿', desc:'Gate / K=0.20' },
      { type:'valve', subtype:'prv', icon:'⊕', desc:'Pressure Reducing Valve' },
    ],
  },
  {
    group: 'Pump',
    items: [
      { type:'pump', subtype:'centrifugal', icon:'⦿', desc:'Gate / K=0.20' },
    ],
  },

];

// Tüm geçerli reducer çiftlerini DN_LIST'ten otomatik üret
// Sadece küçükten büyüğe bitişik veya 2 adım atlayan çiftler
export const TRANSITION_PAIRS = DN_LIST.flatMap((big, i) =>
  DN_LIST.slice(0, i).map(small => ({
		label:   `${DN_LIST[i].dn} → ${small.dn}`,
		d_in:    big.d,
		d_out:   small.d,
	  }))
	).filter((_, i, arr) => {
	  // Sadece 1 veya 2 DN adım atlayan çiftleri al — çok uç kombinasyonları ele
	  return true; // hepsini göster, istersen filtre eklersin
	});

// Expander için tersi
export const EXPANDER_PAIRS = TRANSITION_PAIRS.map(p => ({
  label: `${DN_LIST.find(d => d.d === p.d_out)?.dn} → ${DN_LIST.find(d => d.d === p.d_in)?.dn}`,
  d_in:  p.d_out,
  d_out: p.d_in,
}));

/** type:subtype → catalog item için hızlı arama */
export const CATALOG_MAP = new Map(
  CATALOG_DEF.flatMap(g => g.items.map(item => [`${item.type}:${item.subtype}`, item]))
);
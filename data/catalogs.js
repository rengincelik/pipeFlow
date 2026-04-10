'use strict';

export const FLUID_DATA = [
	{
		id: 'water',
		name: 'Water (H2O)',
		range: { min: 0, max: 150 },
		coeffs: {
			rho: [999.84, 0.067, -0.0089, 0.000035],
			mu_vogel: [0.0241, 514.4, 133.5],
			cp: [4.18, 0.0001]
		}
	},
	{
		id: 'eg50',
		name: 'Etilen Glikol %50',
		range: { min: -30, max: 120 },
		coeffs: {
			rho: [1085.1, -0.523, -0.0018],
			mu_vogel: [0.0125, 1205.5, 155.2],
			cp: [3.3, 0.005]
		}
	},
	{
		id: 'glycerin',
		name: 'Gliserin',
		range: { min: 0, max: 100 },
		coeffs: {
			rho: [1273.3, -0.612, 0],
			mu_vogel: [0.0012, 2450.5, 120.2],
			cp: [2.26, 0.0055]
		}
	},
	{
		id: 'oil_sae30',
		name: 'Motor Yağı (SAE 30)',
		range: { min: 0, max: 120 },
		coeffs: {
			rho: [895.2, -0.63, 0],
			mu_vogel: [0.035, 1450.0, 110.0],
			cp: [1.8, 0.004]
		}
	}
];
// CATALOG DATA → DN list, material table, component definitions

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
 * Catalog definitions.
 * Each item:  group, type, subtype, name, icon?, desc?, defaultOverrides?
 * defaultOverrides: override values applied during makeComp
 **/


export const CATALOG_DEF = [
	{
		group: 'Elbows',
		items: [
			{ type:'elbow', subtype:'rd', icon:'⤵', desc:'Right ? Down' },
			{ type:'elbow', subtype:'ru', icon:'⤴', desc:'Right ? Up'   },
			{ type:'elbow', subtype:'ur', icon:'⤴', desc:'Up ? Right'   },
			{ type:'elbow', subtype:'dr', icon:'⤵', desc:'Down ? Right' },
		],
	},
	{
		group: 'Pipes',
		items: [
			{ type:'pipe', subtype:'pipe', icon:'⟶', desc:'Straight pipe' },
		]
	},
	{
		group: 'Transition',
		items:[
			{ type:'transition', subtype:'reducer',  icon:'▷', desc:'Diameter reduction' },
			{ type:'transition', subtype:'expander',  icon:'◁', desc:'Diameter expansion' },
		],
	},
	{
		group: 'Valves',
		items: [
			{ type:'valve', subtype:'gate', icon:'⊠', desc:'Gate / K=0.20' },
			{ type:'valve', subtype:'prv',  icon:'⊕', desc:'Pressure Reducing Valve' },
		],
	},
	{
		group: 'Pump',
		items: [
			{ type:'pump', subtype:'centrifugal', icon:'⟳', desc:'Gate / K=0.20' },
		],
	},
];

// TODO: We need to add a K table for valves
// TODO: We need to add angle (cone angle) for transitions


// Automatically generate all valid reducer pairs from DN_LIST
// Only from larger to smaller sizes (including all combinations)
export const TRANSITION_PAIRS = DN_LIST.flatMap((big, i) =>
	DN_LIST.slice(0, i).map(small => ({
		label:   `${DN_LIST[i].dn} → ${small.dn}`,
		d_in:    big.d,
		d_out:   small.d,
	}))
).filter((_, i, arr) => {
	// Keep only pairs within 1–2 DN steps if needed (currently returns all)
	return true; // show all, add filter if desired
});

// Reverse for expanders
export const EXPANDER_PAIRS = TRANSITION_PAIRS.map(p => ({
	label: `${DN_LIST.find(d => d.d === p.d_out)?.dn} → ${DN_LIST.find(d => d.d === p.d_in)?.dn}`,
	d_in:  p.d_out,
	d_out: p.d_in,
}));

/** Fast lookup for catalog item by type:subtype */
export const CATALOG_MAP = new Map(
	CATALOG_DEF.flatMap(g => g.items.map(item => [`${item.type}:${item.subtype}`, item]))
);


// NOTE:
// D1: cone_angle_deg is defined in SystemConfig.defaults (10°)
// TRANSITION_PAIRS and EXPANDER_PAIRS store DN mappings here;
// the conical length calculation is handled inside TransitionComponent.length_m getter.
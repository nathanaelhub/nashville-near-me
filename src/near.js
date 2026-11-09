// What's happening near an address in Nashville: the pure parts (parsing,
// queries, cleaning and labelling records), kept free of the DOM so they can be
// tested under Node. Every record comes from Metro Nashville's public ArcGIS
// layers; nothing here is generated or guessed.

export const ARCGIS = "https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services";
export const DIGEST = "https://nathanaelhub.github.io/nashville-council-digest";

// Each layer, the fields requested from it (never owner, appellant or contact
// names), and the date that decides what's recent.
export const LAYERS = {
  parcels: { path: "Parcels_view", fields: ["PropAddr", "PropHouse", "PropCity", "PropZip", "Council", "Lat", "Lon"] },
  cases: {
    path: "Development_Tracker_Cases_view",
    fields: ["MPCNUM", "BILLNUM", "CASE_TYPE_DESC", "SUB_TYPE_DESC", "PROJECT_DESC", "LOCATION_DESC", "CAPTION",
      "PSTAT", "DATE_ACCEPTED", "HEARING_DATE", "MPC_ACTION_DESC", "ExistingZoning", "NewZoning", "CD"],
  },
  appeals: {
    path: "Board_of_Zoning_Appeals_Cases_view",
    fields: ["CASE_NAME", "BZA_DATE", "BZAACTION_DESC", "ACTIVITY", "PURPOSE", "REASON", "ZONEDIST", "CD", "PERSTATUS"],
  },
  issued: {
    path: "Building_Permits_Issued_2",
    fields: ["Permit__", "Permit_Type_Description", "Permit_Subtype_Description", "Date_Entered", "Date_Issued",
      "Const_Cost", "Address", "Purpose", "Lat", "Lon"],
  },
  applied: {
    path: "Building_Permit_Applications_Feature_Layer_view",
    fields: ["Permit__", "Permit_Type_Description", "Permit_Subtype_Description", "Date_Entered", "Date_Issued",
      "Const_Cost", "Address", "Purpose", "Lat", "Lon"],
  },
};

export const RADII = { "0.25": 402, "0.5": 805, "1": 1609 }; // miles -> meters

// ---- the address --------------------------------------------------------

const SUFFIX = {
  street: "ST", st: "ST", avenue: "AVE", ave: "AVE", road: "RD", rd: "RD", drive: "DR", dr: "DR",
  pike: "PIKE", lane: "LN", ln: "LN", boulevard: "BLVD", blvd: "BLVD", court: "CT", ct: "CT",
  place: "PL", pl: "PL", way: "WAY", circle: "CIR", cir: "CIR", parkway: "PKWY", pkwy: "PKWY",
  trail: "TRL", trl: "TRL", highway: "HWY", hwy: "HWY", terrace: "TER", ter: "TER", square: "SQ", sq: "SQ",
  pass: "PASS", cove: "CV", cv: "CV", run: "RUN", loop: "LOOP", row: "ROW", alley: "ALY", bend: "BND",
};
const DIRECTION = { north: "N", south: "S", east: "E", west: "W", n: "N", s: "S", e: "E", w: "W" };
export const NEAR_HOUSE = 200;

// "1 Public Square, Nashville TN 37201" -> {house: "1", street: "PUBLIC%SQ", zip: "37201"}
export function parseAddress(text) {
  const zip = (String(text).match(/\b(37\d{3})(?:-\d{4})?\s*$/) || [])[1] || "";
  const first = String(text).split(",")[0].replace(/[^\w\s]/g, " ").trim().toUpperCase();
  const m = first.match(/^(\d{1,6})[A-Z]?\s+(.+)$/);
  if (!m) return null;
  const words = m[2].split(/\s+/);
  let dir = "";
  if (words.length > 1 && DIRECTION[words.at(-1).toLowerCase()]) dir = DIRECTION[words.pop().toLowerCase()];
  const suffix = words.length > 1 ? SUFFIX[words.at(-1).toLowerCase()] : undefined;
  if (suffix) words.pop();
  const street = [...words, ...(suffix ? [suffix] : []), ...(dir ? [dir] : [])].join("%").replace(/'/g, "''");
  return { house: m[1], street, zip };
}

// Parcel streets are stored like "WEST END  AVE" or "MAIN  ST N": the street
// exactly, or followed by a direction the person left out.
export function addressWhere(p, house) {
  const clauses = [`(PropStreet LIKE '${p.street}' OR PropStreet LIKE '${p.street} %')`, house];
  if (p.zip) clauses.push(`PropZip = '${p.zip}'`);
  return clauses.join(" AND ");
}

export function exactHouse(p) {
  return `PropHouse = '${p.house}'`;
}

export function nearbyHouse(p) {
  const h = parseInt(p.house, 10);
  return `PropHouse <> '' AND PropHouse <> '0' AND CAST(PropHouse AS INT) BETWEEN ${Math.max(1, h - NEAR_HOUSE)} AND ${h + NEAR_HOUSE}`;
}

// One answer per distinct place (ZIP), closest house number first, so an
// address that exists in two parts of the county stays two answers.
export function places(rows, house) {
  const h = parseInt(house, 10);
  const best = new Map();
  for (const r of rows) {
    if (!Number.isFinite(r.Lat) || !Number.isFinite(r.Lon)) continue;
    const d = Math.abs(parseInt(r.PropHouse, 10) - h);
    const key = r.PropZip || r.PropCity;
    if (!best.has(key) || d < best.get(key).gap) best.set(key, { gap: d, row: r });
  }
  return [...best.values()]
    .sort((a, b) => a.gap - b.gap)
    .map(({ gap, row }) => ({
      addr: row.PropAddr, city: row.PropCity, zip: row.PropZip, district: parseInt(row.Council, 10) || null,
      lat: row.Lat, lon: row.Lon, exact: gap === 0,
    }));
}

// ---- the queries ---------------------------------------------------------

export function queryUrl(layer, params) {
  const { path, fields } = LAYERS[layer];
  const q = new URLSearchParams({ outFields: fields.join(","), returnGeometry: "false", f: "json", ...params });
  return `${ARCGIS}/${path}/FeatureServer/0/query?${q}`;
}

export function nearbyUrl(layer, { lat, lon }, meters, where = "1=1") {
  return queryUrl(layer, {
    where, geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326",
    spatialRel: "esriSpatialRelIntersects", distance: String(meters), units: "esriSRUnit_Meter",
    returnGeometry: "true", outSR: "4326", resultRecordCount: "500",
  });
}

const DAY = 86400000;
// What counts as current for each layer: planning cases that are still open,
// appeals heard in the last year or scheduled, permits from the last year.
export function recentWhere(layer, now = Date.now()) {
  const since = new Date(now - 365 * DAY).toISOString().slice(0, 10);
  switch (layer) {
    case "cases": return "PSTAT IN ('New','Pending','Active')";
    case "appeals": return `BZA_DATE >= DATE '${since}'`;
    case "issued": return `Date_Issued >= DATE '${since}'`;
    case "applied": return `Date_Issued IS NULL AND Date_Entered >= DATE '${since}'`;
    default: return "1=1";
  }
}

// ---- cleaning and labelling ----------------------------------------------

// Free-text permit notes sometimes carry a contact's phone or email
// ("POC: Kim ... 615.690.3748"). Those are dropped before display.
export function redact(text) {
  return String(text ?? "")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email removed]")
    // a separator is required, so a bare 10-digit permit number isn't taken for a phone
    .replace(/(?<!\d)(?:\(\d{3}\)\s*|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?!\d)(?:\s*(?:ext\.?|x)\s*\d+)?/gi, "[phone removed]")
    .replace(/\s+/g, " ")
    .trim();
}

const CASE_TYPES = {
  "MPC Rezoning": "Rezoning: changes what can be built on the land",
  "MPC Specific Plan": "Specific Plan: custom zoning written for one site",
  "MPC Planned Unit Development": "Planned Unit Development: a site plan approved as part of the zoning",
  "MPC Subdivision": "Subdivision: dividing land into new lots",
  "MPC Mandatory Referral": "Mandatory referral: a public-property change the Planning Commission reviews",
  "MPC Text Amendment": "Zoning code change (countywide text)",
  "MPC Community Plan": "Community plan change: the long-range policy for an area",
  "MPC Zoning Overlay": "Overlay district: extra rules layered on the zoning",
  "MPC Urban Design Overlay": "Urban Design Overlay: design rules for buildings in an area",
  "MPC Downtown Code": "Downtown Code review: a project checked against downtown's design rules",
};

export function caseLabel(type) {
  return CASE_TYPES[type] || String(type || "Planning case").replace(/^MPC\s+/, "");
}

const STATUS = { New: "Just filed", Pending: "Under review", Active: "Under review", Complete: "Finished" };

// "12/02/2026" or epoch ms -> "2026-12-02"
export function isoDate(v) {
  if (v == null || v === "") return "";
  // Metro stores dates as Nashville-time instants; read them in that zone.
  if (typeof v === "number") return new Date(v).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? String(v).slice(0, 10) : "";
}

// "2026-11-12" -> "Nov 12, 2026"
export function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
}

export function metersBetween(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function distanceLabel(m) {
  const feet = m * 3.28084;
  if (feet < 1000) return `${Math.max(50, Math.round(feet / 50) * 50)} ft away`;
  return `${(m / 1609.344).toFixed(1)} mi away`;
}

const BILL = /^(BL|RS|SO)\d{4}-\d{1,5}$/;
export const billFile = (s) => (BILL.test(String(s || "").trim()) ? String(s).trim() : "");

// Trim and end with one full stop: Metro's notes end in ".", "..", or nothing.
export function sentence(t) {
  const s = String(t ?? "").trim().replace(/[.\s]+$/, "");
  return s ? `${s}.` : "";
}

// One record from any layer -> a card the page can show. `where` is the point
// the person searched from.
export function toItem(layer, f, from) {
  const a = f.attributes || {};
  const at = f.geometry && Number.isFinite(f.geometry.y) ? { lat: f.geometry.y, lon: f.geometry.x }
    : Number.isFinite(a.Lat) ? { lat: a.Lat, lon: a.Lon } : null;
  const dist = at && from ? metersBetween(from, at) : null;
  if (layer === "cases") {
    const hearing = isoDate(a.HEARING_DATE);
    return {
      layer, id: a.MPCNUM, title: caseLabel(a.CASE_TYPE_DESC), place: a.LOCATION_DESC || a.PROJECT_DESC || "",
      text: redact(a.CAPTION), status: STATUS[a.PSTAT] || a.PSTAT || "", date: isoDate(a.DATE_ACCEPTED),
      hearing, bill: billFile(a.BILLNUM), action: a.MPC_ACTION_DESC || "",
      zoning: [a.ExistingZoning, a.NewZoning].filter(Boolean), dist,
    };
  }
  if (layer === "appeals") {
    return {
      layer, id: a.CASE_NAME, title: `Zoning appeal${a.ACTIVITY ? `: ${a.ACTIVITY}` : ""}`, place: "",
      text: redact([a.REASON, a.PURPOSE && `Purpose: ${a.PURPOSE}`].map(sentence).filter(Boolean).join(" ")),
      status: a.BZAACTION_DESC || "", date: isoDate(a.BZA_DATE), hearing: isoDate(a.BZA_DATE),
      zoning: a.ZONEDIST ? [a.ZONEDIST] : [], dist,
    };
  }
  const type = [a.Permit_Type_Description, a.Permit_Subtype_Description].filter(Boolean).join(" · ");
  return {
    layer, id: a.Permit__, title: type || "Building permit", place: a.Address || "",
    text: redact(a.Purpose), status: layer === "issued" ? "Issued" : "In review",
    date: isoDate(layer === "issued" ? a.Date_Issued : a.Date_Entered),
    cost: Number(a.Const_Cost) > 0 ? Number(a.Const_Cost) : null, dist,
  };
}

// Newest first, then nearest; an upcoming hearing goes to the top of its group.
export function sortItems(items, today = new Date().toISOString().slice(0, 10)) {
  const upcoming = (x) => (x.hearing && x.hearing >= today ? 1 : 0);
  return [...items].sort((a, b) => upcoming(b) - upcoming(a)
    || (upcoming(a) ? a.hearing.localeCompare(b.hearing) : 0)
    || (b.date || "").localeCompare(a.date || "")
    || (a.dist ?? 1e9) - (b.dist ?? 1e9));
}

export function money(n) {
  return n == null ? "" : n >= 1e6 ? `$${(n / 1e6).toFixed(1).replace(/\.0$/, "")} million` : `$${Math.round(n).toLocaleString("en-US")}`;
}

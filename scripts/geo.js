/* Where a pin is, and where an address is, according to the Census Bureau. Used by scripts/precheck.js.
 *
 *   const geo = require("./geo");
 *   await geo.townAt(42.3629, -71.0838)                      -> "Cambridge" (or null)
 *   await geo.addressPoint("1 Broadway", "Cambridge")        -> { matched, lat, lng } (or null)
 *   geo.meters(a.lat, a.lng, b.lat, b.lng)                   -> distance
 *
 * Both calls go to the Bureau's public geocoder, one at a time, and only with a place name or a
 * point that is already public in the dataset. A lookup that fails throws; the caller says so.
 */
const { TOWNS } = require("./towns");

const BASE = "https://geocoding.geo.census.gov/geocoder/";
const isTown = new Set(TOWNS);

let queue = Promise.resolve();
function getJson(url, timeoutMs = 15000) {
  const run = async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0" } });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { again: res.status >= 500 });
      return await res.json();
    } finally { clearTimeout(timer); }
  };
  // The Bureau's geocoder answers 502 now and then: one more try, after a moment
  const once = async () => { try { return await run(); } catch (e) { if (!e.again && e.name !== "AbortError") throw e; await new Promise(r => setTimeout(r, 1500)); return run(); } };
  const p = queue.then(once, once);        // one request at a time, whatever else is waiting
  queue = p.catch(() => {});
  return p;
}

// The Bureau files "Amherst" as "Amherst Town". The atlas writes it as the town does.
function townName(basename) {
  if (!basename) return null;
  if (!TOWNS.length || isTown.has(basename)) return basename;
  const short = basename.replace(/ Town$/, "");
  return isTown.has(short) ? short : basename;
}

async function townAt(lat, lng) {
  const j = await getJson(`${BASE}geographies/coordinates?x=${lng}&y=${lat}` +
    "&benchmark=Public_AR_Current&vintage=Current_Current&layers=County%20Subdivisions&format=json");
  const g = (j.result.geographies["County Subdivisions"] || [])[0];
  return g ? townName(g.BASENAME) : null;
}

const SUFFIX = { STREET: "ST", AVENUE: "AVE", ROAD: "RD", BOULEVARD: "BLVD", PLACE: "PL", COURT: "CT", DRIVE: "DR", LANE: "LN", SQUARE: "SQ", PARKWAY: "PKWY", TERRACE: "TER", HIGHWAY: "HWY", CIRCLE: "CIR", NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W" };
const streetKey = s => s.toUpperCase().replace(/[^A-Z0-9 -]/g, "").split(/\s+/).filter(Boolean).map(w => SUFFIX[w] || w).join(" ");

// Returns null when the Bureau has no match, or matched a different house number or street.
async function addressPoint(street, town) {
  const j = await getJson(`${BASE}locations/onelineaddress?address=` +
    encodeURIComponent(`${street}, ${town || ""}, MA`) + "&benchmark=Public_AR_Current&format=json");
  const m = j.result.addressMatches[0];
  if (!m) return null;
  // The house number and the street must be the same one: "1 Broadway" is not "1 Broadway Ct"
  if (streetKey(street) !== streetKey(m.matchedAddress.split(",")[0])) return null;
  return { matched: m.matchedAddress, lat: m.coordinates.y, lng: m.coordinates.x };
}

function meters(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const h = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

module.exports = { townAt, addressPoint, meters, townName, streetKey };

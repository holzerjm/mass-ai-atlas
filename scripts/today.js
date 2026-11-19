/* Today's date where the atlas is, as YYYY-MM-DD.
 *
 *   const today = require("./today");   today()  ->  "2026-11-18"
 *
 * A deadline's last day ends at midnight in Massachusetts. The UTC date turns over at 7 PM
 * in Boston (8 PM in summer), so until Nov. 2026 a deadline stopped counting five hours
 * before its day was out. The page does the same sum in index.html (ATLAS_ZONE, todayYMD).
 * An atlas for another region names its own zone in both places.
 */
const ZONE = "America/New_York";
const format = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

function today(now = new Date()) {
  const p = Object.fromEntries(format.formatToParts(now).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

module.exports = today;
module.exports.ZONE = ZONE;

/* The 351 cities and towns of Massachusetts, A to Z: the values an entry's `town` may take.
 * scripts/validate.js checks every entry against this list with townProblem(), below it,
 * and scripts/kpi.js reports how many of them the atlas reaches.
 *
 * The names are the Census Bureau's county subdivisions for Massachusetts (TIGERweb,
 * Nov. 2026), which in this state are its cities and towns. The Bureau files 13 cities that
 * still call themselves towns as "Amherst Town", "Braintree Town" and so on. They are
 * written here as the places write them: "Amherst", "Braintree".
 *
 * A neighborhood, a village or a campus is not on the list. Allston and Charlestown are
 * Boston, Kendall Square is Cambridge, and Devens is parts of Ayer, Harvard and Shirley.
 *
 * An atlas for another region replaces the list with its own places. Left empty, it
 * switches off both checks on `town`.
 */
const TOWNS = [
  "Abington", "Acton", "Acushnet", "Adams", "Agawam", "Alford", "Amesbury", "Amherst", "Andover",
  "Aquinnah", "Arlington", "Ashburnham", "Ashby", "Ashfield", "Ashland", "Athol", "Attleboro",
  "Auburn", "Avon", "Ayer", "Barnstable", "Barre", "Becket", "Bedford", "Belchertown",
  "Bellingham", "Belmont", "Berkley", "Berlin", "Bernardston", "Beverly", "Billerica",
  "Blackstone", "Blandford", "Bolton", "Boston", "Bourne", "Boxborough", "Boxford", "Boylston",
  "Braintree", "Brewster", "Bridgewater", "Brimfield", "Brockton", "Brookfield", "Brookline",
  "Buckland", "Burlington", "Cambridge", "Canton", "Carlisle", "Carver", "Charlemont", "Charlton",
  "Chatham", "Chelmsford", "Chelsea", "Cheshire", "Chester", "Chesterfield", "Chicopee",
  "Chilmark", "Clarksburg", "Clinton", "Cohasset", "Colrain", "Concord", "Conway", "Cummington",
  "Dalton", "Danvers", "Dartmouth", "Dedham", "Deerfield", "Dennis", "Dighton", "Douglas",
  "Dover", "Dracut", "Dudley", "Dunstable", "Duxbury", "East Bridgewater", "East Brookfield",
  "East Longmeadow", "Eastham", "Easthampton", "Easton", "Edgartown", "Egremont", "Erving",
  "Essex", "Everett", "Fairhaven", "Fall River", "Falmouth", "Fitchburg", "Florida", "Foxborough",
  "Framingham", "Franklin", "Freetown", "Gardner", "Georgetown", "Gill", "Gloucester", "Goshen",
  "Gosnold", "Grafton", "Granby", "Granville", "Great Barrington", "Greenfield", "Groton",
  "Groveland", "Hadley", "Halifax", "Hamilton", "Hampden", "Hancock", "Hanover", "Hanson",
  "Hardwick", "Harvard", "Harwich", "Hatfield", "Haverhill", "Hawley", "Heath", "Hingham",
  "Hinsdale", "Holbrook", "Holden", "Holland", "Holliston", "Holyoke", "Hopedale", "Hopkinton",
  "Hubbardston", "Hudson", "Hull", "Huntington", "Ipswich", "Kingston", "Lakeville", "Lancaster",
  "Lanesborough", "Lawrence", "Lee", "Leicester", "Lenox", "Leominster", "Leverett", "Lexington",
  "Leyden", "Lincoln", "Littleton", "Longmeadow", "Lowell", "Ludlow", "Lunenburg", "Lynn",
  "Lynnfield", "Malden", "Manchester-by-the-Sea", "Mansfield", "Marblehead", "Marion",
  "Marlborough", "Marshfield", "Mashpee", "Mattapoisett", "Maynard", "Medfield", "Medford",
  "Medway", "Melrose", "Mendon", "Merrimac", "Methuen", "Middleborough", "Middlefield",
  "Middleton", "Milford", "Millbury", "Millis", "Millville", "Milton", "Monroe", "Monson",
  "Montague", "Monterey", "Montgomery", "Mount Washington", "Nahant", "Nantucket", "Natick",
  "Needham", "New Ashford", "New Bedford", "New Braintree", "New Marlborough", "New Salem",
  "Newbury", "Newburyport", "Newton", "Norfolk", "North Adams", "North Andover",
  "North Attleborough", "North Brookfield", "North Reading", "Northampton", "Northborough",
  "Northbridge", "Northfield", "Norton", "Norwell", "Norwood", "Oak Bluffs", "Oakham", "Orange",
  "Orleans", "Otis", "Oxford", "Palmer", "Paxton", "Peabody", "Pelham", "Pembroke", "Pepperell",
  "Peru", "Petersham", "Phillipston", "Pittsfield", "Plainfield", "Plainville", "Plymouth",
  "Plympton", "Princeton", "Provincetown", "Quincy", "Randolph", "Raynham", "Reading", "Rehoboth",
  "Revere", "Richmond", "Rochester", "Rockland", "Rockport", "Rowe", "Rowley", "Royalston",
  "Russell", "Rutland", "Salem", "Salisbury", "Sandisfield", "Sandwich", "Saugus", "Savoy",
  "Scituate", "Seekonk", "Sharon", "Sheffield", "Shelburne", "Sherborn", "Shirley", "Shrewsbury",
  "Shutesbury", "Somerset", "Somerville", "South Hadley", "Southampton", "Southborough",
  "Southbridge", "Southwick", "Spencer", "Springfield", "Sterling", "Stockbridge", "Stoneham",
  "Stoughton", "Stow", "Sturbridge", "Sudbury", "Sunderland", "Sutton", "Swampscott", "Swansea",
  "Taunton", "Templeton", "Tewksbury", "Tisbury", "Tolland", "Topsfield", "Townsend", "Truro",
  "Tyngsborough", "Tyringham", "Upton", "Uxbridge", "Wakefield", "Wales", "Walpole", "Waltham",
  "Ware", "Wareham", "Warren", "Warwick", "Washington", "Watertown", "Wayland", "Webster",
  "Wellesley", "Wellfleet", "Wendell", "Wenham", "West Boylston", "West Bridgewater",
  "West Brookfield", "West Newbury", "West Springfield", "West Stockbridge", "West Tisbury",
  "Westborough", "Westfield", "Westford", "Westhampton", "Westminster", "Weston", "Westport",
  "Westwood", "Weymouth", "Whately", "Whitman", "Wilbraham", "Williamsburg", "Williamstown",
  "Wilmington", "Winchendon", "Winchester", "Windsor", "Winthrop", "Woburn", "Worcester",
  "Worthington", "Wrentham", "Yarmouth",
];

const isTown = new Set(TOWNS);

// The name on the list that one not on it was probably meant to be: a slip of case or of
// a single letter, "-boro" for "-borough", the Census Bureau's "Amherst Town", or the start
// of a longer name ("Manchester"). Only ever a hint in a message, and a careful one: two
// letters apart would offer Rochester for Dorchester, which is a part of Boston.
function nearestTown(name) {
  const fold = t => t.toLowerCase().replace(/ (town|city)$/, "").replace(/borough\b/, "boro").replace(/[^a-z]/g, "");
  const steps = (a, b) => {                  // edit distance, one row at a time
    let row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++)
        next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row = next;
    }
    return row[b.length];
  };
  const want = fold(String(name));
  if (want.length < 4) return null;          // too short to tell a slip from another name
  const starts = TOWNS.filter(t => fold(t).startsWith(want));
  if (starts.length === 1) return starts[0];
  const close = TOWNS.filter(t => steps(want, fold(t)) < 2);
  return close.length === 1 ? close[0] : null;
}

// What is wrong with an entry's `town`, in the validator's words, or null when nothing
// is. The KPI summary counts by town, so a misspelled one would quietly move an entry
// out of its town: a missing or unknown town is an error, not a warning.
function townProblem(town) {
  if (!TOWNS.length) return null;
  if (town === undefined)
    return `missing town — add the city or town the pin sits in, e.g. "town: Cambridge"`;
  if (isTown.has(town)) return null;
  const near = nearestTown(town);
  return `town ${JSON.stringify(town)} is not a Massachusetts city or town — ` + (near ? `did you mean "${near}"?`
    : "a neighborhood or village goes in loc, and town names the city or town it is part of (the list is in scripts/towns.js)");
}

module.exports = { TOWNS, townProblem };

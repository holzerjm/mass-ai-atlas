# Migrating a map from CARTO to OpenFreeMap

**A self-contained playbook.** This documents how the Mass AI Atlas moved its
basemap off CARTO and onto OpenFreeMap (commit `c811833`, 2026-08-30), written so
that another maintainer — or another Claude Code session working on a different
map page — can perform the same migration without any other context. Hand this
file (or its raw GitHub URL) to the session doing the work.

---

## 1. Why we moved

- CARTO's free raster basemaps (`basemaps.cartocdn.com`) began **requiring an API
  key** — keyless pages silently degraded to watermarked/withheld tiles. A free
  key works but is another credential to manage per page, with usage quotas.
- Alternatives we evaluated: **Google Maps** (paid, restrictive ToS for this use),
  **raw OSM tiles** (tile-usage policy disallows production traffic, no dark
  style), **Stadia / MapTiler** (free tiers, but keyed), **OpenFreeMap** —
  keyless, no quota, no signup, commercial use permitted, vector tiles,
  self-hostable if it ever disappears. OpenFreeMap won.
- Bonus: vector tiles render crisper at every zoom, theme without re-downloading,
  and remove the retina `{r}` raster hack.

## 2. The architecture (important: Leaflet stays)

Do **not** rewrite the page to MapLibre. If the page uses Leaflet (markers,
clusters, popups, controls), keep Leaflet as the engine and swap only the base
layer: the **`maplibre-gl-leaflet`** plugin renders a MapLibre GL vector layer
*as a Leaflet layer*. Every existing marker/cluster/popup/control keeps working
untouched — the atlas changed ~15 lines of app code total.

```
Leaflet map (unchanged: markers, clusters, popups, controls)
  └─ base layer: L.maplibreGL({ style }) ── maplibre-gl-leaflet 0.1.4
       └─ MapLibre GL JS 5.x ── vector tiles + fonts + sprites from tiles.openfreemap.org
```

## 3. Step-by-step

### Step 0 — find the CARTO usage

```bash
grep -n "cartocdn\|carto.com" *.html
```

Typical hit (this is what the atlas had):

```js
const TILE_URLS = {
  dark:  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=…",
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=…"
};
mapTiles = L.tileLayer(TILE_URLS[currentTheme()], {
  attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  subdomains:"abcd", maxZoom:19
}).addTo(map);
```

### Step 1 — add the two libraries (pinned versions we ship)

In `<head>`:

```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.min.css">
```

With the other scripts, **after** Leaflet and **before** your app code:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.min.js"></script>
<script src="https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js"></script>
```

The CSS matters — without it the GL canvas mis-sizes and attribution breaks.

### Step 2 — replace the tile layer

```js
// OpenFreeMap vector basemap via maplibre-gl-leaflet — keyless, unlimited,
// commercial use permitted. Leaflet stays the map engine; only the base layer
// renders through MapLibre GL.
const MAP_STYLES = {
  dark:  "./map-style-dark.json",                          // see Step 4
  light: "https://tiles.openfreemap.org/styles/positron"   // hosted, keyless
};
const makeBasemap = () => L.maplibreGL({
  style: MAP_STYLES[currentTheme()],
  attribution:'&copy; <a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
});
mapTiles = makeBasemap().addTo(map);
```

Delete the CARTO URLs, the key, `subdomains:"abcd"`, and the `{r}` retina
placeholder — none of it applies. Keep `maxZoom` on the *map*, not the layer.

### Step 3 — theme switching changes shape

Raster theme-swaps used `setUrl()`. A GL layer has no `setUrl` — **remove and
recreate** the layer instead:

```js
function setMapTiles(){
  if(!map) return;
  if(mapTiles) map.removeLayer(mapTiles);
  mapTiles = makeBasemap().addTo(map);
}
```

Call `setMapTiles()` from the existing theme-toggle handler. Overlay layers
(markers, clusters) are untouched and stay on top — Leaflet keeps the GL layer
in the tile pane by default.

### Step 4 — pick the dark style (the only real design work)

- **Light pages:** the hosted `positron` style above is a drop-in for CARTO
  `light_all`. Done.
- **Dark pages:** OpenFreeMap's hosted **`fiord`** style
  (`https://tiles.openfreemap.org/styles/fiord`) is the dark starting point —
  but out of the box it lacks some of CARTO `dark_all`'s labels: **highway
  shields (I-90/I-93/RT-3), airport labels, river/waterway name labels, ferry
  route labels**. If the page is label-sensitive, don't ship it as-is.
- The atlas's answer: a **repo-owned style file**,
  [`map-style-dark.json`](../map-style-dark.json) — fiord, plus the missing
  label layers grafted in from positron and recolored to fiord's palette (label
  text `hsl(223,21%,52%)`, halo `hsl(232,5%,19%)`). Tiles, sprites and glyph
  fonts still load from OpenFreeMap; only the style JSON is ours.
- **Shortcut for new pages: copy `map-style-dark.json` from the atlas repo**
  (raw URL below), serve it next to your page, and reference it with a relative
  path as in Step 2. It is self-contained and works for any Boston-area (or
  worldwide) page. Owning the style file also means the dark look is under
  version control and immune to upstream style changes.

### Step 5 — attribution (required)

OpenStreetMap's license requires attribution; OpenFreeMap asks for credit too.
Use the attribution string in Step 2 verbatim. Remove the CARTO credit.

## 4. Verification checklist (what actually bit us)

Run the page locally and check, in **both themes**:

- [ ] Tiles render with **no watermark and no key** anywhere in the page source
      (`grep -i "cartocdn\|key=" page.html` comes back empty).
- [ ] **Label parity** where it matters: interstate shields (I-90, I-93),
      airport label (Logan), river names (Charles), ferry routes. This is where
      hosted dark styles fall short — compare against the light theme
      deliberately, feature by feature. (This exact gap is why
      `map-style-dark.json` exists.)
- [ ] Theme toggle swaps the basemap without losing markers, clusters, popups,
      or custom controls, and without a stuck old canvas.
- [ ] Markers/overlays still render **above** the basemap.
- [ ] Browser console: no GL errors, no 404s for sprites/glyphs.
- [ ] Mobile width: canvas resizes correctly (the maplibre CSS from Step 1).
- [ ] If previewing in an embedded browser pane: it caches hard — reload with a
      cache-busting query (`?cb=2`) before concluding something "didn't work".

## 5. Operational notes

- **No key, no quota, nothing to rotate.** Any CARTO key the page used can be
  left to lapse once every page is migrated.
- **Fallback host** if OpenFreeMap ever degrades: VersaTiles
  (`colorful`/`eclipse` styles) — swapping means changing only the style URLs.
  Self-hosting OpenFreeMap tiles is also supported by the project.
- Styles are Positron/Fiord derivatives (BSD/CC0-licensed OpenMapTiles styles);
  data is © OpenStreetMap contributors (ODbL) — hence the attribution line.

## 6. Reference implementation

- Live page: <https://the-open-accelerator.com/ecosystem/> (toggle the theme)
- Code: `index.html` — search for `OpenFreeMap vector basemap` (basemap block,
  `MAP_STYLES`, `makeBasemap`, `setMapTiles`)
- Dark style: [`map-style-dark.json`](https://raw.githubusercontent.com/holzerjm/mass-ai-atlas/main/map-style-dark.json)
- The migration commit: `c811833` "Migrate basemap to OpenFreeMap" in
  <https://github.com/holzerjm/mass-ai-atlas>

## 7. Kickoff prompt for a Claude Code session

Paste something like this into the session that owns the page being migrated:

> Migrate this page's map from CARTO to OpenFreeMap by following
> https://raw.githubusercontent.com/holzerjm/mass-ai-atlas/main/docs/carto-to-openfreemap.md
> exactly — keep Leaflet as the engine, use the pinned library versions from the
> playbook, copy the atlas's `map-style-dark.json` if the page has a dark theme,
> and run the playbook's verification checklist in both themes with a preview
> before anything deploys.

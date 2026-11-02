# Add an entry to the Mass AI Atlas — a click-by-click walkthrough

**For:** anyone helping maintain the atlas. **No coding needed** — everything is done in
a web browser on github.com. **Time:** about 10–15 minutes per entry.

> This is the friendly, hand-it-to-anyone version. For the full reference (all fields,
> flag handling, troubleshooting) see [`MAINTAINING.md`](../MAINTAINING.md).

When someone fills in the **"➕ Suggest an entry"** form, it becomes a GitHub *issue* — a
wish-list note. Your job is to turn it into a real entry in the file `data/entities.yml` and save it
as a *pull request* (a proposed change). Here's how, start to finish.

---

## Step 1 — Open the suggestion

1. Go to the repo → **Issues** tab.
2. Click the suggestion you're working on. You'll see the org name, website, category,
   address, description, and so on.

## Step 2 — Look up the map pin (the only thing the form doesn't ask for)

The form gives you an **address** but not the map coordinates. Get them in 20 seconds:

1. Open **[Google Maps](https://www.google.com/maps)** and search the address.
2. **Right-click** the exact spot.
3. The first menu item is two numbers, e.g. `42.3626, -71.0843`. **Click it** to copy.
4. The **first** number is `lat`, the **second** is `lng`. Hold onto them for Step 3.

> No fixed address (a meetup that moves venues)? Use the neighborhood (e.g. "Kendall Sq")
> and add `approx: true` to the entry.

## Step 3 — Fill in the entry

Copy this template into a notes app and replace the blanks:

```yaml
- id: 
  name: 
  cat: 
  loc: 
  lat: 0
  lng: 0
  url: https://
  desc: 
  why: 
  tags: []
  stages: []
  links: []
  offers: []
  added: 
  lastVerified: 
```

> **YAML tips.** Keep the shape exactly: `- id:` at the very start of the line, every
> other field indented by **two spaces**, no commas at line ends. Text needs no quotes —
> *unless* it contains a colon followed by a space (`: `) or ` #`, or starts with a quote,
> bracket, `&`, `*`, `!`, `|`, `>`, `%` or `@`. Then wrap the whole value in double
> quotes, e.g. `name: "Acme: The AI Lab"`.

| Field | What to put |
|------|-------------|
| `id` | A short nickname in **lowercase-with-hyphens** you invent from the name (e.g. `Acme AI` → `acme-ai`). Must be unique. |
| `name` | The display name. |
| `cat` | The category **code** — translate the form's label with the table below. |
| `loc` | The street address (or neighborhood). |
| `lat`, `lng` | The two numbers from Step 2. |
| `url` | The website. **Must start with `https://`** |
| `desc` | 1–2 plain, factual sentences (max 400 characters). Trim any marketing language. |
| `why` | One sentence: why an early-stage founder should care. |
| `tags` | 2–4 short lowercase tags, in square brackets: `[robotics, lab space]` |
| `stages` | The founder stages it serves, as **numbers** — see the table below: `[1, 3]` |
| `links` | Usually leave as `[]`. (Advanced: ids of related entries.) |
| `offers` | **Required.** What founders *get*, 1–6 of: `funding` · `grants` · `space` · `compute` · `mentorship` · `community` · `talent` · `customers`. This is what powers the "I need…" filter: `[funding, mentorship]` |
| `added` | Today's month as `YYYY-MM` (e.g. `2026-08`) — when the entry joined the atlas. The app uses it for the "✨ New" highlight. |
| `lastVerified` | Today's month as `YYYY-MM` (e.g. `2026-08`) — you just verified it by building this entry. |

**Category — form label → `cat` code:**

| Form says | Use |
|---|---|
| AI Companies & Startups | `startup` |
| Venture Capital | `vc` |
| Angel Groups | `angel` |
| Accelerators & Founder Support | `accel` |
| University Labs & Centers | `university` |
| Corporate AI Labs | `corporate` |
| Communities & Meetups | `community` |
| Major Events | `event` |
| Government & Policy | `gov` |
| Spaces & Hubs | `space` |
| Student Groups | `student` |

**Stages — checkbox → number** (list every box they ticked, e.g. Build + Fund → `[3, 4]`):

| Checkbox | Number |
|---|---|
| 💡 Spark | `1` |
| 🔬 Validate | `2` |
| 🔧 Build | `3` |
| 💸 Fund | `4` |
| 🚀 Scale | `5` |

## Step 4 — Add it to `data/entities.yml`

1. Open the **`data`** folder, click **`entities.yml`**, and click the **pencil ✏️ icon**
   ("Edit this file").
   *If GitHub mentions making "your own copy" or a "fork," that's normal — just continue.*
2. Press **Cmd-F** (Mac) / **Ctrl-F** (Windows) and type the category banner, e.g.
   `VENTURE CAPITAL`. The file is grouped into sections like
   `# ---------- VENTURE CAPITAL ----------`.
3. Click at the start of the line just below that banner and **paste** your entry there,
   among the other entries (order within a section doesn't matter).
4. Check the indentation: `- id:` starts at the very left, every other line of your
   entry is indented by two spaces.

## Step 5 — Save it as a pull request

1. Scroll to the **"Commit changes"** box at the bottom.
2. Message: `Add <Org Name> (closes #<issue number>)` — the `closes #` part auto-closes the
   suggestion when this is merged.
3. Choose **"Create a new branch for this commit and start a pull request."**
4. Click **Propose changes** → **Create pull request**.

## Step 6 — Green check, then publish

1. A check named **"Validate atlas data"** runs automatically (~1 minute).
   - **Green ✓** → continue.
   - **Red ✗** → click **Details** to see the message, fix it (Step 4 again), and re-commit.
     See the troubleshooting table in [`MAINTAINING.md`](../MAINTAINING.md).
2. When it's green, click **Merge pull request → Confirm merge** (or leave the final merge
   to a maintainer). The suggestion closes itself. 🎉
3. **Publishing to the live site** needs no separate step: the merge itself starts the
   deploy. See [`MAINTAINING.md`](../MAINTAINING.md#part-3--publish-to-the-live-site) →
   *Publish to the live site* for what it does and what to do if it fails.

---

## A complete worked example

A suggestion comes in: *Epipelagic Ventures · https://www.epipelagic.vc · Venture Capital ·
1 Broadway, Cambridge · "founder-first venture studio…" · stages: Build + Fund.* You look up
`1 Broadway, Cambridge` in Google Maps → `42.3626, -71.0843`, translate **Venture Capital →
`vc`** and **Build + Fund → `[3, 4]`**, and write:

```yaml
- id: epipelagic
  name: Epipelagic Ventures
  cat: vc
  loc: 1 Broadway, Cambridge
  lat: 42.3626
  lng: -71.0843
  url: https://www.epipelagic.vc
  desc: A founder-first venture studio in Kendall Square that surrounds early-stage startups with capital, mentorship and hands-on operational support to reach their next milestone.
  why: A hands-on venture-studio model for pre-seed founders — especially edtech, consumer, health and wellness, or moonshot ideas — pairing funding with active build support.
  tags: [venture studio, early stage]
  stages: [3, 4]
  links: []
  offers: [funding, mentorship]
  added: 2026-08
  lastVerified: 2026-08
```

…then paste it into the `# ---------- VENTURE CAPITAL ----------` section. Done.

---

*Questions? Ask in the TOA maintainers channel. The automatic checker's exact rules live in the schemas in
[`data/`](../data/) and in [`scripts/validate.js`](../scripts/validate.js).*

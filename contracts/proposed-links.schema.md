# Contract 1: `proposed-links.json` (Arsh → chatbot) · FROZEN

Writer: Arsh (`survey/`). Reader: Karthik and Bhoomika (`chatbot/`).
Any change to ids, fields or this format: Arsh gives the team a heads-up first, and
Bhoomika commits the change here.

## File

- Path: `survey/out/proposed-links.json`. The chatbot reads it from the `LINKS_PATH` env var.
  Until the real file exists, `LINKS_PATH=contracts/sample-proposed-links.json`.
- UTF-8. **One JSON array**, one object per proposed link. An empty array `[]` is valid.

## Row

```json
{"from_id":"sbxi","to_id":"mit-sandbox","relation":"program_of",
 "source_url":"https://github.com/holzerjm/mass-ai-atlas/blob/7d06de1.../data/entities.yml#L1893",
 "quote":"grew out of the MIT Sandbox program.",
 "confidence":"high",
 "status":"approved"}
```

| Field | Type | Notes |
|---|---|---|
| `from_id` | string | Must exist in `atlas.json`. The entry whose `links` list gains `to_id` |
| `to_id` | string | Must exist in `atlas.json`. Never equal to `from_id` |
| `relation` | enum | See **Relation** below |
| `source_url` | string | A public `https://` page. **The `quote` must appear on this page.** No URL means no row |
| `quote` | string | The exact sentence, or the exact part of a sentence, copied from `source_url`. No paraphrase. No personal names |
| `confidence` | enum | `high`, `medium` or `low` |
| `status` | enum | `approved` (a human said yes), `pending` (not reviewed yet) or `rejected` (a human said no, or the source doesn't support it) |

Each (`from_id`, `to_id`) pair appears at most once. If it appears twice, the reader keeps
the last row.

## Relation

`data/entities.schema.yml` defines `links` as **a plain list of entry ids, with no type**.
So `relation` is a **display label for the chatbot only**. The apply step on `proposals`
writes only `to_id` into `from_id`'s `links`, and never writes `relation`.

Allowed values (Arsh: confirm or extend at the start, then tell the team):

| Value | Means |
|---|---|
| `program_of` | `from` is a program run by, or grew out of, `to` |
| `partner` | the two orgs run something together (a program, a collaboration, a space) |
| `funded_by` | `to` has invested in or funded `from` |
| `hosted_at` | `from` is based in or runs out of `to`'s space |
| `related` | a sourced connection that fits none of the above |

## How the chatbot uses it

| `status` | `before` mode | `after` mode |
|---|---|---|
| `approved` | hidden | shown as a connection, marked **new**, with the quote and source link. It clears the "no connections" doubt on `from_id` |
| `pending` | hidden | shown only as **"proposed, needs review"**. It never clears a doubt |
| `rejected` | hidden | **never shown** |

- A link counts for `from_id` (the entry whose `links` field changes), because that's what
  moves probe 2. Propose links **from the isolated entry's side**.
- The reader drops any row with an unknown id, a missing `source_url` or `quote`, or an
  unknown `status`. It never crashes on a bad row.

## Probe 2 numbers (from `chatbot/data/atlas.json`)

- **`104`** entries have no `links` field. This matches the organizers' "zero edges" count,
  and the chatbot's "no connections" doubt uses this definition.
- **`74`** entries have no edges in either direction (nobody links to them either).
  This was our earlier count.

## About `contracts/sample-proposed-links.json`

Five rows with real Atlas ids: 2 approved, 2 pending, 1 rejected. Each quote is copied
exactly from that org's own Atlas `desc` or `why`. The `source_url` is the GitHub line at
upstream commit `7d06de1`, so the quote is on the page you land on. These are
**development sample rows, not reviewed proposals**. Arsh's real rows come from the orgs'
own public pages.

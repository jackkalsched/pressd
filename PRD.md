# Press'd — Product Requirements Document

**Version:** 0.1 (Draft)
**Author:** Jack Kalsched
**Date:** 2026-05-20

---

## 1. Overview

Press'd is a personal music rating platform that replaces a hand-maintained Excel workbook with a structured, interactive interface. It allows Jack to log new albums by rating individual songs and album-level external factors, watch the rating formula compute in real time, and explore the full catalogue through leaderboards, statistics, and artist breakdowns. spotdl metadata enriches every entry automatically. A future Essentia ML layer will add audio-feature and genre classification derived from the actual audio files.

---

## 2. Background & Problem Statement

The current system is a single Excel file (`Jack Kalsched Album Rankings.xlsx`) with:
- ~150 artist-specific sheets, each holding albums as column-groups (songs + 4 factor rows)
- A master `Record Ratings` sheet (346 albums)
- A `Song Ratings` sheet (4,639 songs)
- A `More Data` sheet with per-artist sabermetric-style stats
- A `Year By Year` sheet

Pain points:
- Adding a new album requires manually creating a column group on the artist sheet, then copying data to Record Ratings and Song Ratings
- The rating formula is opaque — it lives in cell formulas scattered across sheets
- No way to search, filter, or visualize without building ad hoc pivot tables
- No metadata beyond what is typed by hand (no album art, duration, popularity, audio features)
- `#DIV/0!` errors on albums with no song ratings yet — incomplete entries break aggregations

---

## 3. Goals

1. **Log** new albums in one flow: search Spotify → pull spotdl metadata → rate songs → rate external factors → submit.
2. **Transparency**: show the rating formula as a live calculation during entry.
3. **Explore**: replicate and extend all existing Excel views (Record Ratings, Song Ratings, Year By Year, More Data) as interactive tables with sort/filter.
4. **Summarize**: provide dashboards and statistics at the album, artist, year, and genre level.
5. **Enrich**: auto-attach spotdl metadata (Spotify popularity, duration, track numbers, album art) to every album and song.
6. **Future — ML**: integrate Essentia audio analysis (genre classification, BPM, key, mood, energy, danceability) on downloaded audio.

---

## 4. Users

Single-user personal tool (Jack). No auth system needed for v1 beyond local-only access.

---

## 5. Data Model

### 5.1 Album

| Field | Source | Notes |
|---|---|---|
| `album_name` | User / spotdl | |
| `artist` | User / spotdl | |
| `year` | User / spotdl | Release year |
| `status` | User | `to_listen` · `listening` · `rated` |
| `score` | Computed | See §6 — Rating Formula. Null until status = `rated` |
| `theme` | User | 0–10. Null until status = `rated` |
| `replay_value` | User | 0–10. Null until status = `rated` |
| `production` | User | 0–10. Null until status = `rated` |
| `distinctness` | User | 0–10. Null until status = `rated` |
| `genre` | User | Primary genre tag |
| `sub_genre` | User | Up to 2 sub-genre tags |
| `spotify_id` | spotdl | |
| `album_art_url` | spotdl | |
| `total_tracks` | spotdl | |
| `date_added` | System | When added to any list |
| `date_rated` | System | When status flipped to `rated` |

### 5.2 Song

| Field | Source | Notes |
|---|---|---|
| `title` | User / spotdl | |
| `score` | User | 0–10 (0.1 increments) |
| `a_score` | Computed | `(15 × score − 14) / 13` — normalizes 9.6→10.0 |
| `artist` | spotdl | |
| `album` | FK | |
| `track_number` | spotdl | |
| `duration_ms` | spotdl | |
| `spotify_popularity` | spotdl | 0–100 |
| `explicit` | spotdl | bool |
| `spotify_id` | spotdl | |
| `is_skip` | Computed | score < 6.5 |
| `is_bang` | Computed | score ≥ 8.0 |

### 5.3 Artist Stats (derived — `More Data` equivalent)

Computed on the fly from Song and Album tables:

| Metric | Definition |
|---|---|
| `count` | Total songs rated |
| `avg_song_score` | Simple average of raw scores |
| `wavg_song_score` | Weighted average (track-length weighted) |
| `a_ci` | Consistency Index — variance-based |
| `sar` | Songs Above Replacement (WAR equivalent) |
| `sar_ps` | SAR per song |
| `skip_pct` | % songs below skip threshold |
| `bang_pct` | % songs above bang threshold |
| `song_plus` | Normalized quality index (OPS+ equivalent) |
| `w_song_plus` | Weighted version |

---

## 6. Rating Formula

The album `score` combines song performance with external factor ratings:

```
avg_a_score   = mean( a_score for all rated songs on album )
album_score   = (avg_a_score × 0.60)
              + (theme        × 0.10)
              + (replay_value × 0.10)
              + (production   × 0.10)
              + (distinctness × 0.10)
```

Where `a_score = (15 × raw_score − 14) / 13` scales the top score (9.6) to exactly 10.

Weights (v1, adjustable):

| Component | Weight |
|---|---|
| Avg Song aScore | 60% |
| Theme | 10% |
| Replay Value | 10% |
| Production | 10% |
| Distinctness | 10% |

The interface must expose these weights as visible, editable constants so the live preview is self-explanatory and weights can be tuned without code changes.

---

## 7. Feature Requirements

### 7.1 Album Logging Flow

The logging flow mirrors Letterboxd / TV tracker conventions. Albums move through three statuses: **To Listen → Listening → Rated**.

---

**Screen 1 — Album Search**

**FR-01** — Search & Import  
User types an album name or Spotify URL into a search bar. Results appear as a list of album cards (album art, title, artist, year). Each card has two actions:
- **"Add to List"** — saves the album with status `to_listen`. No rating screen opened.
- **"Rate"** — saves the album with status `listening`, fetches spotdl metadata, and navigates to the Rating Screen.

If an album already exists in the library with status `to_listen` or `listening`, the search result card reflects that status and the button changes to **"Continue Rating"** or **"Start Rating"** accordingly.

The app calls spotdl's save command in the background and parses the `.spotdl` JSON to pre-fill: album name, artist, year, track list in track-number order, album art, durations, popularity, and track numbers. User is navigated to Screen 2 once the metadata fetch completes (show a loading state during fetch).

---

**Screen 2 — Rating Screen**

A single, dedicated page for rating the album. Layout:

- **Header:** Album art (large), album name, artist, year
- **Track list:** All songs displayed in track order (1, 2, 3…). Each row shows track number, song title, and a rating input (0–10, 0.1 increments). Songs that are skits/interludes can be marked `--` (unratable).
- **External Factors section:** Below the track list — four inputs for Theme, Replay Value, Production, Distinctness (0–10 each).
- **Genre section:** Primary Genre dropdown + up to 2 Sub-Genre dropdowns (seeded from existing data).
- **Live Score Card (sticky/fixed):** Visible at all times as ratings are entered — see FR-04.
- **Submit button:** Disabled until all songs have a rating (or `--`) and all four external factors are filled. No partial saves.

**FR-02** — Enforced Sequential Entry  
Songs are presented in track order and must be rated top-to-bottom. A song's input is only enabled once the song above it has been rated. The currently active song is visually highlighted. This mirrors the experience of listening through the album in order.

**FR-03** — External Factor Entry  
The four external factor inputs (Theme, Replay Value, Production, Distinctness) are unlocked only after all songs have been rated. They appear below the track list and follow the same 0–10 scale.

**FR-04** — Live Score Preview  
A sticky score card (sidebar on desktop, bottom bar on narrow viewports) updates in real time as ratings are entered:
- Avg Song aScore: `X.XX` (updates per song)
- Theme: `X.XX` / Replay Value: `X.XX` / Production: `X.XX` / Distinctness: `X.XX`
- **Final Score: X.XX** (grayed out until all inputs are complete)
- Color coding per song row: bang (≥ threshold, green), skip (≤ threshold, red), neutral (grey)

**FR-05** — Submit  
Submit button becomes active once all songs and all four external factors are rated. On submit, album status is set to `rated`, `date_rated` is recorded, and the user is returned to the main view with the new album visible in the Rated leaderboard.

At any point before submitting, the user can save progress and exit — the album remains in `listening` status and can be resumed later from the Library.

**FR-06** — Submit & Save  
On submit, album and all songs are written to the database. The entry immediately appears in all views.

---

### 7.2 Views & Tables

**FR-09 — Library (Status Hub)**  
The primary navigation view. Three tabs — **To Listen**, **Listening**, **Rated** — each showing an album card grid.

- **To Listen:** Albums queued up. Cards show art, title, artist, year. Actions: "Start Rating" (moves to `listening`) or remove.
- **Listening:** Albums with a rating in progress. Cards show art, title, artist, and a progress indicator (e.g. "7 / 12 songs rated"). Action: "Continue Rating" resumes the Rating Screen where the user left off.
- **Rated:** All fully rated albums as a card grid, sorted by date rated (most recent first) by default. Clicking a card opens the album detail view.

**FR-10 — Record Ratings (Master Leaderboard)**  
Replicates the `Record Ratings` sheet. Only includes albums with status `rated`. Sortable/filterable table: Album, Artist, Year, Score, Theme, Replay Value, Production, Distinctness, Genre. Includes album art thumbnails.

**FR-11 — Song Ratings**  
Replicates `Song Ratings`. Columns: Song, Score, aScore, Artist, Album, Year. Global search. Filter by artist or album.

**FR-12 — Year By Year**  
Grid of columns per year (2017–present), each showing albums ranked by score for that year. Matches current Excel layout but interactive.

**FR-13 — More Data (Artist Leaderboard)**  
Table of all artists with computed stats: Count, AVG, wAVG, aCI, SAR, SARps, Skip%, Bang%, Song+, wSong+. Sortable. Clicking an artist opens the artist detail view.

**FR-14 — Artist Detail View**  
Per-artist page showing:
- All albums in chronological order with scores
- All songs for that artist sorted by score
- Artist-level stat card (from FR-13)
- Album art grid

---

### 7.3 Statistics & Dashboards

**FR-20 — Summary Stats Card**  
Top of the app: total albums rated, total songs rated, overall average score, top album, top song.

**FR-21 — Genre Breakdown**  
Bar or pie chart: album count and average score by genre and sub-genre.

**FR-22 — Score Distribution**  
Histogram of album scores and song scores across the full catalogue.

**FR-23 — Year Trends**  
Line chart of average album score by year. Secondary line: albums logged per year.

**FR-24 — Artist Comparison**  
Select 2–4 artists → radar/spider chart of avg song score, consistency (aCI), bang%, SAR.

**FR-25 — Top N Lists**  
Quick-access panels: Top 25 Albums, Top 50 Songs, Highest SAR Artists, Most Consistent Artists.

---

### 7.4 spotdl Metadata Integration

**FR-30 — Auto-fetch on Import**  
When user submits an album URL or title, the app runs:
```
spotdl save <spotify_album_url> --save-file temp.spotdl
```
Parses the resulting JSON and populates all spotdl-sourced fields (see §5.1, §5.2).

**FR-31 — Album Art Display**  
Album art shown in the logging flow, album detail view, and all leaderboard tables (as thumbnail).

**FR-32 — Duration & Popularity Display**  
Song table and artist detail view show track duration and Spotify popularity alongside user scores.

**FR-33 — Metadata-Aware Stats**  
Length-weighted average song score (existing `wAVG Song Score`) uses spotdl duration data rather than assuming equal track weights.

---

### 7.5 Essentia ML Integration (Phase 2)

> Requires downloaded audio files. spotdl can download audio; Essentia runs locally.

**FR-40 — Audio Feature Extraction**  
For each downloaded track, run Essentia's standard audio feature pipeline to extract:
- BPM / tempo
- Key and mode
- Loudness (LUFS)
- Danceability
- Energy
- Speechiness

**FR-41 — Genre Classification**  
Run Essentia's pre-trained genre classification model (Discogs400 or equivalent). Store predicted top-3 genre labels and confidence scores alongside user-assigned genre.

**FR-42 — Genre Agreement Display**  
On album and song detail views, show side-by-side: Jack's genre vs. Essentia's predicted genre.

**FR-43 — Feature-Based Filtering**  
In song and album tables, add filter sliders for BPM range, energy, danceability — enabling queries like "high-energy songs rated above 8.5."

**FR-44 — Mood/Cluster View (exploratory)**  
2D scatter (UMAP on Essentia feature vectors) colored by user score — visual exploration of the catalogue's sonic space.

---

## 8. Tech Stack (Proposed)

| Layer | Option | Rationale |
|---|---|---|
| Backend / DB | Python + SQLite (via SQLModel or Peewee) | Simple, local, no server needed |
| API | FastAPI | Lightweight, auto-docs, async |
| Frontend | React + Vite + Tailwind | Fast iteration, component ecosystem |
| Tables | TanStack Table | Sort/filter/virtual scroll for large tables |
| Charts | Recharts or Plotly | Both have React wrappers |
| spotdl | CLI subprocess + JSON parse | Already works from command line |
| Essentia | Python (essentia-tensorflow) | Pre-trained models available |
| Packaging | Electron (optional, Phase 2) | If desktop app is preferred over localhost |

---

## 9. Migration

The existing Excel file contains 346 albums and 4,639 songs. A one-time migration script should:
1. Parse `Record Ratings` for all albums + external factor scores + genres.
2. Parse each artist sheet to extract per-song scores per album.
3. Parse `Song Ratings` for any songs not captured in artist sheets.
4. Write all records to the SQLite database.
5. Backfill spotdl metadata for all existing albums in a batch job.

Entries with `#DIV/0!` (albums missing song ratings) are imported as album shells with no song scores — they show as "incomplete" in the UI.

---

## 10. Out of Scope (v1)

- Multi-user / sharing
- Social features (following, comments)
- Integration with Last.fm or RateYourMusic
- Mobile app
- Streaming playback within the app
- Automatic re-rating suggestions

---

## 11. Open Questions

~~Preferred local-only vs. potential cloud sync in the future?~~ → **Local-only for v1.** Cloud sync deferred indefinitely.

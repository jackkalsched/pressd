# Taste overlap — design

2026-11-03. Brainstormed with Jack; decisions marked **(Jack)** are his, **(call)** are
mine and open to correction. Everything else is context.

## 1. Intent

Pressd is meant to be social, and today it mostly isn't: of 1,953 pairs of users with
scored songs, 1,803 have never scored the same song. Taste overlap is a percentage
between any two users whose job is to **get people to open each other's profiles, add
each other, and talk in the discussion boards** — not to judge them. A low number is an
invitation to argue about a record, never a rejection. **(Jack)**

It shows up in two places:

1. **Every profile** you open, under the person's name. **(Jack)**
2. **A pop-up after every album rating**, suggesting three people to add, tied to the
   record just rated. **(Jack)**

### Success (Jack)

A month after launch, compared with the month before:

- more friend requests sent,
- larger friend networks (accepted friends per user),
- a higher share of rated albums whose rater also posts in that album's discussion.

### Anti-goals (Jack)

- Most pairs bunched at the extremes (lots of 5% and 98%).
- Most pairs bunched in the middle (everyone 45–60%).
- A number that discourages adding someone.

### Non-goals

- Text embeddings or a sequence model. (Matrix factorization *is* in scope: §3.)
- A friends-of-friends graph signal. Too few friendships exist for it to mean anything.
- Changing how albums, songs or predictions are scored.

## 2. What the number means

- **Always a percentage**, for every pair, never blank or "not enough data". **(Jack)**
- **0% = opposite**, **50% = no evidence either way**, **100% = the same taste**.
  50% also covers "lots of evidence, no relationship" — that's accepted. **(Jack)**
- **Relative to each person's own scale.** Each user's scores are read against their own
  mean and spread (z-scores), so a harsh scorer and a generous one who agree on what's
  better and worse can reach 100%. **(Jack)**
- **Symmetric.** You and maya.r see the same number. **(call)**
- **Evidence moves it, thin evidence moves it a little.** One near-identical album with
  nothing else shared lands a little above 50%. Pairs who share no songs at all but rate
  the same genres and artist clusters alike **can reach the 70s or the 20s**. **(Jack)**
- **Spread.** On real data the curve should put most pairs that have *some* evidence
  roughly between 25% and 85%, with a thin tail at each end. **(Jack's anti-goals; the
  25–85 band is my call)**
- **Steady.** A pair's number shouldn't jump overnight when neither person rated anything
  new. **(call)**

## 3. How it's computed

### 3.1 The data today (read-only production check, 2026-11-03)

| | |
|---|---|
| Accounts | 102; 57 with a rated album, 12 with ≥10, 2 with ≥50; median 2 |
| Concentration | user 1 holds 58% of rated albums and 59% of song scores |
| Pairs sharing no scored song | 92% (1,803 of 1,953) |
| Pairs sharing no rated record | 92% (1,473 of 1,596) |
| Pairs sharing no artist / cluster / genre | 90% / 70% / 54% |
| Pairs sharing ≥10 scored songs | 115, of which 39 include user 1 |
| Their agreement, on the 0–100 scale (5/25/50/75/95th pct) | 41 / 52 / 63 / 74 / 86 |

The script that produced this lived in the session scratchpad and is not in the repo.

Consequence: direct comparison decides the number for the 8% of pairs that share
records; for everyone else, genres, subgenres, artist clusters and album features do.

### 3.2 Approach: matrix factorization first (Jack)

Jack wants the backend built on **matrix factorization first, to see how it works**,
before settling on anything else. So the first build is a factorization model, and the
layered approach in §3.3–3.4 is the **baseline it is measured against** (and the
fallback if it loses).

**The matrix.** Rows are users. Columns, as agreed in discussion **(Jack)**:

- every scored **song** (`track_id`),
- every rated record's **four external factors** (`subject_key` × theme / replay value /
  production / distinctness),
- each user's **aggregate** score per **artist** (via `album_artists` / `song_artists`),
  per **artist cluster** and per **genre / subgenre** — these are what connect the 92%
  of pairs who share no song,
- the **final album score**: requested, but it is the song mean plus the factor
  adjustments and drifts with the userbase prior, so include it **only if the §3.5 test
  shows it helps** **(call)**.

**The model.**

- Prediction = global mean + **user bias per column type** + item bias + user · item.
  Per-column-type user biases are what make the number relative to each person's own
  scale (§2): a harsh scorer of songs can be a generous scorer of production. Each
  user's scores are also z-scored per column type before fitting. **(call)**
- **Column-type weights** stop one opinion counting five times (a song score also feeds
  its artist, cluster and genre aggregates). Tuned in §3.5.
- Aggregates from one album are shrunk toward the user's mean before entering the
  matrix.
- **Small rank** (a handful of dimensions) and strong regularisation — the data won't
  support more. ALS or SGD, fitted in the worker (numpy is available there).
- A user's vector after one rating is **folded in** (solved against the fixed item
  vectors) without refitting, so new users get a number immediately; with so little
  evidence it stays near the middle.

**Overlap from the model.** Cosine similarity of the two users' vectors, **shrunk toward
0 by how much evidence stands behind the pair** (shared columns, and bridges through
other users), mapped to `50 + 50·r`, then through one monotone curve tuned to §2's spread.
Shrinkage matters here: factorization can place two users close on the strength of one
third person, and that should not read as a confident 90%.

**Risks to watch** (from §3.1): user 1 holds 59% of song scores, so the model may mostly
learn "how close are you to user 1"; and indirect matches resting on one bridge are weak.
Report, for the fitted model, how many high-overlap pairs share no column and depend on
user 1 as the main bridge. Vectors also rotate between refits, so compare overlaps, not
raw vectors, night to night, and apply the smoothing in §3.4.

### 3.3 Baseline: layers (call, endorsed in discussion)

Every score below is the user's own z-score unless said otherwise.

1. **Direct agreement** — songs the pair both scored, matched on `Song.track_id` (never
   title), and album factors (theme, replay value, production, distinctness) on records
   both rated, matched on `Album.subject_key`. **Not** the final album score: it is the
   song mean plus the factors, so it would count twice, and it drifts with the
   userbase prior (CLAUDE.md §6.1). Add it only if the test in §3.5 says it helps.
2. **Category agreement** — each user's average z-score per artist (`album_artists` /
   `song_artists`, so a collaboration counts for every credited artist), per artist
   cluster (`worker/artist_clusters.py`, 18), per genre and per subgenre. Compared over
   the categories both have. Thin averages (one album in a genre) are shrunk toward the
   user's own mean before comparison, the same idea as `scoring.shrink_to_prior`.
3. **Album-feature agreement** — each user's taste vector: the album feature vectors of
   their rated records (the five `THEME_AXES` + distinctness from `albumfactors`, and the
   track audio from `trackaudio`), weighted by that user's album-level z-score. Compared
   by cosine. This is the "embedding" option, built from data already stored.

### 3.4 Combining the baseline's layers (call; weights to be tuned in §3.5)

- Each layer yields an agreement in [-1, 1] plus an **evidence weight** (how much shared
  data stands behind it).
- **Overlapping signals are discounted**: one song score feeds its artist, cluster and
  genre averages too, so the category layers carry less weight where direct agreement
  exists.
- **Rarer shared records count more** (an inverse-popularity weight): agreeing on the
  year's most-rated album says less than agreeing on something three people own.
- The weighted agreement is **shrunk toward 0** by total evidence, then mapped to the
  0–100 scale (`50 + 50·r` before the curve), then passed through **one monotone curve**
  tuned so §2's spread holds on the real pairs.
- **Smoothing**: the stored value moves part of the way toward each night's raw value
  unless either user rated something since the last run, in which case it jumps to the
  new value. Exact rule left to the builder.

The smoothing rule applies to the factorization model's output too.

### 3.5 Tuning and the comparison (builder)

Run both the factorization model (§3.2) and the layered baseline (§3.3–3.4) through the
same test: hold out a share of each user's song scores, predict them from the other
users weighted by overlap, and compare against unweighted pooling. When holding out a
score, recompute the aggregates without it — otherwise the test sees the answer. Use it
to tune each approach (rank, regularisation, column-type weights, shrinkage, curve) and
to decide whether the final album score earns a column.

Then **report back to Jack before wiring any UI**: both approaches' accuracy, their
overlap distributions against §2's anti-goals, the user-1 dependence from §3.2, and a
handful of example pairs with each approach's number. Jack decides which ships. **(call
on the checkpoint; the decision is his)**

**Accuracy doesn't gate the feature (Jack).** It is social, not a prediction, so it ships
even if neither approach beats plain pooling. What the checkpoint must show instead is
that the numbers are **believable**: the distribution against §2's anti-goals, and
example pairs Jack can check against what he knows of those users. It "can't be too far
off" — a pair who obviously agree reading 30%, or obviously disagree reading 90%, is a
reason to fix it before launch.

### 3.6 When it runs (call)

- **Nightly**, in the worker, for every pair (about 5,000 pairs today), stored.
- **Immediately after an album is rated**, for the rater against everyone, so the pop-up
  has fresh numbers. The web service carries no numpy (`personalize.py:37-39`); either
  keep this path pure stdlib or have it read precomputed per-user vectors. Builder's
  choice, but the live path must finish before the user is back on For You — a few
  seconds at most.
- Mind the 15-client Supabase pooler (CLAUDE.md §7): no connection held across slow work.

## 4. Storage and API (call — shapes are the builder's)

- A `tasteoverlap` table keyed `(user_id_a, user_id_b)` with `user_id_a < user_id_b`
  (the `Friendship` convention), holding the percentage, the evidence weight, the reason
  (§5.3) and `updated_at`. Migration lines in `init_db()` per CLAUDE.md §3.
- `GET /users/{id}/overlap` — the caller vs that user: percentage and reason. Guarded by
  `viewable_user_id` (profiles are public).
- `GET /albums/{id}/people` (or similar) — the pop-up's three rows for the caller's copy
  of album `id`.
- Both go through `shared/src/api.ts`, then both clients.

## 5. Surfaces (both platforms, in lockstep)

Mockups: `.superpowers/brainstorm/51272-1793705302/content/` (gitignored; local).

### 5.1 Profile

- **Not friends** (none, or pending): a **"you & them" panel** under the name — the
  percentage, a 0–100 meter with a marker, the record that connects you (cover + one
  line), **Add friend** and **Compare**. **(Jack)**
- **Friends**: the percentage as a **chip under the name** and the one-line reason; no
  panel. **(Jack)**
- Your own profile shows neither.
- **Compare** opens the compare view of the connecting record: `/album/:id?view=compare`
  on their copy on web, `FriendCompare` on mobile. With no shared record, it opens
  their profile's library. **(call)**

### 5.2 The pop-up after rating

- **When**: after **every** album rating, the next time the user lands on For You after
  leaving the rating flow (after the review step and share card), never inside the flow.
  No daily limit. **(Jack)** If several albums were finished before returning, show one
  sheet, for the most recent album. **(call)**
- **What counts as a rating** **(call)**: an album's **first** move to `rated` — albums,
  EPs and singles alike. Re-editing an already-rated album does not owe a sheet.
- **Where "a sheet is owed" lives** **(call)**: on the server, so a rating made on web
  shows its sheet on the iPhone and the other way round. Both clients ask on landing on
  For You, and showing it (or *Not now*) clears it. This is also the "sheet shown" event
  in §6.
- **Form**: a bottom sheet over For You (web: a dialog), headed "N people rated
  *<album>* too" with the cover. **(Jack — mockup A, v2)**
- **Who** — among other users who rated the same record (`subject_key`, any edition):
  - more than three: **two at random from the top quarter** of overlap with the user,
    **one at random from the bottom quarter**; **(Jack)**
  - three or fewer: all of them, and nobody else. **(Jack)**
  - With very few raters the quarters are tiny; take "top quarter" as the top
    `ceil(n/4)` and "bottom quarter" likewise, and if they overlap, just pick three
    distinct people at random weighted toward the top. **(call)**
- **Fallback, nobody else rated it**: the same 2 + 1 mix drawn from all users, headed
  "People who like what you like". **(Jack for the mix; heading is my call)**
- **Excluded**: existing friends and anyone with a pending request either way. Someone
  can reappear for a different album; no cooldown. **(call)**
- **Each row**: avatar, username, percentage, **Add**, and their **favourite and least
  favourite song with scores**, drawn exactly like For You's review previews (green up
  triangle / red down triangle, `songScoreColor`, one decimal). Songs come from their
  copy of this record; in the fallback, from their record closest to it (same artist,
  else same genre), with that record's name shown. **(Jack; fallback source is my call)**
- **Bottom**: "Not now" closes it; **"Open the discussion"** opens the record's
  discussion board (web `/thread/:subject`, mobile's thread route). The user has just
  rated the record, so `thread_access` admits them. **(Jack)**
- Nobody qualifies at all: no pop-up.
- Tapping a name or avatar opens the profile through `useOpenProfile` on mobile.

### 5.3 The message

Encouraging at every percentage. **(Jack)** It names something real, chosen in this
order: the record you agree on most, the record you split on most, a shared artist, a
shared genre. Wording is the builder's, in Pressd's voice; examples:

- high: "You both put *Blonde* near the top. Say hi."
- middle: "You split on *Blonde* and agree on Frank Ocean."
- low: "You gave *Blonde* opposite scores. Go settle it."
- no shared record: "You both lean R&B."

No grey helper captions explaining what the number means (standing preference).

## 6. Measuring success

The data doesn't fully support §1's measures yet:

- **Friend requests over time**: `Friendship` has no timestamps. Add `requested_at` and
  `accepted_at`, null for existing rows (the `created_at` convention, CLAUDE.md §10).
- **Posts per rated album over time**: `Post.created_at` exists; `Album` has no time it
  was rated. Add `Album.rated_at`, set when status becomes `rated`, null for old rows.
- **Pop-up attribution** **(call)**: record each sheet shown, each Add and each Open the
  discussion from it (a small table, user id + album + action + time), so changes can be
  traced to the feature. No third-party analytics.

**No waiting period (Jack).** The columns ship with the feature, and it launches as
soon as it's ready. "Before" is measured per user, not per calendar month: whatever a
user did before their first pop-up — even an hour or a minute earlier — is their
before, so the comparison fills in naturally as new people rate albums.

## 7. Constraints

- Any grouping across users goes through `trackkeys` / `track_id` / `subject_key`
  (CLAUDE.md §12); per-artist grouping through `credits.py`.
- Web and mobile ship together. Because the iPhone build goes through App Review, both
  clients are built against a **server-side switch** that stays off until the iOS build
  is approved, then turns the feature on for both at once. Launch date = the day it is
  switched on. **(call)**
- Local `.env` points at production; migrations run on `uvicorn` start.
- CLAUDE.md updated in the same commits (new table, endpoints, columns, worker stage).
- One-off scripts deleted after use.

## 8. Left to the builder

Exact rank, regularisation, column-type and layer weights, shrinkage and curve (from §3.5); the smoothing rule; table and
endpoint shapes; whether the live path is stdlib or reads precomputed vectors; the
message copy; how the meter and chip look within the existing design kit.

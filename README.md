<div align="center">

# 🎧 Press'd

### Log your music taste and find new favorites.

Press'd is a music rating app for people who take albums seriously. Rate every song, track your listening, get AI-powered predictions of what you'll love next, and see what your friends are into.

**[▶ Try it live](https://pressd-eta.vercel.app)** · Sign in with Google — no setup required.

</div>

---

## What is Press'd?

Think Letterboxd, but for albums — with sharper scoring and a personal recommendation engine built in.

You add an album, listen through it track by track, and rate each song as you go. Press'd combines those song scores with a few album-level judgment calls (production, replayability, and more) into a single, consistent score. Over time you build a complete, searchable record of your taste — and Press'd learns it well enough to predict how you'll rate things you *haven't* heard yet.

It's also social: follow friends, watch what they're rating, like their reviews, and send albums straight to their queue.

---

## Features

### 🎵 Rate albums the right way
- **Search and add** any album from a catalog of millions — album art, tracklist, and release year fill in automatically.
- **Listen-through rating.** Songs unlock one at a time in track order, so you rate the way you actually listen — top to bottom, no jumping ahead.
- **Score every song** from 0–10.
- **Album-level factors.** After the songs, rate the album on **Theme**, **Replay Value**, **Production**, and **Distinctness**.
- **Live score.** A running score card updates with every rating so you can see the album's number take shape in real time. Songs are flagged as **bangs** 🟢 or **skips** 🔴, and a clean album with zero skips earns a **"No skips"** badge.
- **Shareable rating cards.** Every finished album generates a polished, downloadable report you can share (including straight to iMessage).

### 🔮 Discover what you'll love next
- **Personal predictions.** Press'd trains a model on *your own* ratings and predicts a score for every album in your queue — so your "To Listen" list is automatically sorted best-first.
- **Explained guesses.** Predictions come with reasoning on an album's likely theme, replay value, and distinctness.
- **Audio-aware.** Predictions factor in real audio characteristics (tempo, key, energy, danceability, loudness) analyzed from the music itself.
- **Discography discovery.** On any artist's page, see the releases you *haven't* logged yet.

### 📊 Explore your taste
- **Library** organized into **To Listen → Listening → Rated**, so nothing gets lost mid-listen.
- **Leaderboards** for your top albums and songs, fully sortable and searchable.
- **Stats dashboards** — score distributions, genre breakdowns, and how your taste breaks down across your whole catalog.
- **Baseball-style artist stats** for the stat-heads: consistency, songs-above-replacement, bang %, skip %, and more.

### 👥 Share it with friends
- **Invite friends** with a one-tap link (or text it).
- **Friend requests** and a friends list — view any friend's full library and stats.
- **Activity feed** of everything your friends are rating, with **likes** on reviews.
- **Recommend albums** to a friend and they land right in their To Listen queue, tagged as coming from you.

Works great on mobile and desktop.

Mobile App coming soon! 
---

## For the curious...

Press'd is a full-stack app:

- **Frontend** — React 19 + TypeScript, Vite, Tailwind, TanStack Query/Table, Recharts, Google OAuth. Deployed on Vercel.
- **Backend** — FastAPI + SQLModel on PostgreSQL. Deployed on Render.
- **Machine learning** — a gradient-boosted song-score model (retrained on your ratings), an LLM-based theme/distinctness predictor with retrieval over an album-analysis corpus, and Essentia for audio feature extraction. A nightly worker keeps everyone's predictions fresh.
- **Auth** — Sign in with Google (JWT sessions).

### Running it locally

**Backend**
```bash
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

Copy the relevant environment variables (database URL, Google OAuth client ID, Spotify credentials, etc.) into `.env` / `frontend/.env.local` before starting.

---

<div align="center">

Built by [Jack Kalsched](https://github.com/jackkalsched) & Claude. 🎶

</div>

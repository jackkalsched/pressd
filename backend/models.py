from typing import Optional
from datetime import date, datetime
from sqlalchemy import Column, LargeBinary, UniqueConstraint
from sqlmodel import Field, Relationship, SQLModel


class PressUser(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    avatar_url: Optional[str] = None
    bio: Optional[str] = None

    # Three picks the user pins to their profile. Albums and songs are stored by
    # id and must be their own rated copy — the picker only ever offers those —
    # while the artist is a name, because an artist is not a row anyone owns.
    # Plain columns rather than foreign keys: a deleted album should blank the
    # pick, not block the delete, so the read path validates instead.
    favorite_album_id: Optional[int] = None
    favorite_song_id: Optional[int] = None
    favorite_artist: Optional[str] = None

    google_sub: Optional[str] = Field(default=None, unique=True, index=True)
    apple_sub: Optional[str] = Field(default=None, unique=True, index=True)
    email: Optional[str] = None

    # Per-user external-factor weights, stored as a 60-point budget (each ≥ 5).
    # Weight applied in scoring = points / 100. Defaults mirror the historical
    # global weights (0.25 / 0.15 / 0.15 / 0.05).
    theme_pts: int = Field(default=25)
    replay_pts: int = Field(default=15)
    production_pts: int = Field(default=15)
    distinctness_pts: int = Field(default=5)

    albums: list["Album"] = Relationship(back_populates="user")


class Invite(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    invited_by: int = Field(foreign_key="pressuser.id", index=True)
    email: str = Field(default="")
    token: str = Field(unique=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    accepted_at: Optional[datetime] = None
    permanent: bool = Field(default=False)


class Friendship(SQLModel, table=True):
    # Rows are stored with user_id_a < user_id_b (normalized in app code);
    # the unique constraint makes duplicate friendships impossible under races.
    __table_args__ = (UniqueConstraint("user_id_a", "user_id_b", name="uq_friendship_pair"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id_a: int = Field(foreign_key="pressuser.id", index=True)
    user_id_b: int = Field(foreign_key="pressuser.id", index=True)
    status: str = Field(default="accepted", index=True)  # pending | accepted
    requested_by: Optional[int] = Field(default=None, foreign_key="pressuser.id")


class UserAvatar(SQLModel, table=True):
    """An uploaded profile picture, stored as bytes.

    Its own table rather than a column on PressUser: every list endpoint selects
    whole user rows, and a couple of hundred kilobytes of image riding along on
    each one would be paid for on every friends list and search.

    Bytes in Postgres rather than object storage because there is no bucket
    configured and 33 users' avatars is not a storage problem. If that changes,
    this table becomes the migration source and avatar_url stops pointing here.
    """
    user_id: int = Field(primary_key=True, foreign_key="pressuser.id")
    content_type: str
    data: bytes = Field(sa_column=Column(LargeBinary, nullable=False))
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Album(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    album_name: str = Field(index=True)
    artist: str = Field(index=True)
    user_id: Optional[int] = Field(default=1, foreign_key="pressuser.id", index=True)
    year: Optional[int] = None
    status: str = Field(default="to_listen")  # to_listen | listening | rated

    # Computed score (stored for query performance)
    score: Optional[float] = None

    # External factor ratings
    theme: Optional[float] = None
    replay_value: Optional[float] = None
    production: Optional[float] = None
    distinctness: Optional[float] = None

    # Genre tags
    genre: Optional[str] = None
    sub_genre1: Optional[str] = None
    sub_genre2: Optional[str] = None
    sub_genre3: Optional[str] = None

    # spotdl / Spotify metadata
    spotify_id: Optional[str] = None
    album_art_url: Optional[str] = None
    total_tracks: Optional[int] = None

    extra_artists: Optional[str] = None  # JSON array e.g. '["Jay-Z", "Kanye West"]'

    predicted_theme: Optional[float] = None
    predicted_theme_reasoning: Optional[str] = None
    predicted_distinctness: Optional[float] = None
    predicted_replay: Optional[float] = None
    predicted_score: Optional[float] = None
    predicted_song_mean: Optional[float] = None

    recommended_by: Optional[int] = None
    recommended_by_name: Optional[str] = None
    recommended_at: Optional[datetime] = None  # when the recommendation was made (feed event)
    # What the sender said about it. Stored on the recipient's copy, next to who
    # sent it — the note belongs to the act of recommending, not to the record,
    # so two friends sending the same album each carry their own.
    recommendation_note: Optional[str] = None

    # Long-form review — optional prose attached to this album rating.
    review: Optional[str] = None
    review_at: Optional[datetime] = None  # set on first write, immutable on edit (feed ordering)

    # The user's pick when several tracks tie for the album's best score. Only
    # set when they were asked and answered, so null means "nobody broke a tie"
    # — reviews and share cards fall back to the highest score as before. A
    # plain column rather than a foreign key: song.album_id already points the
    # other way, and a second constraint between the two tables would have to be
    # created after both exist. pick_top_song() validates it against the album's
    # own songs on read, which covers a track deleted out from under it.
    top_song_id: Optional[int] = None

    date_added: Optional[date] = Field(default_factory=date.today)
    date_rated: Optional[date] = None

    user: Optional["PressUser"] = Relationship(back_populates="albums")
    songs: list["Song"] = Relationship(back_populates="album")


class Song(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    track_number: Optional[int] = None
    score: Optional[float] = None
    a_score: Optional[float] = None   # (15*score - 14) / 13

    artist: Optional[str] = None
    duration_ms: Optional[int] = None
    spotify_popularity: Optional[int] = None
    explicit: bool = False
    spotify_id: Optional[str] = None

    # Audio features (populated by analyze-audio endpoint)
    bpm: Optional[float] = None
    musical_key: Optional[str] = None   # e.g. "C major"
    loudness_db: Optional[float] = None

    album_id: int = Field(foreign_key="album.id", index=True)
    track_id: Optional[int] = Field(default=None, foreign_key="track.id", index=True)
    album: Optional[Album] = Relationship(back_populates="songs")
    audio_features: Optional["SongAudioFeatures"] = Relationship(back_populates="song")


class SongAudioFeatures(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    song_id: int = Field(foreign_key="song.id", unique=True, index=True)
    title: Optional[str] = None
    analyzed_at: datetime = Field(default_factory=datetime.utcnow)

    # Rhythm
    bpm: Optional[float] = None
    bpm_confidence: Optional[float] = None

    # Tonal
    key: Optional[str] = None
    scale: Optional[str] = None               # "major" | "minor"
    key_strength: Optional[float] = None
    chords_changes_rate: Optional[float] = None

    # Loudness
    loudness_db: Optional[float] = None
    dynamic_complexity: Optional[float] = None

    # Perceptual
    danceability: Optional[float] = None
    energy: Optional[float] = None
    dissonance: Optional[float] = None

    # Timbre / spectral
    spectral_centroid: Optional[float] = None
    inharmonicity: Optional[float] = None
    onset_rate: Optional[float] = None
    loudness_lufs: Optional[float] = None
    mfcc: Optional[str] = None  # JSON array of 13 mean coefficients

    song: Optional["Song"] = Relationship(back_populates="audio_features")


class Like(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("user_id", "album_id", name="uq_like_user_album"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="pressuser.id", index=True)
    album_id: int = Field(foreign_key="album.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Track(SQLModel, table=True):
    """Global, user-agnostic identity for a unique recording. Dedup key is
    normalized (artist, title) — spotify_id is unpopulated in this DB. Audio
    is analyzed once per track and shared across every user's copy."""
    id: Optional[int] = Field(default=None, primary_key=True)
    track_key: str = Field(unique=True, index=True)
    artist_norm: str = Field(index=True)
    title_norm: str
    duration_ms: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class TrackAudio(SQLModel, table=True):
    """Essentia features for one Track. Never mix `source` values between
    training and prediction (30s-preview features shift vs full tracks)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    track_id: int = Field(foreign_key="track.id", unique=True, index=True)
    analyzed_at: datetime = Field(default_factory=datetime.utcnow)
    source: str = Field(default="yt_full")  # 'yt_full' | 'preview_30s'

    bpm: Optional[float] = None
    bpm_confidence: Optional[float] = None
    key: Optional[str] = None
    scale: Optional[str] = None
    key_strength: Optional[float] = None
    chords_changes_rate: Optional[float] = None
    loudness_db: Optional[float] = None
    dynamic_complexity: Optional[float] = None
    danceability: Optional[float] = None
    energy: Optional[float] = None
    dissonance: Optional[float] = None
    spectral_centroid: Optional[float] = None
    onset_rate: Optional[float] = None
    loudness_lufs: Optional[float] = None
    mfcc: Optional[str] = None  # JSON array of 13 mean coefficients


class AlbumCorpus(SQLModel, table=True):
    """Shared LLM album-analysis corpus (was local corpus/*.json files),
    keyed by normalized artist+album so all users reuse one analysis."""
    id: Optional[int] = Field(default=None, primary_key=True)
    album_key: str = Field(unique=True, index=True)
    corpus_json: str
    built_at: datetime = Field(default_factory=datetime.utcnow)


class AlbumFactors(SQLModel, table=True):
    """Global, user-agnostic theme + distinctness for one album, keyed by
    normalized artist+album (same key as AlbumCorpus). Scored once by the LLM
    and shared across every user's copy — per-user values are derived from
    these by theme_predictor.personalize rather than re-prompting.

    The raw values live on an arbitrary internal reference scale
    (personalize.GLOBAL_REF_MU/SD); Layer 1 z-scores them away immediately, so
    only their *relative* ordering and spread carry meaning.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    album_key: str = Field(unique=True, index=True)
    artist: str
    album_name: str
    genre: Optional[str] = None
    year: Optional[int] = None

    # Theme is stored as a *measurement of the record*, not a score for anyone:
    # a JSON object of album-intrinsic semantic axes (narrative arc, concept
    # unity, sequencing intent, …), each 1–10. Every user's theme prediction is
    # a model fitted over these against their own theme ratings, so one LLM
    # call per album serves the whole userbase and personalization comes from
    # ratings rather than from re-prompting. See theme_predictor.personalize.
    theme_features: Optional[str] = None  # JSON {axis: value}
    theme_raw: Optional[float] = None     # the LLM's own overall read; one more feature
    theme_reasoning: Optional[str] = None

    # Distinctness stays a single global scalar, rescaled per user and no more.
    # It correlates with the album score at 0.36 against theme's 0.69 and carries
    # a 0.05 weight, so a per-user model over it would move a composite by
    # hundredths — not worth an axis breakdown or a second fit.
    distinctness_raw: Optional[float] = None
    distinctness_reasoning: Optional[str] = None

    model: Optional[str] = None  # LLM that produced the values
    computed_at: datetime = Field(default_factory=datetime.utcnow)


class AlbumPrediction(SQLModel, table=True):
    """One user's predicted score for one album in the catalog — including
    albums they don't own.

    The `album.predicted_*` columns can only describe a record that is already
    in someone's library, because they are columns on a per-user copy. This
    table is keyed by (user_id, album_key) instead, so every user can have a
    prediction for every album anyone has ever added. `album_key` matches
    AlbumCorpus and AlbumFactors.

    Deliberately not a 4th album.status: charts, trending, stats and the global
    rating pass all filter on status, and several use `status IN (...)` lists
    that would silently absorb rows that are predictions rather than library
    entries.
    """
    __table_args__ = (UniqueConstraint("user_id", "album_key", name="uq_albumprediction_user_album"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="pressuser.id", index=True)
    album_key: str = Field(index=True)

    artist: str
    album_name: str
    genre: Optional[str] = None
    year: Optional[int] = None
    album_art_url: Optional[str] = None

    predicted_song_mean: Optional[float] = None
    predicted_theme: Optional[float] = None
    predicted_distinctness: Optional[float] = None
    predicted_replay: Optional[float] = None
    predicted_score: Optional[float] = None

    # Which song model produced it: 'personal' | 'pooled' | 'blend(...)'.
    # Worth storing — a prediction from a 2%-personal blend deserves different
    # confidence in the UI than one from a settled personal model.
    model_source: Optional[str] = None
    # Which tier of the artist-cluster hierarchy produced predicted_replay:
    # 'mates' (mostly the user's own ratings of cluster-mates) | 'global'
    # (mostly the calibrated userbase figure) | 'own' | 'genre'. A global-tier
    # value is a much weaker claim, and without this there is no way to tell
    # them apart once written.
    replay_tier: Optional[str] = None
    # True when the user has already rated this album; kept rather than skipped
    # so predictions can be scored against outcomes.
    already_rated: bool = Field(default=False)
    computed_at: datetime = Field(default_factory=datetime.utcnow)


class ArtistCluster(SQLModel, table=True):
    """One artist's place in the global map, per KMeans seed.

    A record of the nightly fit, not its source — the map is refit in memory on
    every run and never loaded from here. It exists so the clustering can be
    inspected and diffed without a 1–2 minute refit, and so the backend can read
    neighbourhoods cheaply.
    """
    artist_key: str = Field(primary_key=True)
    seed: int = Field(primary_key=True)
    cluster_id: int
    # Provenance: which ARTIST_K produced this row.
    k: int
    display_name: Optional[str] = None
    # False when the artist was placed by nearest centroid after the fit —
    # analyzed between nightly runs rather than present at fit time.
    in_universe: bool = Field(default=True)
    # The cluster's tier-3 mean replay in z-space, carried here so the table
    # explains its own predictions.
    global_z: Optional[float] = None
    computed_at: datetime = Field(default_factory=datetime.utcnow)


class WorkerRun(SQLModel, table=True):
    """One row per worker job execution (audio ingest / per-user predict)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    job: str = Field(index=True)  # 'audio_ingest' | 'nightly_predict'
    user_id: Optional[int] = Field(default=None, index=True)
    started_at: datetime = Field(default_factory=datetime.utcnow)
    finished_at: Optional[datetime] = None
    status: str = Field(default="running")  # running | ok | error | below_threshold
    detail_json: Optional[str] = None


class Comment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    album_id: int = Field(foreign_key="album.id", index=True)
    user_id: int = Field(foreign_key="pressuser.id", index=True)
    body: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ArtistMeta(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    artist: str = Field(unique=True, index=True)
    mb_artist_id: Optional[str] = None
    albums_json: Optional[str] = None       # JSON-serialised list of release dicts
    scraped_at: Optional[datetime] = None

    # Artist photo, resolved from Deezer. The id is what's cached rather than
    # the URL — Deezer's CDN paths rotate, so a stored URL goes stale.
    deezer_artist_id: Optional[int] = None
    image_url: Optional[str] = None
    image_checked_at: Optional[datetime] = None

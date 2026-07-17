from typing import Optional
from datetime import date, datetime
from sqlalchemy import UniqueConstraint
from sqlmodel import Field, Relationship, SQLModel


class PressUser(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
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

    # Long-form review — optional prose attached to this album rating.
    review: Optional[str] = None
    review_at: Optional[datetime] = None  # set on first write, immutable on edit (feed ordering)

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

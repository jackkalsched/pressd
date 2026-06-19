from typing import Optional
from datetime import date, datetime
from sqlmodel import Field, Relationship, SQLModel


class PressUser(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    avatar_url: Optional[str] = None
    google_sub: Optional[str] = Field(default=None, unique=True, index=True)
    email: Optional[str] = None

    albums: list["Album"] = Relationship(back_populates="user")


class Invite(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    invited_by: int = Field(foreign_key="pressuser.id", index=True)
    email: str
    token: str = Field(unique=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    accepted_at: Optional[datetime] = None


class Friendship(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id_a: int = Field(foreign_key="pressuser.id", index=True)
    user_id_b: int = Field(foreign_key="pressuser.id", index=True)


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


class ArtistMeta(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    artist: str = Field(unique=True, index=True)
    mb_artist_id: Optional[str] = None
    albums_json: Optional[str] = None       # JSON-serialised list of release dicts
    scraped_at: Optional[datetime] = None

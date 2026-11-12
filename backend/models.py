from typing import Optional
from datetime import date, datetime
from datetime import timezone
from sqlalchemy import Column, DateTime, LargeBinary, UniqueConstraint, event
from sqlmodel import Field, Relationship, SQLModel

from .trackkeys import subject_key_album


class PressUser(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    avatar_url: Optional[str] = None
    # The profile header's wash: an uploaded picture (UserBanner), shown blurred
    # in place of the favourite album's cover. Null falls back to that cover.
    banner_url: Optional[str] = None
    bio: Optional[str] = None
    # Where they are, as they put it ("Brooklyn, NY"): free text, optional,
    # shown on the profile beside the handle. Never derived from the device.
    location: Optional[str] = None

    # Three picks the user pins to their profile. Albums and songs are stored by
    # id and must be their own rated copy — the picker only ever offers those —
    # while the artist is a name, because an artist is not a row anyone owns.
    # Plain columns rather than foreign keys: a deleted album should blank the
    # pick, not block the delete, so the read path validates instead.
    favorite_album_id: Optional[int] = None
    favorite_song_id: Optional[int] = None
    favorite_artist: Optional[str] = None
    # The shelf: four slots of the user's own rated albums, by position, as a
    # JSON array of ids or nulls ('[12,null,40,null]'). It was five for a day;
    # a longer stored array is read as its first four. It replaced the
    # three picks on both apps in November 2026; the song and artist picks are
    # still stored and still served, for app builds that predate it.
    shelf: Optional[str] = None

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

    # When the first-run tutorial was finished or skipped; null means it is
    # still owed. On the account rather than the device so a reinstall or a
    # second phone doesn't replay it. Every account that existed before the
    # tutorial shipped was stamped by the migration, so only new sign-ups see it.
    tutorial_seen_at: Optional[datetime] = None
    # When the person confirmed a username (backend/usernames.py); null means
    # the first-run username step is owed. Stamped for every account that
    # existed when it shipped, like tutorial_seen_at, so only new sign-ups see it.
    username_chosen_at: Optional[datetime] = None

    # Which pushes this person wants, one switch per kind (backend/push.py,
    # NOTIFY_KINDS). All on by default: the device-level permission is the
    # first gate, and someone who granted it asked to be told. These let them
    # keep the kinds they care about without turning the whole app off in iOS.
    notify_recommendations: bool = Field(default=True)
    notify_friends: bool = Field(default=True)
    notify_replies: bool = Field(default=True)
    # A friend's first review of a record you've rated (albums._notify_review).
    notify_reviews: bool = Field(default=True)
    # A friend's first rating of a record in your library (albums._notify_rating).
    notify_ratings: bool = Field(default=True)

    # A verified phone number, for finding friends from contacts — stored only
    # as an HMAC under PHONE_HASH_KEY, never the number (backend/phone.py). Set
    # only after Firebase has proved the number, so the hash is never a claim.
    # Unique among accounts by a partial index in init_db. The last four digits
    # let Settings say which number is on file.
    phone_hash: Optional[str] = None
    phone_last4: Optional[str] = None
    phone_verified_at: Optional[datetime] = None
    # The one-time "add your phone number" prompt: 'added' or 'skipped', and
    # when. Null means it is still owed — every account that existed when it
    # shipped starts there, unlike tutorial_seen_at, because the point is to
    # ask the people already here.
    phone_prompt: Optional[str] = None
    phone_prompt_at: Optional[datetime] = None

    # When the account was made, so signups can be counted by day. Accounts that
    # predate the column are null — when they joined was never recorded, and a
    # guessed date would read as a burst of signups on the day it shipped.
    created_at: Optional[datetime] = Field(default_factory=datetime.utcnow)

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
    # When the request was sent and when it was accepted (an invite link or a
    # request sent back sets both at once), so friend requests and network
    # size can be counted over time — the measure taste overlap is judged on.
    # Null for rows that predate the columns. Declining or unfriending deletes
    # the row, so churn isn't recorded.
    requested_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    accepted_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))


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


class UserBanner(SQLModel, table=True):
    """An uploaded profile header picture, stored as bytes — UserAvatar's twin,
    in its own table for the same reason. Kept tiny: the header only ever draws
    it blurred to a wash, so the detail a full-size photo carries is never seen.
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

    # When this copy entered the user's library — import, recommendation or
    # copy from the community view. Null for copies that predate the column.
    created_at: Optional[datetime] = Field(default_factory=datetime.utcnow)

    # The user's pick when several tracks tie for the album's best score. Only
    # set when they were asked and answered, so null means "nobody broke a tie"
    # — reviews and share cards fall back to the highest score as before. A
    # plain column rather than a foreign key: song.album_id already points the
    # other way, and a second constraint between the two tables would have to be
    # created after both exist. pick_top_song() validates it against the album's
    # own songs on read, which covers a track deleted out from under it.
    top_song_id: Optional[int] = None

    # When the record came out, as opposed to `year`, which is all the import
    # kept before. Needed to say whether something is new in weeks rather than
    # in years. Null on everything imported before 2026-09-02 — the search
    # results carried the date and the import dropped it, and it cannot be
    # recovered without re-fetching, so old rows simply never read as new.
    release_date: Optional[date] = None
    # When this copy's tracklist stopped changing (backend/tracklist_settle.py,
    # backend/tracklist_fill.py): set when it gets songs while its record is
    # out — an import, a clone — or by its one merge on or after release day.
    # Until then a pre-release copy's partial list may be topped up; after, it
    # is never adjusted again.
    tracklist_settled_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))

    date_added: Optional[date] = Field(default_factory=date.today)
    date_rated: Optional[date] = None
    # When this copy was first rated. date_rated can't say: PATCH rewrites it on
    # every save that sends status "rated", and both rating screens send it on
    # every edit and autosave, so it means "last saved". This is set once, on
    # the first move to rated, and never again — moving the copy back to
    # Listening and finishing it keeps the original. Null for copies rated
    # before the column existed.
    rated_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))

    # Which record this copy is, across every user's spelling of it —
    # trackkeys.subject_key_album. Stored rather than computed on read because
    # a discussion post has to resolve its author's copy of the subject on
    # every read (PLAN_discussions.md §2.3), and that join needs an index.
    # Nullable: rows predating the backfill, and any insert that forgets, read
    # as "unresolved" rather than silently joining to the wrong record.
    subject_key: Optional[str] = Field(default=None, index=True)

    user: Optional["PressUser"] = Relationship(back_populates="albums")
    songs: list["Song"] = Relationship(back_populates="album")


@event.listens_for(Album, "before_insert")
@event.listens_for(Album, "before_update")
def _sync_album_subject_key(mapper, connection, target: "Album") -> None:
    """Keep album.subject_key in step with the name and artist it derives from.

    A mapper event rather than an assignment at each call site, deliberately:
    albums are constructed in four places and PATCH /albums/{id} writes
    arbitrary fields through setattr, so an explicit line would be correct in
    all of them right up until the fifth path is added. A stale subject_key is
    worse than a missing one — it silently files a copy under the wrong record.

    Pure string work (PLAN_discussions.md §2.2), so running it on every write
    costs nothing worth optimising away.
    """
    target.subject_key = subject_key_album(target.artist or "", target.album_name or "")


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
    """Global, user-agnostic identity for a unique recording. `track_key` is
    `trackkeys.recording_key` (the album's primary artist, the title with
    edition qualifiers folded and live/demo/remix-style variants tagged), plus
    the `||alt<n>` / `||d<sec>` tiebreaks of backend/tracklink.py; spotify_id
    is unpopulated in this DB. Audio is analyzed once per track and shared
    across every user's copy."""
    id: Optional[int] = Field(default=None, primary_key=True)
    track_key: str = Field(unique=True, index=True)
    artist_norm: str = Field(index=True)
    title_norm: str
    duration_ms: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    # The nightly ingest's failed attempts at this recording — no YouTube match,
    # an age-gated video, a refused download — so it can stop retrying the same
    # tracks every night (worker/audio_ingest.py, MAX_TRIES / RETRY_AFTER_DAYS).
    # Reset on success.
    audio_failures: int = Field(default=0)
    audio_failed_at: Optional[datetime] = None
    audio_fail_reason: Optional[str] = None


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
    job: str = Field(index=True)  # 'audio_ingest' | 'nightly_predict' | 'rescore_scores' | 'new_releases' | 'taste_overlap' | 'taste_health'
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
    # The thread reply this comment was mirrored into, when it was. Null for
    # every comment written before discussions existed and for any whose author
    # had not earned the room — see threads.sync_comment_post.
    post_id: Optional[int] = Field(default=None, foreign_key="post.id", index=True)


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


class CachedFeed(SQLModel, table=True):
    """The last good copy of a feed assembled from outside services, kept so it
    outlives the process that fetched it.

    New releases are the reason it exists. The list used to live only in a
    module-level dict, so every deploy and every restart emptied it, and the
    next person to open For You waited on ~25 outbound calls — about 4.5s
    measured, bounded only by a 20s timeout — for a list that changes a few
    times a day. Reading this row back costs one primary-key lookup.

    Keyed by feed name rather than shaped around releases, so the next feed
    that wants the same treatment is a new key, not a new table. The payload is
    stored as the endpoint returns it; nothing queries inside it.

    Not a cache for anything invalidated on write. The global ratings board is
    thrown away whenever anyone rates a song, so a stored copy would be rebuilt
    as often as the in-memory one and read more slowly — it stays in memory.

    A new table, so create_all in init_db builds it on existing databases too;
    no migration string is needed.
    """
    key: str = Field(primary_key=True)
    payload_json: str
    fetched_at: datetime = Field(default_factory=datetime.utcnow)


class PushToken(SQLModel, table=True):
    """One device's FCM registration token.

    Keyed on the token rather than on (user, device) because that is how FCM
    behaves: a token identifies an *app install*, not a person. The same phone
    hands back the same token after a different account signs in, so binding it
    to whoever most recently registered — and letting a later registration move
    it — is what stops a notification going to the person who used the phone
    before. A user can hold several (phone, tablet, a reinstall), so there is no
    unique constraint on user_id.

    Tokens rotate on their own: FCM reissues after a reinstall, a restore, or
    long disuse, which is why last_seen_at exists. A token nobody has refreshed
    in months is almost certainly dead, and sends to it fail silently.
    """
    token: str = Field(primary_key=True)
    user_id: int = Field(foreign_key="pressuser.id", index=True)
    platform: str = Field(default="ios")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_seen_at: datetime = Field(default_factory=datetime.utcnow)


# ── Discussions (PLAN_discussions.md §3) ─────────────────────────────────────

class Thread(SQLModel, table=True):
    """One room per subject: a record, an artist, or a single recording.

    Created lazily on first read, never seeded in bulk — most subjects will
    never be discussed, and a table with one empty row per album in the catalog
    would make "is anyone talking about this?" a scan instead of a lookup.

    `subject_key` is trackkeys.subject_key_album / subject_key_artist for the
    first two kinds and the global `track.id` as a string for the third. The
    server computes it; a client never supplies one, or a client-side
    normalisation drift silently forks a room.
    """
    __table_args__ = (UniqueConstraint("subject_type", "subject_key",
                                       name="uq_thread_subject"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    subject_type: str = Field(index=True)          # 'album' | 'artist' | 'track'
    subject_key: str = Field(index=True)

    # Denormalised for list rendering. The Social feed and the divisive rail
    # draw rows for subjects the viewer may not own a copy of, and resolving a
    # title through four tables per row is not worth the normalisation.
    title: str
    subtitle: Optional[str] = None                 # artist for an album, album for a track
    art_url: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_post_at: Optional[datetime] = None
    post_count: int = Field(default=0)


class Post(SQLModel, table=True):
    """One message in a thread.

    Replies are one level deep: `parent_id` on a reply points at a top-level
    post, and a reply to a reply points at that same top-level post. Enforced
    server-side — arbitrary nesting is unreadable at phone width and there is
    no design for it.

    `user_id` is nullable because a seeded Press'd post (§5.1) has no author.
    Deletes are soft: a removed parent still has to anchor its replies.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    thread_id: int = Field(foreign_key="thread.id", index=True)
    user_id: Optional[int] = Field(default=None, foreign_key="pressuser.id", index=True)
    parent_id: Optional[int] = Field(default=None, foreign_key="post.id", index=True)

    body: str
    kind: str = Field(default="user")   # 'user' | 'system' | 'review' | 'track_note'
    is_spoiler: bool = Field(default=False)

    created_at: datetime = Field(default_factory=datetime.utcnow)
    edited_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None

    # Denormalised counters. They answer the All-time sort directly; the 7-day
    # Popular window still has to count rows, because a counter cannot be
    # windowed after the fact.
    like_count: int = Field(default=0)
    dislike_count: int = Field(default=0)
    reply_count: int = Field(default=0)


class PostLike(SQLModel, table=True):
    """One person's vote on one post: +1 up, -1 down.

    A direction on a single row rather than two tables, because the unique
    constraint then enforces the rule for free — you cannot be both for and
    against a post, and changing your mind is an update instead of a delete and
    an insert into somewhere else. Rows written before dislikes existed default
    to +1, which is what they were.

    created_at earns its place here: the Popular sort is a 7-day window, so the
    vote has to carry when it happened, not just that it did.
    """
    __table_args__ = (UniqueConstraint("user_id", "post_id", name="uq_postlike"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="pressuser.id", index=True)
    post_id: int = Field(foreign_key="post.id", index=True)
    value: int = Field(default=1)   # +1 | -1
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PostReport(SQLModel, table=True):
    """One person's report of one post. Unique per (user, post) so a repeated
    tap cannot manufacture the count that auto-hides a post (§4.3)."""
    __table_args__ = (UniqueConstraint("user_id", "post_id", name="uq_postreport"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    post_id: int = Field(foreign_key="post.id", index=True)
    user_id: int = Field(foreign_key="pressuser.id", index=True)
    reason: str                                     # 'abuse' | 'off_subject' | 'spoiler'
    created_at: datetime = Field(default_factory=datetime.utcnow)
    resolved_at: Optional[datetime] = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TasteItem(SQLModel, table=True):
    """What an album copy is like, as the taste baseline reads it: its feature
    vector (Claude's six measurements and the audio means), standardized across the
    whole catalog. column_key is `album:<album_id>`; one row keyed `raters` holds
    the category columns' rater counts as a JSON object instead. Rewritten nightly
    (worker/taste_nightly.py), so the live path never re-standardizes over the few
    albums it loads."""
    column_key: str = Field(primary_key=True)
    vector_json: str = ""
    fitted_at: datetime = Field(default_factory=_now, sa_column=Column(DateTime(timezone=True)))


class TasteUser(SQLModel, table=True):
    """A user's album-feature taste vector and the number of records behind it,
    which sets how much evidence the feature layer can lend a pair. `[]` with 0
    records when they have none: the row still dates their last computation, which
    is how the live path (taste_live.py) tells whether they rated since."""
    user_id: int = Field(foreign_key="pressuser.id", primary_key=True)
    vector_json: str = ""
    records: int = 0
    updated_at: datetime = Field(default_factory=_now, sa_column=Column(DateTime(timezone=True)))


class TasteOverlap(SQLModel, table=True):
    """The overlap between two users, stored once with user_id_a < user_id_b, and
    only when it reads as something other than 50%: a missing row is 50."""
    user_id_a: int = Field(foreign_key="pressuser.id", primary_key=True)
    user_id_b: int = Field(foreign_key="pressuser.id", primary_key=True)
    percent: float = 50.0
    evidence: float = 0.0
    reason_json: Optional[str] = None
    updated_at: datetime = Field(default_factory=_now, sa_column=Column(DateTime(timezone=True)))


class OverlapSheet(SQLModel, table=True):
    """A people sheet owed to a user for a first rating. album_id is a plain int,
    not a foreign key, so deleting the album blanks the sheet instead of
    blocking the delete."""
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="pressuser.id", index=True)
    album_id: int
    status: str = Field(default="owed", index=True)  # owed | shown | superseded
    created_at: datetime = Field(default_factory=_now, sa_column=Column(DateTime(timezone=True)))
    shown_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))


class OverlapEvent(SQLModel, table=True):
    """What a user did with a people sheet, for measuring the feature."""
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="pressuser.id", index=True)
    sheet_id: Optional[int] = None
    # shown | add | open_discussion | not_now | open_profile
    action: str
    target_user_id: Optional[int] = None
    created_at: datetime = Field(default_factory=_now, sa_column=Column(DateTime(timezone=True)))


class Bin(SQLModel, table=True):
    """A themed collection of records or songs (docs/superpowers/specs/2026-11-11-bins-design.md).

    Curated bins are Pressd's, made from a published list by worker/import_bin.py
    and never written through the API: `owner_id` is null and the source is
    credited by name and link. User bins (owner set, private / unlisted /
    published) arrive in a later phase on these same tables.

    A bin points at records, never at anyone's copy: an entry is keyed on
    `subject_key`, so every edition a person owns counts toward their progress,
    and adding a record from a bin makes an ordinary copy that doesn't remember
    where it came from.

    New tables, so create_all builds them and the last migration turns RLS on;
    no migration strings.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    slug: str = Field(unique=True, index=True)
    kind: str = Field(default="curated", index=True)       # curated | user
    owner_id: Optional[int] = Field(default=None, foreign_key="pressuser.id", index=True)
    item_type: str = Field(default="album")                 # album | song
    title: str
    description: Optional[str] = None
    ranked: bool = Field(default=True)
    visibility: str = Field(default="published", index=True)  # private | unlisted | published
    source_name: Optional[str] = None
    source_url: Optional[str] = None
    source_published: Optional[date] = None
    entry_count: int = Field(default=0)
    # Where it sits among Pressd's bins on For You and the index, lowest first.
    sort_order: int = Field(default=0)
    hidden_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    created_at: datetime = Field(default_factory=_now, sa_column=Column(DateTime(timezone=True)))
    updated_at: datetime = Field(default_factory=_now, sa_column=Column(DateTime(timezone=True)))


class BinEntry(SQLModel, table=True):
    """One record (or, in a song bin, one song) in a bin.

    `artist` is the matched catalog's primary credit, which every key is built
    on — Apple prints "Prince and the Revolution", Deezer files *Purple Rain*
    under Prince — and `album_name` the list's own title, since editions fold
    into one `subject_key` either way. `tracklist_json` is the resolved album
    in /search/resolve's shape, so adding an entry to a library makes no
    outbound call; the copy takes the entry's artist and title. An unmatched
    entry is kept in its place with no tracklist, so a list of 100 stays 100.
    """
    __table_args__ = (UniqueConstraint("bin_id", "position"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    bin_id: int = Field(foreign_key="bin.id", index=True)
    position: int                                   # 0-based order in the bin
    rank: Optional[int] = None                      # the source's printed rank
    note: Optional[str] = None
    artist: str
    album_name: str
    year: Optional[int] = None
    subject_key: str = Field(index=True)
    deezer_id: Optional[int] = None
    cover_url: Optional[str] = None
    tracklist_json: Optional[str] = None
    match_status: str = Field(default="matched")    # matched | unmatched | manual
    # Song bins (a later phase): the song, and its Track once one exists.
    song_title: Optional[str] = None
    track_id: Optional[int] = Field(default=None, foreign_key="track.id")


class BinTrack(SQLModel, table=True):
    """One song of a bin entry's stored tracklist, linked to its global Track
    (backend/tracklink.py, `link_bin_entries`).

    What makes a bin record a catalog record before anyone owns a copy: the
    nightly audio ingest finds its tracks through these rows (after every
    library track, a capped number a night), and catalog_predict scores the
    record for every user from their audio. The keys are the ones a copy added
    from the bin would get (the entry's artist and title, the tracklist's
    songs), so that copy links to these same tracks and their audio. Rebuilt by
    worker/import_bin.py whenever it rewrites a bin's entries. A new table, so
    create_all builds it and the last migration turns RLS on."""
    __table_args__ = (UniqueConstraint("entry_id", "position"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    entry_id: int = Field(foreign_key="binentry.id", index=True)
    position: int                                   # index into tracklist_json's tracks
    title: str
    track_number: Optional[int] = None
    duration_ms: Optional[int] = None
    track_id: Optional[int] = Field(default=None, foreign_key="track.id", index=True)


class SongPrediction(SQLModel, table=True):
    """One user's predicted score for one recording — written only for the
    songs of song bins (worker/catalog_predict.py), so a song bin can show
    each song's own prediction, on the song scale, where an album bin shows
    the record's. The per-song numbers already exist inside the catalog
    stage; everything else reads album means. A new table, so create_all
    builds it and the last migration turns RLS on."""
    __table_args__ = (UniqueConstraint("user_id", "track_id"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="pressuser.id", index=True)
    track_id: int = Field(foreign_key="track.id")
    predicted_score: float
    model_source: Optional[str] = None
    computed_at: datetime = Field(default_factory=_now, sa_column=Column(DateTime(timezone=True)))



class Block(SQLModel, table=True):
    """One person blocking another (backend/blocks.py). Either way round, the
    two stop seeing each other's reviews and social activity — feeds, threads,
    search, the people sheet — and can't friend or recommend to each other.
    Their ratings still count everywhere: charts, averages, the Pressd scores.
    A new table, so create_all builds it and the last migration turns RLS on."""
    __table_args__ = (UniqueConstraint("blocker_id", "blocked_id"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    blocker_id: int = Field(foreign_key="pressuser.id", index=True)
    blocked_id: int = Field(foreign_key="pressuser.id", index=True)
    created_at: datetime = Field(default_factory=_now, sa_column=Column(DateTime(timezone=True)))

# One set of genre tags per record, across every copy (backend/genre_sync.py):
# registered here so every session that can write an Album carries the rule.
from . import genre_sync  # noqa: E402,F401
# A copy's tracklist settles once it has songs and its record is out
# (backend/tracklist_settle.py), registered here for the same reason.
from . import tracklist_settle  # noqa: E402,F401

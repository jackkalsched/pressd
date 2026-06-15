import sqlite3

DB = "pressd.db"

# current_value → (canonical_genre, canonical_subgenre or None)
GENRE_MAP = {
    # Hip-Hop
    "hip hop": ("Hip-Hop", None),
    "Hip-Hop": ("Hip-Hop", None),
    "Hip-Hop/Rap": ("Hip-Hop", None),
    "rap/hip-hop": ("Hip-Hop", None),
    "Rap": ("Hip-Hop", None),
    "boom bap": ("Hip-Hop", "Boom Bap"),
    "abstract hip hop": ("Hip-Hop", "Abstract Hip-Hop"),
    "cloud rap": ("Hip-Hop", "Cloud Rap"),
    "jazz rap": ("Hip-Hop", "Jazz Rap"),
    "hardcore hip hop": ("Hip-Hop", "Hardcore Hip-Hop"),
    "gangsta rap": ("Hip-Hop", "Gangsta Rap"),
    "conscious hip hop": ("Hip-Hop", "Conscious Hip-Hop"),
    "experimental hip hop": ("Hip-Hop", "Experimental Hip-Hop"),
    "Experimental Hip-Hop": ("Hip-Hop", "Experimental Hip-Hop"),
    "southern hip hop": ("Hip-Hop", "Southern Hip-Hop"),
    "trap": ("Hip-Hop", "Trap"),
    "Trap": ("Hip-Hop", "Trap"),
    "digicore": ("Hip-Hop", "Digicore"),
    "uk drill": ("Hip-Hop", "UK Drill"),
    "pop rap": ("Hip-Hop", "Pop Rap"),
    "Pop Rap": ("Hip-Hop", "Pop Rap"),
    # R&B
    "r&b": ("R&B", None),
    "R&B/Soul": ("R&B", None),
    "Alt-R&B": ("R&B", "Alternative R&B"),
    "contemporary r&b": ("R&B", "Contemporary R&B"),
    "alternative r&b": ("R&B", "Alternative R&B"),
    "neo soul": ("R&B", "Neo Soul"),
    "Neo-Soul": ("R&B", "Neo Soul"),
    "smooth soul": ("R&B", "Smooth Soul"),
    "pop soul": ("R&B", "Pop Soul"),
    "chicago soul": ("R&B", "Chicago Soul"),
    "blue-eyed soul": ("R&B", "Blue-Eyed Soul"),
    "hip hop soul": ("R&B", "Hip-Hop Soul"),
    # Pop
    "pop": ("Pop", None),
    "Pop": ("Pop", None),
    "indie pop": ("Pop", "Indie Pop"),
    "bedroom pop": ("Pop", "Bedroom Pop"),
    "electropop": ("Pop", "Electropop"),
    "dance-pop": ("Pop", "Dance-Pop"),
    "synth-pop": ("Pop", "Synth-Pop"),
    "k-pop": ("Pop", "K-Pop"),
    "europop": ("Pop", "Europop"),
    "art pop": ("Pop", "Art Pop"),
    "sophisti-pop": ("Pop", "Sophisti-Pop"),
    "alternative pop": ("Pop", "Alternative Pop"),
    "dream pop": ("Pop", "Dream Pop"),
    "pop rock": ("Pop", "Pop Rock"),
    "dance": ("Pop", "Dance"),
    "Dance": ("Pop", "Dance"),
    "Hyper-Pop": ("Pop", "Hyperpop"),
    "dance-pop": ("Pop", "Dance-Pop"),
    # Rock
    "rock": ("Rock", None),
    "Rock": ("Rock", None),
    "indie rock": ("Rock", "Indie Rock"),
    "Indie Rock": ("Rock", "Indie Rock"),
    "alternative rock": ("Rock", "Alternative Rock"),
    "Alternative Rock": ("Rock", "Alternative Rock"),
    "alternative": ("Rock", "Alternative Rock"),
    "Alternative": ("Rock", "Alternative Rock"),
    "grunge": ("Rock", "Grunge"),
    "psychedelic rock": ("Rock", "Psychedelic Rock"),
    "progressive rock": ("Rock", "Progressive Rock"),
    "punk rock": ("Rock", "Punk Rock"),
    "pop punk": ("Rock", "Pop Punk"),
    "art rock": ("Rock", "Art Rock"),
    "alternative metal": ("Rock", "Alternative Metal"),
    "Alternative Metal": ("Rock", "Alternative Metal"),
    "britpop": ("Rock", "Britpop"),
    "shoegaze": ("Rock", "Shoegaze"),
    "jangle pop": ("Rock", "Jangle Pop"),
    "new wave": ("Rock", "New Wave"),
    # Electronic
    "electronic": ("Electronic", None),
    "electro house": ("Electronic", "Electro House"),
    "house": ("Electronic", "House"),
    "ambient": ("Electronic", "Ambient"),
    "ambient techno": ("Electronic", "Ambient Techno"),
    "trip hop": ("Electronic", "Trip Hop"),
    "indietronica": ("Electronic", "Indietronica"),
    "uk garage": ("Electronic", "UK Garage"),
    # Country
    "country": ("Country", None),
    "americana": ("Country", "Americana"),
    "country rock": ("Country", "Country Rock"),
    # Folk
    "folk": ("Folk", None),
    "indie folk": ("Folk", "Indie Folk"),
    "Indie Folk": ("Folk", "Indie Folk"),
    "folk rock": ("Folk", "Folk Rock"),
    "Folk Rock": ("Folk", "Folk Rock"),
    "folk pop": ("Folk", "Folk Pop"),
    "Folk Pop": ("Folk", "Folk Pop"),
    "alternative folk": ("Folk", "Alternative Folk"),
    # Jazz
    "jazz": ("Jazz", None),
    "jazz pop": ("Jazz", "Jazz Pop"),
    "contemporary jazz": ("Jazz", "Contemporary Jazz"),
    # Latin
    "latin pop": ("Latin", "Latin Pop"),
    "Latin Pop": ("Latin", "Latin Pop"),
    "reggaeton": ("Latin", "Reggaeton"),
    "latin": ("Latin", None),
    "Latin": ("Latin", None),
    # Gospel / Christian
    "gospel": ("Gospel", None),
    "Christian": ("Gospel", "Christian"),
    # Classical
    "classical": ("Classical", None),
    "Classical Crossover": ("Classical", "Classical Crossover"),
    # Standalone genres
    "afrobeats": ("Afrobeats", None),
    "singer-songwriter": ("Singer-Songwriter", None),
    "blues": ("Blues", None),
    "funk": ("Funk", None),
    "Funk": ("Funk", None),
    "disco": ("Disco", None),
    "ballad": ("Pop", "Ballad"),
    # Garbage → NULL
    "laut.de": (None, None),
    "musicline.de": (None, None),
    "me 26–01": (None, None),
    "1–4 wochen": (None, None),
}

conn = sqlite3.connect(DB)
cur = conn.cursor()

cur.execute("SELECT id, genre, sub_genre1 FROM album WHERE genre IS NOT NULL")
rows = cur.fetchall()

updated = 0
skipped = []
for album_id, genre, sub_genre1 in rows:
    if genre not in GENRE_MAP:
        skipped.append(genre)
        continue
    new_genre, new_sub = GENRE_MAP[genre]
    # Don't overwrite an existing sub_genre1
    new_sub1 = new_sub if sub_genre1 is None else sub_genre1
    cur.execute(
        "UPDATE album SET genre = ?, sub_genre1 = ? WHERE id = ?",
        (new_genre, new_sub1, album_id),
    )
    updated += 1

conn.commit()
print(f"Updated: {updated}  |  Skipped (unmapped): {len(skipped)}")
if skipped:
    from collections import Counter
    print("Unmapped values:", Counter(skipped).most_common())

print("\n--- genre value_counts ---")
cur.execute("SELECT genre, COUNT(*) FROM album WHERE genre IS NOT NULL GROUP BY genre ORDER BY COUNT(*) DESC")
for g, c in cur.fetchall():
    print(f"  {g}: {c}")

print("\n--- sub_genre1 value_counts ---")
cur.execute("SELECT sub_genre1, COUNT(*) FROM album WHERE sub_genre1 IS NOT NULL GROUP BY sub_genre1 ORDER BY COUNT(*) DESC")
for g, c in cur.fetchall():
    print(f"  {g}: {c}")

conn.close()

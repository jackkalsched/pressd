import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import init_db
from .routers import albums, songs, stats, search, aoty, util, audio, users

app = FastAPI(title="Press'd API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://pressd-eta.vercel.app",
        os.getenv("APP_URL", ""),
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()


app.include_router(albums.router)
app.include_router(songs.router)
app.include_router(stats.router)
app.include_router(search.router)
app.include_router(aoty.router)
app.include_router(util.router)
app.include_router(audio.router)
app.include_router(users.router)


@app.get("/health")
def health():
    return {"status": "ok"}

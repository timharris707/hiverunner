"""
server.py - HTTP launcher for optional HiveRunner Voice avatar sessions.

Endpoints:
  POST /start  → Creates a Daily room, spawns the Pipecat bot, returns room URL + token
  GET  /health → Health check

The Next.js frontend calls POST /start to spin up an optional voice avatar
session, then joins the returned Daily room URL with the user token.
"""

import asyncio
import os
import time
from contextlib import asynccontextmanager

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from pydantic import BaseModel

load_dotenv(override=True)

# ─── Config ──────────────────────────────────────────────────────────
DAILY_API_KEY = os.getenv("DAILY_API_KEY", "")
DAILY_API_URL = "https://api.daily.co/v1"
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8108"))
DEFAULT_CORS_ORIGINS = "http://localhost:3010,http://localhost:3001"
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("HIVERUNNER_VOICE_CORS_ORIGINS", DEFAULT_CORS_ORIGINS).split(",")
    if origin.strip()
]

# Track active bot tasks for cleanup
_active_tasks: dict[str, asyncio.Task] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"HiveRunner Voice server starting on {HOST}:{PORT}")
    yield
    # Cancel any running bot tasks on shutdown
    for room_name, task in _active_tasks.items():
        logger.info(f"Cancelling bot in room: {room_name}")
        task.cancel()
    _active_tasks.clear()
    logger.info("HiveRunner Voice server shut down.")


app = FastAPI(
    title="HiveRunner Voice - Pipecat Server",
    description="Launches optional Pipecat + Tavus avatar sessions for HiveRunner Voice",
    version="0.1.0",
    lifespan=lifespan,
)

# Allow CORS from the local HiveRunner frontend. Configure additional origins
# explicitly through HIVERUNNER_VOICE_CORS_ORIGINS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Models ──────────────────────────────────────────────────────────
class StartResponse(BaseModel):
    room_url: str
    room_name: str
    user_token: str


class HealthResponse(BaseModel):
    status: str
    uptime: float
    active_sessions: int


_start_time = time.time()


# ─── Daily.co Room Management ───────────────────────────────────────
async def create_daily_room() -> dict:
    """Create a temporary Daily.co room for the voice session."""
    if not DAILY_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="DAILY_API_KEY not configured. Sign up at https://dashboard.daily.co/",
        )

    async with httpx.AsyncClient() as client:
        # Create room with 1-hour expiry
        resp = await client.post(
            f"{DAILY_API_URL}/rooms",
            headers={"Authorization": f"Bearer {DAILY_API_KEY}"},
            json={
                "properties": {
                    "exp": int(time.time()) + 3600,  # 1 hour
                    "enable_chat": False,
                    "enable_screenshare": False,
                    "max_participants": 4,  # user + bot + tavus avatar + buffer
                    "enable_prejoin_ui": False,
                },
            },
        )
        if resp.status_code != 200:
            logger.error(f"Failed to create Daily room: {resp.status_code} {resp.text}")
            raise HTTPException(status_code=502, detail="Failed to create Daily room")

        room_data = resp.json()
        logger.info(f"Created Daily room: {room_data['name']} → {room_data['url']}")
        return room_data


async def create_daily_token(room_name: str, owner: bool = False) -> str:
    """Create a meeting token for a participant."""
    if not DAILY_API_KEY:
        raise HTTPException(status_code=500, detail="DAILY_API_KEY not configured")

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{DAILY_API_URL}/meeting-tokens",
            headers={"Authorization": f"Bearer {DAILY_API_KEY}"},
            json={
                "properties": {
                    "room_name": room_name,
                    "is_owner": owner,
                    "exp": int(time.time()) + 3600,
                },
            },
        )
        if resp.status_code != 200:
            logger.error(f"Failed to create meeting token: {resp.status_code} {resp.text}")
            raise HTTPException(status_code=502, detail="Failed to create meeting token")

        return resp.json()["token"]


# ─── Endpoints ───────────────────────────────────────────────────────
@app.post("/start", response_model=StartResponse)
async def start_session():
    """
    Create a new voice avatar session.

    1. Creates a Daily.co room
    2. Generates tokens (bot owner + user participant)
    3. Spawns the Pipecat bot in the background
    4. Returns room URL + user token for the frontend to join
    """
    # Validate required env vars
    missing = []
    for key in ["DAILY_API_KEY", "TAVUS_API_KEY", "GOOGLE_API_KEY", "DEEPGRAM_API_KEY", "CARTESIA_API_KEY"]:
        if not os.getenv(key):
            missing.append(key)
    if missing:
        raise HTTPException(
            status_code=500,
            detail=f"Missing required environment variables: {', '.join(missing)}",
        )

    # Create room + tokens
    room = await create_daily_room()
    room_name = room["name"]
    room_url = room["url"]

    bot_token = await create_daily_token(room_name, owner=True)
    user_token = await create_daily_token(room_name, owner=False)

    # Spawn bot in background
    from bot import run_hiverunner_voice_bot

    task = asyncio.create_task(run_hiverunner_voice_bot(room_url, bot_token))
    _active_tasks[room_name] = task

    # Clean up when bot finishes
    def _on_done(t: asyncio.Task):
        _active_tasks.pop(room_name, None)
        if t.exception():
            logger.error(f"Bot in {room_name} crashed: {t.exception()}")
        else:
            logger.info(f"Bot in {room_name} finished cleanly.")

    task.add_done_callback(_on_done)

    logger.info(f"Session started: room={room_name}")
    return StartResponse(
        room_url=room_url,
        room_name=room_name,
        user_token=user_token,
    )


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="ok",
        uptime=round(time.time() - _start_time, 1),
        active_sessions=len(_active_tasks),
    )


# ─── Main ────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "server:app",
        host=HOST,
        port=PORT,
        reload=True,
        log_level="info",
    )

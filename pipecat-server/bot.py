"""
bot.py - optional HiveRunner Voice Pipecat bot

Pipecat pipeline:
  User audio -> Deepgram STT -> Gemini LLM -> Cartesia TTS -> Tavus Video -> Daily WebRTC -> User

This module defines the bot pipeline. It's launched by server.py per session.
"""

import os

import aiohttp
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.google.llm import GoogleLLMService
from pipecat.services.tavus.video import TavusVideoService
from pipecat.transports.daily.transport import DailyTransport, DailyParams

from voice_prompt import VOICE_SYSTEM_PROMPT

DEFAULT_CARTESIA_VOICE = "a0e99841-438c-4a64-b679-ae501e7d6091"
DEFAULT_BOT_NAME = "HiveRunner Voice"


async def run_hiverunner_voice_bot(room_url: str, token: str) -> None:
    """
    Launch the optional HiveRunner voice avatar bot into a Daily room.

    Args:
        room_url: Daily.co room URL to join
        token: Daily.co meeting token for bot participant
    """
    logger.info(f"Starting HiveRunner voice bot in room: {room_url}")

    transport = DailyTransport(
        room_url=room_url,
        token=token,
        bot_name=os.getenv("HIVERUNNER_VOICE_BOT_NAME", DEFAULT_BOT_NAME),
        params=DailyParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            video_out_enabled=True,
            video_out_is_live=True,
            video_out_width=1280,
            video_out_height=720,
            audio_out_auto_silence=False,
        ),
    )

    async with aiohttp.ClientSession() as session:
        # ─── Services ────────────────────────────────────────────
        stt = DeepgramSTTService(
            api_key=os.getenv("DEEPGRAM_API_KEY"),
        )

        tts = CartesiaTTSService(
            api_key=os.getenv("CARTESIA_API_KEY"),
            settings=CartesiaTTSService.Settings(
                voice=os.getenv("CARTESIA_VOICE_ID", DEFAULT_CARTESIA_VOICE),
            ),
        )

        llm = GoogleLLMService(
            api_key=os.getenv("GOOGLE_API_KEY"),
            settings=GoogleLLMService.Settings(
                system_instruction=os.getenv("HIVERUNNER_VOICE_SYSTEM_PROMPT", VOICE_SYSTEM_PROMPT),
            ),
        )

        tavus = TavusVideoService(
            api_key=os.getenv("TAVUS_API_KEY"),
            replica_id=os.getenv("TAVUS_REPLICA_ID", "rf4703150052"),
            session=session,
        )

        # ─── Context & Aggregators ───────────────────────────────
        context = LLMContext()
        user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
            context,
            user_params=LLMUserAggregatorParams(
                vad_analyzer=SileroVADAnalyzer(),
            ),
        )

        # ─── Pipeline ───────────────────────────────────────────
        pipeline = Pipeline(
            [
                transport.input(),
                stt,
                user_aggregator,
                llm,
                tts,
                tavus,
                transport.output(),
                assistant_aggregator,
            ]
        )

        task = PipelineTask(
            pipeline,
            params=PipelineParams(
                audio_in_sample_rate=16000,
                audio_out_sample_rate=24000,
                enable_metrics=True,
            ),
        )

        # ─── Event Handlers ─────────────────────────────────────
        @transport.event_handler("on_client_connected")
        async def on_client_connected(transport, client):
            logger.info(f"Client connected: {client}")
            # Kick off the first greeting after the browser joins.
            context.add_message(
                {
                    "role": "user",
                    "content": "A user just connected to the HiveRunner voice session. Greet them briefly and explain that voice is ready.",
                }
            )
            await task.queue_frames([LLMRunFrame()])

        @transport.event_handler("on_client_disconnected")
        async def on_client_disconnected(transport, client):
            logger.info(f"Client disconnected: {client}")
            await task.cancel()

        # ─── Run ─────────────────────────────────────────────────
        runner = PipelineRunner(handle_sigint=True)
        logger.info("HiveRunner voice bot running - waiting for participants...")
        await runner.run(task)
        logger.info("HiveRunner voice bot session ended.")

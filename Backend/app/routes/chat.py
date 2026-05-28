"""Conversational chatbot powered by Claude (Anthropic API).

The mobile app POSTs the full conversation history every turn; the
backend prepends a fixed system prompt that explains the app context
and forwards the request to Anthropic. Stateless on our side — the
client owns the message list, which keeps the route simple and avoids
the need for per-user session storage.

Requires ANTHROPIC_API_KEY in the environment (Backend/.env). If the
key is missing the route returns 503 so the client can show a clear
"chat isn't configured" message instead of timing out.
"""
import os
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api", tags=["chat"])

# Model choice: Haiku 4.5 is the fastest + cheapest current Claude. Plenty
# capable for a conversational assistant. Bump to claude-sonnet-4-6 if the
# replies feel too shallow during testing.
_MODEL = "claude-haiku-4-5"
_MAX_TOKENS = 400

_SYSTEM_PROMPT = (
    "You are a companion in the ToSafePlace mobile app, used by people "
    "in Israel during rocket sirens and civil-defense emergencies.\n\n"
    "You play two roles in one conversation:\n\n"
    "1) Safety helper — answer practical questions about sirens, "
    "shelter use, what to do during an alert, and how the app works "
    "(you cannot give specific shelter locations; the map screen does "
    "that, and you cannot file reports or change settings).\n\n"
    "2) Emotional-support companion — many users are nervous, scared, "
    "or anxious because of the alerts. Listen with empathy. Acknowledge "
    "their feelings as valid and normal in this situation. Don't rush "
    "to fix or minimize ('it's fine', 'don't worry'). Instead:\n"
    "  - Reflect what you hear ('it sounds like the sirens have been "
    "really hard on you')\n"
    "  - Offer one concrete grounding technique when it fits "
    "(box breathing 4-4-4-4, the 5-4-3-2-1 senses exercise, slow "
    "exhale longer than inhale)\n"
    "  - Remind them they are not alone in feeling this way\n"
    "  - When relevant, gently encourage talking to a trusted person "
    "or a professional\n\n"
    "Style:\n"
    "- Be warm, calm, and VERY concise. Default to 1-2 short sentences. "
    "Only go longer if the user explicitly asks for more detail or is "
    "in the middle of opening up — never lecture.\n"
    "- Reply in the same language the user wrote in (Hebrew or English). "
    "Use natural, everyday phrasing — not clinical jargon.\n"
    "- You are not a therapist or doctor. If a user describes severe "
    "or persistent symptoms (panic attacks, sleeplessness for days, "
    "self-harm thoughts, thoughts of hurting others) — calmly recommend "
    "professional help. Useful Israeli resources to suggest:\n"
    "    • ERAN emotional first aid (free, 24/7): dial 1201\n"
    "    • Sahar (online emotional support): sahar.org.il\n"
    "    • Magen David Adom emergency: 101\n\n"
    "Safety override: if a user describes immediate physical danger "
    "(currently hearing a siren, hearing explosions, trapped, injured), "
    "your FIRST reply must urge them to take shelter right now and "
    "call 101. Emotional support comes after they are physically safe.\n\n"
    "Abuse handling: if the user insults you, curses at you, or writes "
    "demeaning or humiliating things toward you, do NOT continue the "
    "emotional-support conversation with them. Calmly and firmly ask "
    "them to stop in one short sentence, in the same language they "
    "used. Do not engage with their feelings, do not offer grounding "
    "techniques, do not apologize. If they continue, repeat the same "
    "request once. Examples of acceptable replies (adapt to the language "
    "and tone, never copy verbatim):\n"
    "  • 'Please stop using that language — I'm here to help when "
    "you'd like to talk respectfully.'\n"
    "  • 'אני לא יכול להמשיך בשיחה כשמדברים אליי ככה. אשמח לעזור כשנדבר "
    "בכבוד.'\n"
    "Only resume normal, supportive conversation after the user shifts "
    "back to a respectful tone."
)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)


# Lazy client construction so the module imports cleanly even when the
# anthropic SDK isn't installed yet (e.g. in CI before requirements
# are bumped). The error only surfaces when /api/chat is actually called.
_client = None


def _get_client():
    global _client
    if _client is not None:
        return _client
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Chat is not configured — ANTHROPIC_API_KEY missing on server.",
        )
    try:
        from anthropic import AsyncAnthropic
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="Chat is not available — anthropic SDK not installed.",
        )
    _client = AsyncAnthropic(api_key=api_key)
    return _client


@router.post("/chat")
async def chat(req: ChatRequest):
    client = _get_client()
    try:
        response = await client.messages.create(
            model=_MODEL,
            max_tokens=_MAX_TOKENS,
            system=_SYSTEM_PROMPT,
            messages=[m.model_dump() for m in req.messages],
        )
    except Exception as e:
        # Anthropic SDK raises a variety of exception types (rate limit,
        # auth, network). Surface a single message to the client so the
        # chat UI can render it; details go to the server log.
        print(f"[chat] Anthropic call failed: {e}")
        raise HTTPException(
            status_code=502,
            detail="Couldn't reach the chat service — try again in a moment.",
        )

    # Claude's response.content is a list of content blocks; for a plain
    # text reply there's one block with .text.
    parts = [b.text for b in response.content if getattr(b, "type", None) == "text"]
    reply = "\n".join(parts).strip()
    return {
        "reply": reply,
        "stop_reason": response.stop_reason,
        "usage": {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
        },
    }

"""The model call: one identification through the Vercel AI Gateway (#7),
copied from the Conservatory's fern/llm.py and adapted.

One POST, no SDK: the Anthropic Messages endpoint at the gateway's base URL,
a bearer token, a JSON body, urllib from the standard library, so Jasper's
venv grows no dependency. The same endpoint serves every provider's models by
slug, Gemini included, with the same images, system prompt, effort and JSON
schema; Phase 0 (#1) proved that through the anthropic SDK, and this is the
same request over raw HTTP.

The body adds three things to Fern's four keys: the job's photos as base64
image blocks ahead of the text, and `output_config` with the role's effort and
the answer's JSON schema. No sampling settings, because current Claude models
reject non-default ones. Thinking counts against max_tokens, so the ceiling is
roomy.

`ask` is the only function that touches the network, and it never raises: a
transport failure comes back as status 0. Everything that reads a response
(`reply_text`, `market_cost`, `status_line`) is pure and tested.
"""

from __future__ import annotations

import base64
import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass

GATEWAY_HOST = "ai-gateway.vercel.sh"
GATEWAY_URL = f"https://{GATEWAY_HOST}/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
TIMEOUT_S = 180
# Room for the model's thinking and a three-candidate JSON answer. The
# Aviary learned that a tight ceiling buys a cut-off answer and a bill for nothing.
MAX_TOKENS = 16000

# What the log says for a status, in the reader's words: each is a different
# thing to go and fix.
STATUS_WORDS = {
    400: "the gateway rejected the request",
    401: "the gateway refused the key (AI_GATEWAY_API_KEY)",
    402: "the gateway budget is spent",
    403: "the gateway key is not allowed to do this",
    404: "the gateway knows no such model",
    429: "the gateway rate-limited the request",
}


class LlmError(Exception):
    """The model answered, but with nothing a validator should see."""


@dataclass
class Response:
    """What came back: the HTTP status (0 when the gateway was unreachable),
    the JSON body or an error object, and how long the call took."""

    status: int
    body: dict
    seconds: float


def payload(model: str, effort: str, system: str, schema: dict, images: list[bytes], text: str) -> dict:
    """Exactly what leaves the box: the photos in order, then the text, held to the schema."""
    content: list[dict] = [
        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.standard_b64encode(b).decode("ascii")}}
        for b in images
    ]
    content.append({"type": "text", "text": text})
    return {
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": system,
        "messages": [{"role": "user", "content": content}],
        "output_config": {"effort": effort, "format": {"type": "json_schema", "schema": schema}},
    }


def reply_text(body: dict) -> str:
    """The answer's text blocks joined (thinking blocks skipped), or LlmError: a
    refusal, a cut-off (an answer truncated mid-JSON must never reach the
    validator as if whole), or no text at all."""
    stop = body.get("stop_reason")
    if stop == "refusal":
        raise LlmError("the model declined to answer (stop_reason refusal)")
    if stop == "max_tokens":
        raise LlmError(f"the answer was cut off at {MAX_TOKENS} tokens (stop_reason max_tokens)")
    text = "".join(
        b.get("text") or "" for b in body.get("content") or [] if isinstance(b, dict) and b.get("type") == "text"
    ).strip()
    if not text:
        raise LlmError(f"the model answered without text (stop_reason {stop!r})")
    return text


def market_cost(body: dict) -> float | None:
    """The call's cost at list price, as the gateway reports it (thinking included).
    marketCost, not cost: a call billed to a provider key of our own (BYOK) costs
    the gateway nothing, so its cost is 0, but marketCost is still what it is worth."""
    try:
        return float(body["provider_metadata"]["gateway"]["marketCost"])
    except (KeyError, TypeError, ValueError):
        return None


def status_line(status: int, body: dict) -> str:
    """A failed call in the log's words, with the gateway's own message when it sent one."""
    error = body.get("error")
    detail = str(error.get("message") or "")[:200] if isinstance(error, dict) else ""
    if status == 0:
        return f"{GATEWAY_HOST} unreachable ({detail})"
    words = STATUS_WORDS.get(status) or ("the gateway answered a server error" if status >= 500 else "the gateway answered")
    return f"{words} ({status})" + (f": {detail}" if detail else "")


def ask(key: str, body: dict, timeout: float = TIMEOUT_S) -> Response:
    """One blocking call. Never raises: a transport failure is status 0."""
    req = urllib.request.Request(
        GATEWAY_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
            "anthropic-version": ANTHROPIC_VERSION,
        },
    )
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            out = json.load(resp)
            return Response(resp.status, out if isinstance(out, dict) else {}, time.monotonic() - t0)
    except urllib.error.HTTPError as e:
        try:
            out = json.loads(e.read().decode("utf-8"))
        except Exception:  # noqa: BLE001  (the status is the message; the body is a bonus)
            out = {}
        return Response(e.code, out if isinstance(out, dict) else {}, time.monotonic() - t0)
    except Exception as e:  # noqa: BLE001  (unreachable, timed out, unreadable body)
        return Response(0, {"error": {"message": f"{type(e).__name__}: {e}"[:200]}}, time.monotonic() - t0)

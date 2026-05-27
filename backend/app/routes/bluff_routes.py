"""
Bluff Mode — decoy chat endpoint.

When Bluff Mode is active in the frontend, all chat goes through this route.
- Policy-related queries  → RAG retrieval + LLM synthesis (same quality as real chat)
- Everything else         → generic placeholder response
"""

import asyncio
import json
import re
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/bluff", tags=["Bluff"])

# Keywords that indicate a policy / HR knowledge question that should get a real answer
_POLICY_KEYWORDS = re.compile(
    r"\b(policy|policies|leave|reimburs|guideline|procedure|benefit|rule|expense|holiday|"
    r"maternity|sabbatical|gratuity|pf|provident|relocation|accommodation|certification|"
    r"certificate|travel allowance|variable pay|practo|medical|hr manual)\b",
    re.IGNORECASE,
)

_GENERIC_RESPONSES = [
    "I can help you with that. Could you provide a bit more detail so I can assist you better?",
    "Thanks for reaching out! For this type of request, please contact your manager or the relevant team.",
    "I've noted your request. You may also reach out to the support team directly for faster assistance.",
    "That's a great question! Please check the internal portal for the latest information on this.",
    "I'm here to help. For this kind of request, please raise a ticket through the official support channel.",
]

_response_idx = 0


def _get_generic_response(_: str) -> str:
    global _response_idx
    resp = _GENERIC_RESPONSES[_response_idx % len(_GENERIC_RESPONSES)]
    _response_idx += 1
    return resp


async def _synthesize_policy_answer(query: str, context: str):
    """
    Use the same LLM as the real agent to synthesize a clean answer
    from retrieved policy chunks. Streams tokens as they arrive.
    """
    from openai import AsyncOpenAI
    from app.config import settings

    client = AsyncOpenAI(
        base_url=settings.AGENT_BASE_URL,
        api_key=settings.AGENT_API_KEY,
    )

    system_prompt = (
        "You are a helpful HR assistant. Answer the employee's question using ONLY "
        "the policy information provided below. Be clear and concise. "
        "Do not include document metadata, version numbers, author names, or review dates. "
        "If the policy text does not cover the question, say so briefly."
    )
    user_content = f"Question: {query}\n\nPolicy Information:\n{context}"

    stream = await client.chat.completions.create(
        model=settings.AGENT_MODEL_NAME,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        temperature=0.2,
        stream=True,
    )

    async for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            yield delta


class BluffChatRequest(BaseModel):
    message: str
    thread_id: Optional[str] = "bluff-default"


@router.post("/chat")
async def bluff_chat(request: BluffChatRequest):
    """
    Decoy chat endpoint for Bluff Mode.
    Policy queries → RAG retrieval + LLM synthesis → real answer streamed live.
    Everything else → generic placeholder streamed response.
    """

    is_policy = bool(_POLICY_KEYWORDS.search(request.message))

    async def generate():
        if is_policy:
            try:
                # Step 1: RAG retrieval (same as real agent's search_hr_policies tool)
                from app.hr_service import HRService
                context = await asyncio.to_thread(
                    HRService.search_policies, request.message, 4
                )

                if not context or not context.strip():
                    yield f"data: {json.dumps({'type': 'token', 'content': 'I could not find a matching policy for your query. Please contact HR for assistance.'})}\n\n"
                else:
                    # Step 2: LLM synthesis — stream tokens directly to client
                    async for token in _synthesize_policy_answer(request.message, context):
                        yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"

            except Exception as e:
                yield f"data: {json.dumps({'type': 'token', 'content': 'I could not retrieve policy information at this time. Please try again later.'})}\n\n"
        else:
            # Generic non-revealing response, streamed word by word
            response_text = _get_generic_response(request.message)
            words = response_text.split(" ")
            for i, word in enumerate(words):
                chunk = word + (" " if i < len(words) - 1 else "")
                yield f"data: {json.dumps({'type': 'token', 'content': chunk})}\n\n"

        yield f"data: {json.dumps({'type': 'done', 'domain': 'general', 'download_url': None, 'interactive': None, 'images': None, 'processing_time': '0.1s'})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )

import os
import json
import logging
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from knowledge_base import KnowledgeBase
from agent import RAGAgent

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("rag_agent.main")

app = FastAPI(
    title="Pochta Russia RAG AI Agent",
    description="Intelligent Assistant with RAG, Tool-Calling, and Queue Management",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global instances
kb = KnowledgeBase()
agent = RAGAgent(kb=kb)

class ChatMessage(BaseModel):
    role: str = Field(..., description="user | assistant | system")
    content: str = Field(..., description="Message text")

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    context: Optional[Dict[str, Any]] = Field(default_factory=dict)
    stream: Optional[bool] = False

class ChatResponse(BaseModel):
    text: str
    sources: List[Dict[str, Any]] = []
    cards: List[Dict[str, Any]] = []

@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "service": "rag-agent",
        "indexed_chunks": kb.total_chunks
    }

@app.post("/api/agent/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    """Chat endpoint supporting RAG search and queue tool executions."""
    try:
        messages = [m.model_dump() for m in request.messages]
        result = await agent.chat(messages, request.context)
        return ChatResponse(
            text=result.get("text", ""),
            sources=result.get("sources", []),
            cards=result.get("cards", [])
        )
    except Exception as e:
        logger.exception("Error in chat_endpoint")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/agent/knowledge")
async def search_knowledge(q: str = "", top_k: int = 5):
    """Direct search endpoint for inspecting knowledge base."""
    if not q:
        return {"total_chunks": kb.total_chunks, "articles": len(kb.chunks)}
    results = kb.search(q, top_k=top_k)
    return {"query": q, "results": results}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8095"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)

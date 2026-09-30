import os
import re
import math
import json
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger("rag_agent.kb")

class KnowledgeBase:
    def __init__(self, data_path: Optional[str] = None):
        if not data_path:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            data_path = os.path.join(base_dir, "data", "kb_articles.json")
        self.data_path = data_path
        self.chunks: List[Dict[str, Any]] = []
        self.doc_freq: Dict[str, int] = {}
        self.total_chunks = 0
        self.load_and_index()

    def _tokenize(self, text: str) -> List[str]:
        """Simple, fast tokenizer with Russian word normalization (stem-like truncation)."""
        words = re.findall(r'[а-яёa-z0-9]+', text.lower())
        tokens = []
        for w in words:
            if len(w) <= 2:
                continue
            # Basic stem: keep root for Russian morphology matching
            stem = w[:-2] if len(w) > 5 else (w[:-1] if len(w) > 4 else w)
            tokens.append(stem)
        return tokens

    def load_and_index(self):
        """Loads articles, creates chunks and builds search index."""
        if not os.path.exists(self.data_path):
            logger.warning(f"KB file not found at {self.data_path}")
            return

        with open(self.data_path, "r", encoding="utf-8") as f:
            articles = json.load(f)

        self.chunks = []
        for art in articles:
            # We index both full content and sub-sections
            content = art.get("content", "")
            paragraphs = [p.strip() for p in content.split("\n\n") if p.strip()]

            # Also add an overview chunk
            keywords_text = " ".join(art.get("keywords", []))
            full_context = f"{art.get('title', '')}. {art.get('summary', '')} {keywords_text}"
            
            self.chunks.append({
                "article_id": art.get("id"),
                "title": art.get("title"),
                "category": art.get("category"),
                "text": f"{art.get('title')}\n{art.get('summary')}\n{content}",
                "summary": art.get("summary"),
                "tokens": self._tokenize(full_context + " " + content)
            })

            # Add paragraph level chunks for finer granularity
            for idx, p in enumerate(paragraphs):
                p_tokens = self._tokenize(f"{art.get('title')} {p}")
                self.chunks.append({
                    "article_id": art.get("id"),
                    "title": f"{art.get('title')} (Раздел {idx + 1})",
                    "category": art.get("category"),
                    "text": p,
                    "summary": art.get("summary"),
                    "tokens": p_tokens
                })

        self.total_chunks = len(self.chunks)
        # Compute document frequencies for TF-IDF / BM25
        self.doc_freq = {}
        for chunk in self.chunks:
            unique_tokens = set(chunk["tokens"])
            for t in unique_tokens:
                self.doc_freq[t] = self.doc_freq.get(t, 0) + 1

        logger.info(f"KnowledgeBase indexed {len(articles)} articles into {self.total_chunks} chunks.")

    def search(self, query: str, top_k: int = 3) -> List[Dict[str, Any]]:
        """Hybrid search combining keyword frequency, BM25-like weighting and title matching."""
        if not query or not self.chunks:
            return []

        q_tokens = self._tokenize(query)
        if not q_tokens:
            return []

        scores = []
        for chunk in self.chunks:
            chunk_tokens = chunk["tokens"]
            chunk_len = len(chunk_tokens)
            if chunk_len == 0:
                continue

            score = 0.0
            # Term matching & TF-IDF
            chunk_token_counts = {}
            for t in chunk_tokens:
                chunk_token_counts[t] = chunk_token_counts.get(t, 0) + 1

            for qt in q_tokens:
                if qt in chunk_token_counts:
                    tf = chunk_token_counts[qt] / chunk_len
                    df = self.doc_freq.get(qt, 1)
                    idf = math.log((self.total_chunks + 1) / (df + 0.5)) + 1.0
                    score += tf * idf * 2.5

            # Bonus for matching title words
            title_tokens = set(self._tokenize(chunk["title"]))
            title_matches = sum(1 for qt in q_tokens if qt in title_tokens)
            if title_matches > 0:
                score += title_matches * 1.5

            if score > 0:
                scores.append((score, chunk))

        # Sort descending by score
        scores.sort(key=lambda x: x[0], reverse=True)

        results = []
        seen_texts = set()
        for score, chunk in scores:
            # Deduplicate similar overlapping text
            text_hash = chunk["text"][:80]
            if text_hash in seen_texts:
                continue
            seen_texts.add(text_hash)

            results.append({
                "article_id": chunk["article_id"],
                "title": chunk["title"],
                "category": chunk["category"],
                "content": chunk["text"],
                "summary": chunk["summary"],
                "score": round(score, 4)
            })
            if len(results) >= top_k:
                break

        return results

    def format_for_prompt(self, results: List[Dict[str, Any]]) -> str:
        """Formats search results as context for LLM prompt."""
        if not results:
            return "Релевантная информация в базе знаний не найдена."

        blocks = []
        for i, res in enumerate(results, 1):
            blocks.append(
                f"[Источник {i}]: {res['title']} (Категория: {res['category']})\n{res['content']}"
            )
        return "\n\n---\n\n".join(blocks)

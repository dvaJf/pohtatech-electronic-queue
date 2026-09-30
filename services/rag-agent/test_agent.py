import asyncio
import unittest
from knowledge_base import KnowledgeBase
from agent import RAGAgent

class TestRAGKnowledgeBase(unittest.TestCase):
    def setUp(self):
        self.kb = KnowledgeBase()

    def test_indexing(self):
        self.assertGreater(self.kb.total_chunks, 0)
        self.assertGreater(len(self.kb.chunks), 0)

    def test_search_parcels(self):
        results = self.kb.search("посылка 1 класс габариты вес", top_k=3)
        self.assertGreater(len(results), 0)
        top = results[0]
        self.assertIn("посылк", top["content"].lower())

    def test_search_pep_pickup(self):
        results = self.kb.search("как получить без паспорта по смс", top_k=3)
        self.assertGreater(len(results), 0)
        self.assertTrue(any("пэп" in r["title"].lower() or "электрон" in r["title"].lower() for r in results))

    def test_search_prohibited(self):
        results = self.kb.search("запрещено отправлять оружие деньги", top_k=3)
        self.assertGreater(len(results), 0)
        self.assertTrue(any("запрещ" in r["title"].lower() or "безопасн" in r["category"].lower() for r in results))

class TestRAGAgent(unittest.TestCase):
    def setUp(self):
        self.kb = KnowledgeBase()
        self.agent = RAGAgent(kb=self.kb)

    def test_autonomous_greeting(self):
        res = asyncio.run(self.agent.chat([{"role": "user", "content": "Привет, кто ты?"}]))
        self.assertIn("Почты России", res["text"])

    def test_autonomous_kb_query(self):
        res = asyncio.run(self.agent.chat([{"role": "user", "content": "Сколько дней хранится судебное письмо?"}]))
        self.assertIn("7", res["text"])
        self.assertGreater(len(res["sources"]), 0)

if __name__ == "__main__":
    unittest.main()

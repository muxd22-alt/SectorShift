import os
import json
import time
import asyncio
import requests
import feedparser
import libsql_client
from dotenv import load_dotenv

load_dotenv()

from llm import chat_json

ARXIV_URL = ("http://export.arxiv.org/api/query?"
             "search_query=cat:cs.AI+OR+cat:cs.LG+OR+cat:econ.GN"
             "&start=0&max_results=50&sortBy=submittedDate&sortOrder=descending")

MAX_ITEMS = 16  # per day


def fetch_arxiv_papers():
    print("Fetching from Arxiv API...")
    feed = feedparser.parse(ARXIV_URL)
    papers = []
    for entry in feed.entries:
        papers.append({
            "id": entry.id.split('/abs/')[-1],
            "title": entry.title.replace('\n', ' ').strip(),
            "abstract": entry.summary.replace('\n', ' ').strip(),
            "published": entry.published,
            "link": entry.link
        })
    return papers[:MAX_ITEMS]


PROMPT = """
Analyze ONE research paper for a daily sector-rotation briefing.

Paper_ID: {id}
Title: {title}
Abstract: {abstract}
Published: {published}

Return ONLY a JSON object with exactly these keys:
{{
  "Paper_ID": "{id}",
  "Hook": "one sentence, max 18 words, says what is newly possible, no preamble",
  "Breakthrough_Score": integer 1-10,
  "Core_Innovation": "1-2 sentences: the actual technical delta, not a restatement of the abstract",
  "Benefiting_Sectors": "comma-separated industries that gain, title case, or empty",
  "Disrupted_Sectors": "comma-separated industries that lose, title case, or empty",
  "Decision_Perspective": "exactly 2 sentences: what to build, buy, fund or kill because of this",
  "Tags": "3-5 comma-separated keywords"
}}

Breakthrough_Score rubric: 1-3 incremental on existing methods;
4-6 useful advance with clear experiments; 7-8 demonstrates a genuinely new
capability; 9-10 would change how a field works and the evidence is in the abstract.
Do not reward hype or benchmark deltas without context.

Decision_Perspective rules: name a concrete action with a timeframe or trigger.
Never write "further research is needed", "stakeholders should monitor", or
"this has implications for various sectors".

Banned filler: "ever-evolving", "paradigm shift", "cutting-edge", "leveraging",
"a comprehensive approach", "plays a crucial role", "in conclusion".
"""


def analyze_paper_with_llm(paper, api_key):
    prompt = PROMPT.format(
        id=paper["id"],
        title=paper["title"],
        abstract=paper["abstract"][:1000],
        published=paper["published"],
    )
    result, model = chat_json(prompt, api_key=api_key, temperature=0.2)
    if result is None:
        print(f"Error processing paper {paper['id']} (no model succeeded)")
        return None
    result["Model"] = model
    return result


async def save_to_turso(papers_data):
    url = os.getenv("TURSO_DATABASE_URL")
    if url:
        url = url.replace("libsql://", "https://").replace("wss://", "https://").strip()
    auth_token = os.getenv("TURSO_AUTH_TOKEN")
    if auth_token:
        auth_token = auth_token.strip()
    if not url or not auth_token:
        print("Turso credentials missing.")
        return

    client = libsql_client.create_client(url=url, auth_token=auth_token)
    try:
        for p in papers_data:
            if not p:
                continue
            print(f"Saving {p.get('Paper_ID')} [{p.get('Model')}]")
            await client.execute(
                """
                INSERT INTO arxiv_papers (
                    Paper_ID, Title, Abstract, Published_Date, Arxiv_URL,
                    Breakthrough_Score, Core_Innovation, Benefiting_Sectors,
                    Disrupted_Sectors, Decision_Perspective, Tags, Hook
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(Paper_ID) DO UPDATE SET
                    Breakthrough_Score=excluded.Breakthrough_Score,
                    Decision_Perspective=excluded.Decision_Perspective,
                    Hook=excluded.Hook
                """,
                (
                    p.get("Paper_ID"), p.get("Title"), p.get("Abstract"),
                    p.get("Published_Date"), p.get("Arxiv_URL"),
                    p.get("Breakthrough_Score"), p.get("Core_Innovation"),
                    p.get("Benefiting_Sectors"), p.get("Disrupted_Sectors"),
                    p.get("Decision_Perspective"), p.get("Tags"), p.get("Hook")
                )
            )
    except Exception as e:
        print(f"Database error: {e}")
    finally:
        await client.close()


async def main():
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        print("Missing OPENROUTER_API_KEY")
        return

    papers = fetch_arxiv_papers()
    print(f"Fetched {len(papers)} papers.")

    analyzed_papers = []
    for paper in papers:
        res = analyze_paper_with_llm(paper, api_key)
        if res:
            res.setdefault("Title", paper["title"])
            res.setdefault("Abstract", paper["abstract"])
            res.setdefault("Published_Date", paper["published"])
            res.setdefault("Arxiv_URL", paper["link"])
            analyzed_papers.append(res)
        time.sleep(0.5)  # stay under free-tier per-minute limits

    print(f"Successfully analyzed {len(analyzed_papers)} papers.")

    if analyzed_papers:
        await save_to_turso(analyzed_papers)

if __name__ == "__main__":
    asyncio.run(main())

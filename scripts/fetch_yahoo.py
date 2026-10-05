import os
import json
import time
import asyncio
import hashlib
import requests
import feedparser
import libsql_client
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv()

from llm import chat_json

# Free, no-auth RSS feeds. Each is optional: a dead feed never breaks the run.
FEEDS = [
    ("Yahoo Finance", "https://finance.yahoo.com/news/rss", 14),
    ("MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories", 8),
    ("CNBC Top News", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", 8),
]

MAX_ITEMS = 24  # per day, across all sources


def fetch_all_news():
    news_items = []
    seen = set()

    for name, url, limit in FEEDS:
        print(f"Fetching {name}...")
        try:
            feed = feedparser.parse(url)
        except Exception as exc:
            print(f"  {name} failed: {exc}")
            continue

        taken = 0
        for entry in feed.entries:
            if taken >= limit:
                break
            link = getattr(entry, "link", "") or ""
            title = getattr(entry, "title", "") or ""
            raw_id = link or title
            if not raw_id:
                continue
            news_id = hashlib.md5(raw_id.encode()).hexdigest()
            if news_id in seen:
                continue
            seen.add(news_id)
            taken += 1
            news_items.append({
                "id": news_id,
                "title": title.replace("\n", " ").strip(),
                "snippet": (getattr(entry, "summary", "") or "")[:1200],
                "published": getattr(entry, "published", "") or getattr(entry, "updated", ""),
                "link": link,
                "source": name,
            })
        print(f"  {name}: {taken} items")

    return news_items[:MAX_ITEMS]


PROMPT = """
Analyze ONE news item for a daily sector-rotation briefing.

News_ID: {id}
Title: {title}
Snippet: {snippet}
Published: {published}
Source: {source}

Return ONLY a JSON object with exactly these keys:
{{
  "News_ID": "{id}",
  "Hook": "one sentence, max 18 words, leads with the concrete number/ticker/event, no preamble",
  "Market_Sentiment": "one of: Very Positive, Positive, Neutral, Negative, Disastrous",
  "Impact_Score": integer 1-10,
  "Related_Tickers": "comma-separated tickers named in the item, or empty string",
  "Benefiting_Entities": "comma-separated companies or sectors that gain, title case, or empty",
  "Disrupted_Entities": "comma-separated companies or sectors that lose, title case, or empty",
  "Strategic_Action": "exactly 2 sentences: what happens next and what to watch",
  "Economic_Tags": "3-5 comma-separated keywords"
}}

Impact_Score rubric: 1-3 single company with no market read-through;
4-6 sector-level; 7-8 multi-sector or major guidance/contract;
9-10 macro, index-level or regulatory shock. Never inflate a thin story.

Strategic_Action rules: state a concrete next event, trigger or metric.
Never write "investors should consider", "time will tell", or advice disclaimers.

Banned filler: "ever-evolving", "market dynamics", "in today's landscape",
"it's important to note", "furthermore", "in conclusion", "plays a crucial role".
"""


def analyze_news_with_llm(news, api_key):
    prompt = PROMPT.format(
        id=news["id"],
        title=news["title"],
        snippet=(news["snippet"] or "")[:700],
        published=news["published"],
        source=news["source"],
    )
    result, model = chat_json(prompt, api_key=api_key, temperature=0.2)
    if result is None:
        print(f"Error processing news {news['id']} (no model succeeded)")
        return None
    result["Model"] = model
    return result


async def save_to_turso(news_data):
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
        for n in news_data:
            if not n:
                continue
            print(f"Saving News {n.get('News_ID')} [{n.get('Model')}]")
            await client.execute(
                """
                INSERT INTO yahoo_finance_news (
                    News_ID, Title, Snippet, Published_Date, News_URL,
                    Related_Tickers, Market_Sentiment, Impact_Score,
                    Benefiting_Entities, Disrupted_Entities, Strategic_Action, Economic_Tags,
                    Hook
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(News_ID) DO UPDATE SET
                    Impact_Score=excluded.Impact_Score,
                    Market_Sentiment=excluded.Market_Sentiment,
                    Hook=excluded.Hook
                """,
                (
                    n.get("News_ID"), n.get("Title"), n.get("Snippet"),
                    n.get("Published_Date"), n.get("News_URL"),
                    n.get("Related_Tickers"), n.get("Market_Sentiment"),
                    n.get("Impact_Score"), n.get("Benefiting_Entities"),
                    n.get("Disrupted_Entities"), n.get("Strategic_Action"),
                    n.get("Economic_Tags"), n.get("Hook")
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

    news_items = fetch_all_news()
    print(f"Fetched {len(news_items)} news articles.")

    analyzed_news = []
    for item in news_items:
        res = analyze_news_with_llm(item, api_key)
        if res:
            # Preserve the raw feed fields for export.
            res.setdefault("Title", item["title"])
            res.setdefault("Snippet", item["snippet"])
            res.setdefault("Published_Date", item["published"])
            res.setdefault("News_URL", item["link"])
            if not res.get("Published_Date"):
                res["Published_Date"] = datetime.now(timezone.utc).isoformat()
            analyzed_news.append(res)
        time.sleep(0.5)  # stay under free-tier per-minute limits

    print(f"Successfully analyzed {len(analyzed_news)} articles.")

    if analyzed_news:
        await save_to_turso(analyzed_news)


if __name__ == "__main__":
    asyncio.run(main())

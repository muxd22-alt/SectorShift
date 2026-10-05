import os
import json
import asyncio
import libsql_client
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv()

from metrics import rollup, parse_date

# Feed payload sizes. History is computed from the full table.
NEWS_LIMIT = 300
PAPER_LIMIT = 300
SCAN_LIMIT = 4000

PAPER_COLUMNS = [
    "Paper_ID", "Title", "Abstract", "Published_Date", "Arxiv_URL",
    "Breakthrough_Score", "Core_Innovation", "Benefiting_Sectors",
    "Disrupted_Sectors", "Decision_Perspective", "Tags", "Hook",
]

NEWS_COLUMNS = [
    "News_ID", "Title", "Snippet", "Published_Date", "News_URL",
    "Related_Tickers", "Market_Sentiment", "Impact_Score",
    "Benefiting_Entities", "Disrupted_Entities", "Strategic_Action",
    "Economic_Tags", "Hook",
]


def to_dicts(result, columns):
    """Map a libsql result set to dicts, tolerating schema drift."""
    names = list(getattr(result, "columns", []) or []) or columns
    rows = []
    for row in result.rows:
        record = {name: row[i] if i < len(row) else None
                  for i, name in enumerate(names)}
        rows.append(record)
    return rows


def sort_newest(rows):
    return sorted(rows, key=lambda r: parse_date(r.get("Published_Date"))
                  or datetime(1970, 1, 1, tzinfo=timezone.utc), reverse=True)


async def fetch_all(client):
    papers_rs = await client.execute(
        f"SELECT * FROM arxiv_papers ORDER BY _rowid_ DESC LIMIT {SCAN_LIMIT}")
    news_rs = await client.execute(
        f"SELECT * FROM yahoo_finance_news ORDER BY _rowid_ DESC LIMIT {SCAN_LIMIT}")
    papers = sort_newest(to_dicts(papers_rs, PAPER_COLUMNS))
    news = sort_newest(to_dicts(news_rs, NEWS_COLUMNS))
    return papers, news


async def export():
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
        papers, news = await fetch_all(client)

        # Measurement layer: the daily net-shift series and today's stats.
        history, stats = rollup(papers, news)

        output = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "stats": stats,
            "history": history,
            "papers": papers[:PAPER_LIMIT],
            "news": news[:NEWS_LIMIT],
        }

        os.makedirs("public", exist_ok=True)
        with open("public/data.json", "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

        print(f"Exported {len(output['papers'])} papers, {len(output['news'])} news, "
              f"{len(history)} days of history -> public/data.json")
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(export())

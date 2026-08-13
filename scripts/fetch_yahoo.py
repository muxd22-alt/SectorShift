import os
import re
import json
import asyncio
import hashlib
import requests
import feedparser
import libsql_client
from dotenv import load_dotenv

load_dotenv()

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "openai/gpt-4o-mini"

def fetch_yahoo_news():
    print("Fetching Yahoo Finance News...")
    feed = feedparser.parse("https://finance.yahoo.com/news/rss")
    
    news_items = []
    for entry in feed.entries[:30]: # Grab latest 30
        raw_id = entry.link or entry.title
        news_id = hashlib.md5(raw_id.encode()).hexdigest()
        
        news_items.append({
            "id": news_id,
            "title": entry.title,
            "snippet": entry.get('summary', ''),
            "published": entry.get('published', ''),
            "link": entry.link
        })
    return news_items

def analyze_news_with_llm(news, api_key):
    prompt = f"""
    You are an expert Financial Strategy Analyst. Analyze the following market news and extract the strategic insights into a strict JSON format.
    
    News_ID: {news['id']}
    Title: {news['title']}
    Snippet: {news['snippet']}
    Published_Date: {news['published']}
    News_URL: {news['link']}
    
    Respond strictly with a JSON object that matches this schema exactly (no formatting: no markdown, no comments):
    {{
        "News_ID": "{news['id']}",
        "Title": "{news['title'].replace('\"', '\'')}",
        "Snippet": "{news['snippet'].replace('\"', '\'')[:200]}...",
        "Published_Date": "{news['published']}",
        "News_URL": "{news['link']}",
        "Related_Tickers": "(comma-separated list of stock tickers mentioned or relevant, e.g., AAPL, MSFT. Empty if none)",
        "Market_Sentiment": "(Exactly one of: Very Positive, Positive, Neutral, Negative, Disastrous)",
        "Impact_Score": (integer 1-10 assessing the economic or market impact),
        "Benefiting_Entities": "(comma-separated list of companies/sectors that benefit)",
        "Disrupted_Entities": "(comma-separated list of companies/sectors harmed)",
        "Strategic_Action": "(1-2 sentences on what an investor or business should do about this)",
        "Economic_Tags": "(comma-separated list of 3-5 relevant economic/market keywords)"
    }}
    """
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}]
    }
    
    try:
        response = requests.post(OPENROUTER_URL, headers=headers, json=payload, timeout=60)
        response.raise_for_status()
        data = response.json()
        content = data['choices'][0]['message']['content']
        content = re.sub(r'```json\s*', '', content)
        content = re.sub(r'```\s*', '', content)
        return json.loads(content)
    except Exception as e:
        print(f"Error processing news {news['id']}: {e}")
        return None

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
            if not n: continue
            print(f"Saving News {n.get('News_ID')}")
            await client.execute(
                """
                INSERT INTO yahoo_finance_news (
                    News_ID, Title, Snippet, Published_Date, News_URL, 
                    Related_Tickers, Market_Sentiment, Impact_Score, 
                    Benefiting_Entities, Disrupted_Entities, Strategic_Action, Economic_Tags
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(News_ID) DO NOTHING
                """,
                (
                    n.get("News_ID"), n.get("Title"), n.get("Snippet"),
                    n.get("Published_Date"), n.get("News_URL"),
                    n.get("Related_Tickers"), n.get("Market_Sentiment"),
                    n.get("Impact_Score"), n.get("Benefiting_Entities"),
                    n.get("Disrupted_Entities"), n.get("Strategic_Action"),
                    n.get("Economic_Tags")
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
        
    news_items = fetch_yahoo_news()
    print(f"Fetched {len(news_items)} news articles.")
    
    analyzed_news = []
    for item in news_items[:10]: # Limit to 10 per run to save credits
        res = analyze_news_with_llm(item, api_key)
        if res:
            analyzed_news.append(res)
            
    print(f"Successfully analyzed {len(analyzed_news)} articles.")
    
    if analyzed_news:
        await save_to_turso(analyzed_news)

if __name__ == "__main__":
    asyncio.run(main())

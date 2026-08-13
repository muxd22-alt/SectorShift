import os
import re
import json
import asyncio
import requests
import feedparser
import libsql_client
from dotenv import load_dotenv

load_dotenv()

ARXIV_URL = "http://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.LG+OR+cat:econ.GN&start=0&max_results=50&sortBy=submittedDate&sortOrder=descending"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "google/gemini-flash-1.5-8b" 

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
    return papers

def analyze_paper_with_llm(paper, api_key):
    prompt = f"""
    You are an expert Strategic Intelligence Analyst. Analyze the following academic paper and extract the strategic insights into a strict JSON format.
    
    Paper_ID: {paper['id']}
    Title: {paper['title']}
    Abstract: {paper['abstract']}
    Published_Date: {paper['published']}
    Arxiv_URL: {paper['link']}
    
    Respond strictly with a JSON object that matches this schema exactly (no markdown formatting, no comments, just valid JSON):
    {{
        "Paper_ID": "{paper['id']}",
        "Title": "{paper['title']}",
        "Abstract": "{paper['abstract'][:300]}...", 
        "Published_Date": "{paper['published']}",
        "Arxiv_URL": "{paper['link']}",
        "Breakthrough_Score": (integer 1-10 assessing the breakthrough potential),
        "Core_Innovation": "(1-2 sentences summarizing the core technological/scientific innovation)",
        "Benefiting_Sectors": "(comma-separated list of industries that benefit)",
        "Disrupted_Sectors": "(comma-separated list of industries potentially disrupted)",
        "Decision_Perspective": "(1-2 sentences on what a strategic decision-maker should do about this)",
        "Tags": "(comma-separated list of 3-5 relevant keywords)"
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
        print(f"Error processing paper {paper['id']}: {e}")
        return None

async def save_to_turso(papers_data):
    url = os.getenv("TURSO_DATABASE_URL")
    auth_token = os.getenv("TURSO_AUTH_TOKEN")
    if not url or not auth_token:
        print("Turso credentials missing.")
        return
        
    client = libsql_client.create_client(url=url, auth_token=auth_token)
    try:
        for p in papers_data:
            if not p: continue
            print(f"Saving {p.get('Paper_ID')}")
            await client.execute(
                """
                INSERT INTO arxiv_papers (
                    Paper_ID, Title, Abstract, Published_Date, Arxiv_URL, 
                    Breakthrough_Score, Core_Innovation, Benefiting_Sectors, 
                    Disrupted_Sectors, Decision_Perspective, Tags
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(Paper_ID) DO UPDATE SET 
                    Breakthrough_Score=excluded.Breakthrough_Score,
                    Decision_Perspective=excluded.Decision_Perspective
                """,
                (
                    p.get("Paper_ID"), p.get("Title"), p.get("Abstract"),
                    p.get("Published_Date"), p.get("Arxiv_URL"),
                    p.get("Breakthrough_Score"), p.get("Core_Innovation"),
                    p.get("Benefiting_Sectors"), p.get("Disrupted_Sectors"),
                    p.get("Decision_Perspective"), p.get("Tags")
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
    # To respect rate limits and keep it simple, process sequentially or in small batches
    for paper in papers[:10]: # Limit to 10 per run to save credits during dev
        res = analyze_paper_with_llm(paper, api_key)
        if res:
            analyzed_papers.append(res)
            
    print(f"Successfully analyzed {len(analyzed_papers)} papers.")
    
    if analyzed_papers:
        await save_to_turso(analyzed_papers)
    
if __name__ == "__main__":
    asyncio.run(main())
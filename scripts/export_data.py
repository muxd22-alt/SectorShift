import os
import json
import asyncio
import libsql_client
from dotenv import load_dotenv

load_dotenv()

async def export():
    url = os.getenv("TURSO_DATABASE_URL")
    auth_token = os.getenv("TURSO_AUTH_TOKEN")
    
    if not url or not auth_token:
        print("Turso credentials missing.")
        return

    client = libsql_client.create_client(url=url, auth_token=auth_token)
    
    try:
        papers_rs = await client.execute("SELECT * FROM arxiv_papers ORDER BY _rowid_ DESC LIMIT 50")
        papers = []
        for row in papers_rs.rows:
            papers.append({
                "Paper_ID": row[0],
                "Title": row[1],
                "Abstract": row[2],
                "Published_Date": row[3],
                "Arxiv_URL": row[4],
                "Breakthrough_Score": row[5],
                "Core_Innovation": row[6],
                "Benefiting_Sectors": row[7],
                "Disrupted_Sectors": row[8],
                "Decision_Perspective": row[9],
                "Tags": row[10]
            })
            
        news_rs = await client.execute("SELECT * FROM yahoo_finance_news ORDER BY _rowid_ DESC LIMIT 50")
        news = []
        for row in news_rs.rows:
            news.append({
                "News_ID": row[0],
                "Title": row[1],
                "Snippet": row[2],
                "Published_Date": row[3],
                "News_URL": row[4],
                "Related_Tickers": row[5],
                "Market_Sentiment": row[6],
                "Impact_Score": row[7],
                "Benefiting_Entities": row[8],
                "Disrupted_Entities": row[9],
                "Strategic_Action": row[10],
                "Economic_Tags": row[11]
            })
            
        output = {
            "papers": papers,
            "news": news
        }
        
        os.makedirs("public", exist_ok=True)
        with open("public/data.json", "w", encoding="utf-8") as f:
            json.dump(output, f, indent=4)
            
        print("Data exported successfully to public/data.json")
    finally:
        await client.close()

if __name__ == "__main__":
    asyncio.run(export())


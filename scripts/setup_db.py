import os
import asyncio
import libsql_client
from dotenv import load_dotenv

load_dotenv()

async def setup():
    url = os.getenv("TURSO_DATABASE_URL")
    if url:
        url = url.replace("libsql://", "https://").replace("wss://", "https://")
    auth_token = os.getenv("TURSO_AUTH_TOKEN")
    
    if not url or not auth_token:
        print("Missing Turso credentials in environment. Please set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.")
        return

    client = libsql_client.create_client(url=url, auth_token=auth_token)

    try:
        print("Creating arxiv_papers table...")
        await client.execute("""
            CREATE TABLE IF NOT EXISTS arxiv_papers (
                Paper_ID TEXT PRIMARY KEY,
                Title TEXT,
                Abstract TEXT,
                Published_Date TEXT,
                Arxiv_URL TEXT,
                Breakthrough_Score INTEGER,
                Core_Innovation TEXT,
                Benefiting_Sectors TEXT,
                Disrupted_Sectors TEXT,
                Decision_Perspective TEXT,
                Tags TEXT
            )
        """)
        
        print("Creating yahoo_finance_news table...")
        await client.execute("""
            CREATE TABLE IF NOT EXISTS yahoo_finance_news (
                News_ID TEXT PRIMARY KEY,
                Title TEXT,
                Snippet TEXT,
                Published_Date TEXT,
                News_URL TEXT,
                Related_Tickers TEXT,
                Market_Sentiment TEXT,
                Impact_Score INTEGER,
                Benefiting_Entities TEXT,
                Disrupted_Entities TEXT,
                Strategic_Action TEXT,
                Economic_Tags TEXT
            )
        """)
        
        print("Database schema successfully set up!")
        
    except Exception as e:
        print(f"Error executing schema setup: {e}")
    finally:
        await client.close()

if __name__ == "__main__":
    asyncio.run(setup())
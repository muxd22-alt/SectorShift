"""Build the daily briefing that opens the dashboard.

Reads public/data.json (produced by export_data.py), asks a free OpenRouter
model to turn today's tape into a short editorial read, and writes it back as
data["digest"]. If the model is unavailable the briefing is assembled
deterministically from the highest-scored items, so the dashboard always opens
with something readable.
"""

import os
import json
import sys

from dotenv import load_dotenv

load_dotenv()

from llm import chat_json
from metrics import parse_date, day_key

DATA_PATH = os.path.join("public", "data.json")

PROMPT = """
You write the opening briefing of "Sector Shift", a daily 15-minute read that
answers one question: which sectors are gaining and which are losing today.

Date (UTC): {date}
{quiet_note}
Items (type | score | tone | hook - title | id):
{items}

Return ONLY a JSON object:
{{
  "date": "{date}",
  "headline": "<= 12 words, specific, names a sector or ticker if one dominates",
  "bullets": ["3 to 5 bullets, each <= 28 words, cause -> effect, keep any number or ticker from the item"],
  "movers": [{{"name": "<sector or company>", "dir": "up" or "down", "why": "<= 18 words"}}],
  "watch": "<= 28 words: the single next event or metric worth tracking",
  "items": ["id", "id"]
}}

Rules: movers must be 2 or 3 entries taken from the items. No filler
("markets remain cautious", "sentiment is mixed" without a reason). No
investment-advice disclaimers. Do not repeat the headline inside the bullets.
If the tape is thin, say what is actually quiet instead of inventing heat.
"""


def load_data():
    if not os.path.exists(DATA_PATH):
        print("public/data.json not found - run export_data.py first.")
        sys.exit(0)
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_data(data):
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def item_line(item, kind, date):
    if kind == "news":
        score = item.get("Impact_Score") or 0
        tone = item.get("Market_Sentiment") or "Neutral"
        hook = item.get("Hook") or item.get("Title") or ""
        title = item.get("Title") or ""
        ident = item.get("News_ID")
        label = "news"
    else:
        score = item.get("Breakthrough_Score") or 0
        tone = "research"
        hook = item.get("Hook") or item.get("Title") or ""
        title = item.get("Title") or ""
        ident = item.get("Paper_ID")
        label = "paper"
    hook = hook.strip()
    title = title.strip()
    same = hook.lower().rstrip(".") == title.lower().rstrip(".")
    tail = hook if same or not title else f"{hook} - {title}"
    return f"[{label}|{score}|{tone}] {tail[:220]} | {ident}"


def pick_items(data, date):
    """Today's items first; fall back to the latest tape if today is empty."""
    buckets = {"news": [], "papers": []}
    for item in data.get("news", []):
        dt = parse_date(item.get("Published_Date"))
        buckets["news"].append((dt, item, "news"))
    for item in data.get("papers", []):
        dt = parse_date(item.get("Published_Date"))
        buckets["papers"].append((dt, item, "paper"))

    dated = [x for x in buckets["news"] + buckets["papers"] if x[0]]
    dated.sort(key=lambda x: x[0], reverse=True)

    today = [x for x in dated if day_key(x[0]) == date]
    if len(today) >= 5:
        return today[:14], False
    return dated[:14], True


def fallback_digest(data, date, used_items):
    """Deterministic briefing built from the strongest items on the tape."""
    ranked = []
    for dt, item, kind in used_items:
        score = item.get("Impact_Score") if kind == "news" else item.get("Breakthrough_Score")
        ranked.append((int(score or 0), item, kind))
    ranked.sort(key=lambda x: x[0], reverse=True)

    stats = data.get("stats", {})
    net = stats.get("net_today", 0)
    top_gain = stats.get("top_gain") or {}
    top_fall = stats.get("top_fall") or {}

    hooks = []
    ids = []
    for _, item, _ in ranked[:5]:
        text = (item.get("Hook") or item.get("Title") or "").strip()
        if text:
            hooks.append(text.rstrip("."))
        ids.append(item.get("News_ID") or item.get("Paper_ID"))

    if not hooks:
        headline = "Quiet tape - nothing new cleared the bar today."
        bullets = ["No fresh items landed in the last day. The last read stands."]
    else:
        headline = hooks[0] if len(hooks[0].split()) <= 12 else " ".join(hooks[0].split()[:12])
        bullets = hooks[1:5] or hooks[:1]

    movers = []
    if top_gain.get("name"):
        movers.append({"name": top_gain["name"], "dir": "up",
                       "why": f"Net +{top_gain.get('net')} mentions over 7 days"})
    if top_fall.get("name"):
        movers.append({"name": top_fall["name"], "dir": "down",
                       "why": f"Net {top_fall.get('net')} mentions over 7 days"})

    watch_bits = [f"net shift {net:+d} today against {stats.get('net_7d_avg', 0)} on the 7-day average"]
    if top_gain.get("name"):
        watch_bits.append(f"{top_gain['name']} still taking mentions")
    if top_fall.get("name"):
        watch_bits.append(f"{top_fall['name']} still shedding them")
    watch = "; ".join(watch_bits) + "."

    return {
        "date": date,
        "headline": headline,
        "bullets": bullets,
        "movers": movers,
        "watch": watch,
        "items": [i for i in ids if i],
        "model": "deterministic",
    }


def valid(digest):
    if not isinstance(digest, dict):
        return False
    if not isinstance(digest.get("headline"), str) or not digest["headline"].strip():
        return False
    bullets = digest.get("bullets")
    if not isinstance(bullets, list):
        return False
    digest["bullets"] = [str(b).strip() for b in bullets if str(b).strip()][:5]
    if not digest["bullets"]:
        return False
    movers = digest.get("movers")
    digest["movers"] = [m for m in movers if isinstance(m, dict) and m.get("name")][:3] \
        if isinstance(movers, list) else []
    digest["watch"] = str(digest.get("watch") or "").strip()
    digest["items"] = [str(i) for i in digest.get("items", [])][:6] \
        if isinstance(digest.get("items"), list) else []
    return True


def main():
    data = load_data()
    date = (data.get("stats") or {}).get("date")
    if not date:
        from datetime import datetime, timezone
        date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    used, quiet = pick_items(data, date)
    if not used:
        print("No items to brief.")
        return

    lines = [item_line(item, kind, date) for _, item, kind in used]
    prompt = PROMPT.format(
        date=date,
        quiet_note="NOTE: the tape is thin, keep the briefing short and honest.\n"
                   if quiet else "",
        items="\n".join(f"{i + 1}. {line}" for i, line in enumerate(lines)),
    )

    digest, model = chat_json(prompt, temperature=0.5)
    if digest and valid(digest):
        digest["date"] = date
        digest["model"] = model
    else:
        print("Model briefing unavailable - using deterministic digest.")
        digest = fallback_digest(data, date, used)

    data["digest"] = digest
    save_data(data)
    print(f"Digest written for {date} via {digest.get('model')}: "
          f"{digest['headline'][:80]}")


if __name__ == "__main__":
    main()

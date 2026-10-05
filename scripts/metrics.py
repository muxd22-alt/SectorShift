"""Pure measurement functions for SectorShift.

The whole product answers one question every day: which sectors are gaining
and which are losing mindshare today? These functions turn raw rows into the
daily series the dashboard plots.

Nothing here talks to the network or the database, so it can be unit-tested
or re-run offline against an existing data.json.
"""

import re
from datetime import datetime, timedelta, timezone

HISTORY_DAYS = 90

BULL_WORDS = ("very positive", "positive")
BEAR_WORDS = ("negative", "disastrous")

# Mirrors public/app.js - companies/tickers vs sectors.
GENERIC_SECTORS = (
    "healthcare|technology|tech|finance|financials|energy|retail|automotive|"
    "aerospace|agriculture|construction|education|entertainment|hospitality|"
    "manufacturing|media|telecommunications|transportation|utilities|"
    "semiconductors|software|hardware|logistics|materials|industrials|services|"
    "banking|biotech|insurance|reits|consumer|communications|cyclical|"
    "defensive|utilities|pharma|metals|mining|real estate|commodities|currencies|"
    "crypto|blockchain|defense|cybersecurity|cloud|ai|semiconductor|"
    "artificial intelligence|robotics|quantum|space|gaming|autos"
)


def parse_date(value):
    """Parse ISO-8601 or RFC-822 timestamps to an aware UTC datetime."""
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip()
        dt = None
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            pass
        if dt is None:
            from email.utils import parsedate_to_datetime
            try:
                dt = parsedate_to_datetime(text)
            except (TypeError, ValueError):
                return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def day_key(dt):
    return dt.strftime("%Y-%m-%d")


def split_list(value):
    """Split a comma list; drop bare corporate-suffix tokens like 'Inc.'."""
    if not value:
        return []
    text = re.sub(r",\s*(Inc\.|Inc|LLC|Ltd\.|Ltd|Corp\.|Corp|Co\.|Co)\b",
                  r" \1", str(value))
    parts = [part.strip() for part in text.split(",") if part.strip()]
    suffix = re.compile(r"^(inc\.?|ltd\.?|corp\.?|llc|plc|co\.?|&)$", re.IGNORECASE)
    cleaned = [p for p in parts if not suffix.match(p)]
    return cleaned or parts


def is_generic_none(name):
    return not name or bool(re.match(r"^(none|n/?a|na|not applicable|-|unknown)$",
                                     name.strip(), re.IGNORECASE))


def is_company(name):
    """True when an entity looks like a company/ticker rather than a sector."""
    n = (name or "").strip()
    if not n or is_generic_none(n):
        return False
    if n.startswith("$"):
        return True
    if re.match(r"^[A-Z][A-Z0-9\.\-]{1,5}$", n):
        return True
    if re.search(r"\b(Inc|Ltd|Corp|LLC|PLC|Group|Holdings|Therapeutics|Pharma|"
                 r"Biosciences|Labs|Networks|Systems|Solutions|Technologies)\b",
                 n, re.IGNORECASE):
        return True
    return False


def sentiment_bucket(label):
    if not label:
        return "neutral"
    low = str(label).lower()
    if any(word in low for word in BEAR_WORDS):
        return "bear"
    if any(word in low for word in BULL_WORDS):
        return "bull"
    return "neutral"


def _item_stats(item, kind):
    dt = parse_date(item.get("Published_Date"))
    if dt is None:
        return None
    if kind == "news":
        score = item.get("Impact_Score") or 0
        sentiment = sentiment_bucket(item.get("Market_Sentiment"))
        benefiting = split_list(item.get("Benefiting_Entities"))
        disrupted = split_list(item.get("Disrupted_Entities"))
    else:
        score = item.get("Breakthrough_Score") or 0
        sentiment = None
        benefiting = split_list(item.get("Benefiting_Sectors"))
        disrupted = split_list(item.get("Disrupted_Sectors"))
    return {
        "dt": dt,
        "score": int(score or 0),
        "sentiment": sentiment,
        "ben": [e for e in benefiting if not is_generic_none(e)],
        "dis": [e for e in disrupted if not is_generic_none(e)],
    }


def _entity_nets(items, days):
    """Net mentions (benefit - disrupted) per entity over the last N days."""
    cutoff = datetime.now(timezone.utc).date() - timedelta(days=days - 1)
    nets = {}
    for item in items:
        stats = item["_stats"]
        if stats["dt"].date() < cutoff:
            continue
        for name in stats["ben"]:
            nets[name] = nets.get(name, 0) + 1
        for name in stats["dis"]:
            nets[name] = nets.get(name, 0) - 1
    return nets


def rollup(papers, news, days=HISTORY_DAYS):
    """Build the daily net-shift series plus today's headline stats.

    history: [{date, ben, dis, net, items, bull, bear}] ascending, zero-filled
             so weekends and quiet days show up honestly as flat.
    stats:   today's numbers, the 7-day baseline and the current streak.
    """
    paper_items = []
    for row in papers or []:
        stats = _item_stats(row, "paper")
        if stats:
            paper_items.append({"_stats": stats})

    news_items = []
    for row in news or []:
        stats = _item_stats(row, "news")
        if stats:
            news_items.append({"_stats": stats})

    all_items = paper_items + news_items
    if not all_items:
        return [], _empty_stats()

    by_day = {}
    for entry in all_items:
        key = day_key(entry["_stats"]["dt"])
        bucket = by_day.setdefault(key, {
            "date": key, "ben": 0, "dis": 0, "net": 0,
            "items": 0, "bull": 0, "bear": 0, "neutral": 0,
        })
        stats = entry["_stats"]
        bucket["ben"] += len(stats["ben"])
        bucket["dis"] += len(stats["dis"])
        bucket["items"] += 1
        if stats["sentiment"] == "bull":
            bucket["bull"] += 1
        elif stats["sentiment"] == "bear":
            bucket["bear"] += 1
        elif stats["sentiment"] == "neutral":
            bucket["neutral"] += 1

    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days - 1)
    history = []
    day = start
    while day <= today:
        key = day_key(datetime(day.year, day.month, day.day, tzinfo=timezone.utc))
        bucket = by_day.get(key, {
            "date": key, "ben": 0, "dis": 0, "net": 0,
            "items": 0, "bull": 0, "bear": 0, "neutral": 0,
        })
        bucket["net"] = bucket["ben"] - bucket["dis"]
        history.append(bucket)
        day += timedelta(days=1)

    def net_of(offset):
        idx = len(history) - 1 - offset
        return history[idx]["net"] if idx >= 0 else 0

    net_today = net_of(0)
    net_yesterday = net_of(1)
    last_seven = [h["net"] for h in history[-7:]]
    net_7d_avg = round(sum(last_seven) / len(last_seven), 1)

    streak = 0
    for h in reversed(history):
        if h["net"] > 0:
            streak += 1
        else:
            break

    today_bucket = history[-1]
    news_today = [n for n in news_items if day_key(n["_stats"]["dt"]) == day_key(datetime(today.year, today.month, today.day, tzinfo=timezone.utc))]
    bull = sum(1 for n in news_today if n["_stats"]["sentiment"] == "bull")
    bear = sum(1 for n in news_today if n["_stats"]["sentiment"] == "bear")
    tone_total = bull + bear
    bull_pct = round(bull / tone_total * 100) if tone_total else None
    bear_pct = round(bear / tone_total * 100) if tone_total else None

    def top_entity(days_window, sign):
        nets = _entity_nets(all_items, days_window)
        candidates = [(name, net) for name, net in nets.items()
                      if net * sign > 0 and not is_company(name)]
        if not candidates:
            candidates = [(name, net) for name, net in nets.items() if net * sign > 0]
        if not candidates:
            return None
        candidates.sort(key=lambda pair: pair[1] * sign, reverse=True)
        name, net = candidates[0]
        return {"name": name, "net": net}

    stats = {
        "date": day_key(datetime(today.year, today.month, today.day, tzinfo=timezone.utc)),
        "items_today": today_bucket["items"],
        "net_today": net_today,
        "net_yesterday": net_yesterday,
        "net_7d_avg": net_7d_avg,
        "streak": streak,
        "bull_pct": bull_pct,
        "bear_pct": bear_pct,
        "items_7d": sum(h["items"] for h in history[-7:]),
        "top_gain": top_entity(7, 1),
        "top_fall": top_entity(7, -1),
        "history_days": len([h for h in history if h["items"] > 0]),
    }
    return history, stats


def _empty_stats():
    today = datetime.now(timezone.utc).date()
    return {
        "date": day_key(datetime(today.year, today.month, today.day, tzinfo=timezone.utc)),
        "items_today": 0, "net_today": 0, "net_yesterday": 0,
        "net_7d_avg": 0, "streak": 0, "bull_pct": None, "bear_pct": None,
        "items_7d": 0, "top_gain": None, "top_fall": None, "history_days": 0,
    }

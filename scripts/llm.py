"""Shared OpenRouter helper for SectorShift.

Uses ONLY free models ($0 spend). Falls through the model chain when a model
is rate-limited, out of credit, slow, or returns malformed JSON, so the daily
GitHub Actions job keeps running unattended.

Override the chain with OPENROUTER_MODELS (comma-separated model ids).
"""

import os
import re
import json
import time
import requests

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# Ordered by analysis quality. Every entry is a free-tier model.
FREE_MODELS = [
    "nvidia/nemotron-3-super-120b-a12b:free",
    "google/gemma-4-31b-it:free",
    "thinkingmachines/inkling:free",
    "nvidia/nemotron-3.5-lightning:free",
]

# Safe to retry after a short wait (free-tier rate limits are the norm).
RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}

SYSTEM_PROMPT = (
    "You are a precise financial strategy analyst working for a daily market "
    "briefing. You are skeptical, specific and allergic to filler. "
    "Respond with ONE valid JSON object and nothing else: no markdown fences, "
    "no commentary, no trailing text."
)


def model_chain():
    env = os.getenv("OPENROUTER_MODELS")
    if env:
        return [m.strip() for m in env.split(",") if m.strip()]
    return list(FREE_MODELS)


def _strip_fences(text):
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def extract_json(text):
    """Pull the first parseable JSON object out of an LLM response."""
    if not text:
        return None
    cleaned = _strip_fences(text)
    try:
        obj = json.loads(cleaned)
        if isinstance(obj, dict):
            return obj
    except ValueError:
        pass

    decoder = json.JSONDecoder()
    idx = cleaned.find("{")
    while idx != -1:
        try:
            obj, _ = decoder.raw_decode(cleaned[idx:])
            if isinstance(obj, dict):
                return obj
        except ValueError:
            pass
        idx = cleaned.find("{", idx + 1)
    return None


def _post(model, api_key, prompt, temperature, timeout):
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "X-Title": "SectorShift",
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "temperature": temperature,
    }
    return requests.post(OPENROUTER_URL, headers=headers, json=payload, timeout=timeout)


def chat_json(prompt, api_key=None, temperature=0.3, tries_per_model=2, timeout=90):
    """Return (parsed_dict, model_id) or (None, None)."""
    api_key = api_key or os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        print("Missing OPENROUTER_API_KEY - skipping LLM step.")
        return None, None

    for model in model_chain():
        for attempt in range(tries_per_model):
            try:
                response = _post(model, api_key, prompt, temperature, timeout)

                if response.status_code in RETRYABLE_STATUS:
                    wait = 3 * (attempt + 1)
                    print(f"{model}: HTTP {response.status_code}, retrying in {wait}s")
                    time.sleep(wait)
                    continue

                if response.status_code == 402:
                    print(f"{model}: out of free credit, trying next model")
                    break

                response.raise_for_status()
                data = response.json()
                content = data["choices"][0]["message"].get("content", "")
                parsed = extract_json(content)
                if parsed is None:
                    print(f"{model}: response was not JSON (attempt {attempt + 1})")
                    continue
                return parsed, model

            except requests.Timeout:
                print(f"{model}: timeout (attempt {attempt + 1})")
            except requests.RequestException as exc:
                print(f"{model}: request failed: {exc}")
            except (KeyError, IndexError, ValueError) as exc:
                print(f"{model}: bad response payload: {exc}")
            time.sleep(2)

    print("All free models failed for this item.")
    return None, None

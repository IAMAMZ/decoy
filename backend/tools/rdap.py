"""Domain registration lookup over RDAP (the official successor to WHOIS). Blocking: run in a thread."""

import json
import urllib.error
import urllib.request
from datetime import datetime, timezone


def lookup(domain: str) -> dict:
    """{"domain", "registered", "registered_on"?, "age_days"?, "registrar"?}. Raises on network errors."""
    try:
        with urllib.request.urlopen(f"https://rdap.org/domain/{domain}", timeout=15) as r:
            d = json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {"domain": domain, "registered": False}
        raise
    events = {e["eventAction"]: e["eventDate"] for e in d.get("events", [])}
    out: dict = {"domain": domain, "registered": True}
    if reg := events.get("registration"):
        when = datetime.fromisoformat(reg.replace("Z", "+00:00"))
        out["registered_on"] = when.date().isoformat()
        out["age_days"] = (datetime.now(timezone.utc) - when).days
    for ent in d.get("entities", []):
        if "registrar" in ent.get("roles", []):
            for field in ent.get("vcardArray", [None, []])[1]:
                if field[0] == "fn":
                    out["registrar"] = field[3]
    return out

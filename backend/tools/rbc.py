"""The three checks for the RBC impersonation demo, run on the real browser so the screen shows them.

Pages and wording were checked on Oct 24, 2026. If RBC changes a page, update the constants here.
Every tool takes (args, rid) and returns {"ok", "verdict", "summary", ...}; `rid` ties its run on
Decoy's screen to the dashboard's tool_call id.
"""

import asyncio
import re

import browser

from . import rdap

# RBC's fraud page lists the official number (1-800-769-2511) and the "will never ask" rule for calls.
SAFETY_URL = "https://www.rbc.com/cyber-security/how-rbc-keeps-you-safe/index.html"
# RBC's bank impersonation article, with the list "RBC will never ask you to: ...".
IMPERSONATION_URL = (
    "https://www.rbcdirectinvesting.com/learn/en/di/hubs/investing-academy/article/bank-impersonation-scams/mrqeu105"
)
OFFICIAL_DOMAINS = ("rbcroyalbank.com", "rbc.com", "rbcdirectinvesting.com")
NEW_DOMAIN_DAYS = 90

PHONE_PATTERN = r"1[-\s.]?8[0-9]{2}[-\s.]?[0-9]{3}[-\s.]?[0-9]{4}"

# What the caller asked for -> the RBC page and sentence that rules it out. First match wins.
POLICIES = [
    (
        r"e-?transfer|transfer|safe account|move (the |your )?money|send (the |your )?money|wire",
        IMPERSONATION_URL,
        "Send an e-Transfer to your financial institution or yourself for any reason",
    ),
    (r"one-?time|code|passcode|otp", IMPERSONATION_URL, "Provide a one-time code sent by text, email or voicemail"),
    (r"remote|anydesk|teamviewer|download", IMPERSONATION_URL, "Download a remote-access application"),
    (r"\bpin\b", IMPERSONATION_URL, "Disclose your PIN"),
    (r"password", IMPERSONATION_URL, "share your password with anyone"),
    (
        r"verify|confirm|account (info|information|number|details)|log ?in|sign in|personal information",
        SAFETY_URL,
        "RBC will never ask you to provide, confirm or verify personal, login or account information",
    ),
]


def _digits(number: str) -> str:
    return re.sub(r"\D", "", number)[-10:]  # compare without the country code


def _literal(text: str) -> str:
    """A JS-safe regex that matches `text` literally."""
    return re.sub(r"([.*+?^${}()|\[\]\\/])", r"\\\1", text)


def _domain(url: str) -> str:
    host = re.sub(r"^[a-z]+://", "", url.strip().lower()).split("/")[0].split(":")[0]
    return host.removeprefix("www.")


async def verify_caller_number(args: dict, rid: str) -> dict:
    caller = str(args["number"])
    async with browser.session(rid):
        browser.say("Looking up RBC's official phone number on rbc.com")
        loaded = await browser.navigate(SAFETY_URL)
        hit = await browser.find(PHONE_PATTERN) if loaded else None
    if not hit:
        result = {"ok": False, "summary": "Couldn't find RBC's official number on rbc.com", "source": SAFETY_URL}
    else:
        official = hit["text"]
        match = _digits(caller) == _digits(official)
        result = {
            "ok": True,
            "verdict": "match" if match else "mismatch",
            "summary": (
                f"{caller} is RBC's official number"
                if match
                else f"{caller} is not RBC's official number ({official})"
            ),
            "caller": caller,
            "official": official,
            "excerpt": hit["context"],
            "source": SAFETY_URL,
        }
    browser.finish(rid, result)
    return result


async def check_bank_policy(args: dict, rid: str) -> dict:
    claim = str(args["claim"])
    policy = next(((url, rule) for pat, url, rule in POLICIES if re.search(pat, claim, re.I)), None)
    if not policy:
        result = {"ok": True, "verdict": "no_policy_found", "summary": f"No RBC rule found about: {claim}"}
        browser.finish(rid, result)
        return result
    url, rule = policy
    async with browser.session(rid):
        browser.say("Checking what RBC says it will never ask for")
        loaded = await browser.navigate(url)
        hit = await browser.find(_literal(rule)) if loaded else None
    if not hit:
        result = {"ok": False, "summary": "Couldn't load RBC's fraud guidance", "source": url}
    else:
        quote = hit["text"]
        result = {
            "ok": True,
            "verdict": "against_rbc_policy",
            "summary": quote if quote.lower().startswith("rbc will never") else f"RBC will never ask you to: {quote}",
            "claim": claim,
            "quote": quote,
            "excerpt": hit["context"],
            "source": url,
        }
    browser.finish(rid, result)
    return result


async def check_link(args: dict, rid: str) -> dict:
    domain = _domain(str(args["url"]))
    if not domain:
        result = {"ok": False, "summary": "No domain in that link"}
        browser.finish(rid, result)
        return result
    official = any(domain == d or domain.endswith("." + d) for d in OFFICIAL_DOMAINS)
    async with browser.session(rid):
        browser.say(f"Checking who registered {domain}")
        try:
            info = await asyncio.to_thread(rdap.lookup, domain)
            browser.broadcast({"type": "card", "kind": "whois", "data": info})
        except Exception:
            info = {"domain": domain, "registered": None}  # registry unreachable: judge by the name alone
        await asyncio.sleep(1.5)
        browser.say(f"Trying to open {domain}")
        reachable = await browser.navigate(f"https://{domain}")
        await asyncio.sleep(1)

    if official:
        verdict, summary = "official", f"{domain} is an official RBC website"
    elif info["registered"] is False:
        verdict, summary = "not_registered", f"{domain} isn't registered: the link the caller gave doesn't exist"
    elif info.get("age_days") is not None and info["age_days"] < NEW_DOMAIN_DAYS:
        verdict, summary = "new_domain", f"{domain} was registered {info['age_days']} days ago and isn't RBC's"
    elif "rbc" in domain:
        verdict, summary = "lookalike", f"{domain} looks like RBC but isn't (RBC uses rbcroyalbank.com)"
    else:
        verdict, summary = "not_rbc", f"{domain} isn't an RBC website"
    result = {
        "ok": True,
        "verdict": verdict,
        "summary": summary,
        "domain": domain,
        "official": official,
        "reachable": reachable,
        **{k: v for k, v in info.items() if k != "domain"},
    }
    browser.finish(rid, result)
    return result

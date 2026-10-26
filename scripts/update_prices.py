"""Update prices.json with the UAE monthly fuel prices.

Runs on GitHub Actions near the start of each month. The UAE Fuel Price Committee
announces prices at the end of each month; they take effect on the 1st. This script
reads the news report for the coming month and extracts the per-litre prices.

Exit codes: 0 = updated or nothing to do yet, 1 = the article was found but could not be read
(GitHub then emails the repo owner so the price can be updated by hand).
"""
import datetime as dt
import html
import json
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
PRICES = ROOT / "web" / "prices.json"
GRADES = {
    "Super 98": [r"super\s*98"],
    "Special 95": [r"special\s*95"],
    "E-Plus 91": [r"e-?\s*plus\s*91"],
    "Diesel": [r"diesel"],
}
MONTHS = ["january", "february", "march", "april", "may", "june", "july",
          "august", "september", "october", "november", "december"]


def target_month(today):
    """Prices for next month are announced from about the 28th."""
    if today.day >= 25:
        first = (today.replace(day=1) + dt.timedelta(days=32)).replace(day=1)
    else:
        first = today.replace(day=1)
    return first


def candidate_urls(first):
    m, y = MONTHS[first.month - 1], first.year
    return [
        f"https://www.khaleejtimes.com/uae/petrol-diesel-prices-{m}-{y}-announced",
        f"https://www.khaleejtimes.com/uae/uae-petrol-diesel-prices-for-{m}-{y}-announced",
        f"https://www.khaleejtimes.com/uae/uae-fuel-prices-for-{m}-{y}-announced",
    ]


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (fold-drive fuel price updater)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def text_of(page):
    page = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", page)
    page = re.sub(r"(?s)<[^>]+>", " ", page)
    return re.sub(r"\s+", " ", html.unescape(page))


def parse(text):
    """Find 'Super 98 ... will cost Dh4.40' style sentences for each grade."""
    found = {}
    for grade, pats in GRADES.items():
        for pat in pats:
            for m in re.finditer(pat, text, re.I):
                window = text[m.end(): m.end() + 220]
                hit = re.search(r"(?:will cost|costs?|priced at|charged at|sold at|now at|be at)\s*(?:Dh|AED|Dhs)\.?\s?(\d\.\d{2})", window, re.I)
                if hit:
                    val = float(hit.group(1))
                    if 1.5 < val < 8:
                        found[grade] = val
                        break
            if grade in found:
                break
    return found


def main():
    today = dt.date.today()
    first = target_month(today)
    label = f"{MONTHS[first.month - 1].capitalize()} {first.year}"
    current = json.loads(PRICES.read_text())
    if current.get("updated") == first.isoformat():
        print(f"Already have prices for {label}.")
        return 0

    article_found = False
    for url in candidate_urls(first):
        try:
            page = fetch(url)
        except Exception as e:  # 404 before the announcement, or a network problem
            print(f"Not available yet: {url} ({e})")
            continue
        article_found = True
        prices = parse(text_of(page))
        petrol = [g for g in ("Super 98", "Special 95", "E-Plus 91") if g in prices]
        if len(petrol) == 3:
            new = {
                "updated": first.isoformat(),
                "month": label,
                "source": url,
                "grades": {g: prices.get(g, current["grades"].get(g)) for g in GRADES},
                "previous": current.get("grades", {}),
            }
            PRICES.write_text(json.dumps(new, indent=2) + "\n")
            print(f"Updated prices for {label}: {new['grades']}")
            return 0
        print(f"Could not read all petrol prices from {url}: {prices}")

    if article_found:
        print("The announcement was found but could not be read. Update prices.json by hand.")
        return 1
    if today.day <= 3 and today.day >= 2:
        print(f"No announcement for {label} found by day {today.day}. Update prices.json by hand.")
        return 1
    print(f"No announcement for {label} yet. Will try again later.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

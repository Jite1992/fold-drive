"""Update web/prices.json with the UAE monthly fuel prices.

The UAE Fuel Price Committee announces prices at the end of each month; they apply from the 1st.
News sites publish them under different, unpredictable web addresses, so this script:

  1. finds candidate articles: a news search (Bing News RSS) plus address patterns
     several UAE sites use every month,
  2. reads each article and extracts the four prices, accepting only pages that mention the
     target month and year (so an old, stale page can't be used),
  3. saves the prices only when at least two independent sites agree (or one site, if it is
     the only one found by the last retry day and the prices are close to last month's).

Exit codes: 0 = updated, already up to date, or not published yet; 1 = still not found after
the last retry day (GitHub then emails the repo owner so the price can be updated by hand).
"""
import datetime as dt
import html
import json
import pathlib
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
PRICES = ROOT / "web" / "prices.json"
GRADES = {
    "Super 98": r"super\s*98",
    "Special 95": r"special\s*95",
    "E-Plus 91": r"e[\s-]*plus(?:\s*91)?",
    "Diesel": r"diesel",
}
MONTHS = ["january", "february", "march", "april", "may", "june", "july",
          "august", "september", "october", "november", "december"]
LAST_RETRY_DAY = 5
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
PRICE = r"(?:AED|Dhs?|Dh)\.?\s?(\d{1,2}(?:\.\d{1,2})?)"


def target_month(today):
    """From the 25th, look for next month's prices; otherwise this month's."""
    if today.day >= 25:
        return (today.replace(day=1) + dt.timedelta(days=32)).replace(day=1)
    return today.replace(day=1)


def fetch(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def text_of(page):
    page = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", page)
    page = re.sub(r"(?s)<[^>]+>", " ", page)
    return re.sub(r"\s+", " ", html.unescape(page))


def candidates(first):
    m, y = MONTHS[first.month - 1], first.year
    urls = [
        f"https://www.khaleejtimes.com/uae/petrol-diesel-prices-{m}-{y}-announced",
        f"https://www.khaleejtimes.com/business/energy/uae-petrol-diesel-prices-{m}-{y}",
        f"https://www.khaleejtimes.com/uae/petrol-prices-{m}-{y}",
        f"https://www.arabianbusiness.com/business/retail/uae-petrol-prices-{m}-{y}",
        f"https://www.timeoutdubai.com/news/uae-petrol-prices-{m}-{y}-revealed",
        f"https://www.timeoutabudhabi.com/news/uae-petrol-prices-{m}-{y}",
        f"https://gulfbusiness.com/en/{y}/energy/uae-announces-fuel-prices-for-{m}-{y}/",
        f"https://blog.oneclickdrive.com/uae-petrol-price-{m}-{y}/",
        f"https://www.brothersgas.com/uae-fuel-prices-{m}-{y}/",
        f"https://www.dubicars.com/news/{m}-{y}-petrol-price-drop-announced.html",
        f"https://www.dubicars.com/news/{m}-{y}-petrol-price-hike-announced.html",
    ]
    # news search for anything else published about it
    for q in (f"UAE fuel prices {m} {y}", f"UAE petrol prices {m} {y} Super 98"):
        try:
            rss = fetch("https://www.bing.com/news/search?format=rss&q=" + urllib.parse.quote(q))
            for item in ET.fromstring(rss).iter("item"):
                link = (item.findtext("link") or "").strip()
                if "bing.com" in link and "url=" in link:
                    link = urllib.parse.parse_qs(urllib.parse.urlparse(link).query).get("url", [link])[0]
                if link.startswith("http") and link not in urls:
                    urls.append(link)
        except Exception as e:
            print(f"News search failed for '{q}': {e}")
    return urls


def parse(text):
    """Read the new price that follows each fuel name. Handles the usual phrasings:
    'Super 98 will cost AED 4.16 per litre, down from 4.40',
    'Special 95 ... AED4.04 ($1.10) per litre',
    'Special 95 will go up from AED 2.92 to AED 3.20'."""
    found = {}
    for grade, pat in GRADES.items():
        votes = []
        for m in re.finditer(pat, text, re.I):
            window = text[m.end(): m.end() + 200]
            # stop at the next fuel name so one grade doesn't read another's price
            nxt = re.search("|".join(p for g, p in GRADES.items() if g != grade), window, re.I)
            if nxt:
                window = window[: nxt.start()]
            ft = re.search(r"from\s*" + PRICE + r"[^.;]{0,30}?\bto\s*" + PRICE, window, re.I)
            if ft:
                votes.append(float(ft.group(2)))
                continue
            p = re.search(PRICE, window, re.I)
            if p:
                votes.append(float(p.group(1)))
        votes = [v for v in votes if 1.5 < v < 8]
        if votes:
            found[grade] = max(set(votes), key=votes.count)  # most common reading on the page
    return found


def mentions_month(text, first):
    m, y = MONTHS[first.month - 1], str(first.year)
    return re.search(m, text, re.I) and y in text


def main():
    today = dt.date.today()
    first = target_month(today)
    label = f"{MONTHS[first.month - 1].capitalize()} {first.year}"
    current = json.loads(PRICES.read_text())
    if current.get("updated") == first.isoformat():
        print(f"Already have prices for {label}.")
        return 0

    readings = []  # (url, prices)
    for url in candidates(first):
        try:
            text = text_of(fetch(url))
        except Exception as e:
            print(f"Skip {url}: {e}")
            continue
        if not mentions_month(text, first):
            print(f"Skip {url}: does not mention {label}")
            continue
        prices = parse(text)
        petrol = [g for g in ("Super 98", "Special 95", "E-Plus 91") if g in prices]
        print(f"Read {url}: {prices}")
        if len(petrol) == 3:
            readings.append((url, prices))

    def agree(a, b):
        return all(abs(a[g] - b[g]) < 0.005 for g in ("Super 98", "Special 95", "E-Plus 91"))

    chosen = None
    for i, (u1, p1) in enumerate(readings):
        for u2, p2 in readings[i + 1:]:
            if urllib.parse.urlparse(u1).netloc != urllib.parse.urlparse(u2).netloc and agree(p1, p2):
                chosen = (u1, p1, u2)
                break
        if chosen:
            break

    # last retry day: accept a single source if its prices are plausible next to last month's
    if not chosen and readings and today.day >= LAST_RETRY_DAY and today.day < 25:
        old = current.get("grades", {})
        for u, p in readings:
            if all(abs(p[g] - old.get(g, p[g])) <= 0.8 for g in ("Super 98", "Special 95", "E-Plus 91")):
                chosen = (u, p, None)
                break

    if chosen:
        url, p, url2 = chosen
        new = {
            "updated": first.isoformat(),
            "month": label,
            "source": url + (" (confirmed by " + url2 + ")" if url2 else ""),
            "grades": {g: p.get(g, current["grades"].get(g)) for g in GRADES},
            "previous": current.get("grades", {}),
        }
        PRICES.write_text(json.dumps(new, indent=2) + "\n")
        print(f"Updated prices for {label}: {new['grades']}")
        return 0

    if today.day < 25 and today.day >= LAST_RETRY_DAY:
        print(f"Could not confirm {label} prices by day {today.day}. Update web/prices.json by hand.")
        return 1
    print(f"{label} prices not confirmed yet ({len(readings)} source(s) read). Will try again.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

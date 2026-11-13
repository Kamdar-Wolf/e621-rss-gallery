from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import time
import xml.etree.ElementTree as ET

feed = ET.parse("public/feed.xml")
item = feed.find("./channel/item/enclosure")
url = item.attrib.get("url", "") if item is not None else ""
lines = ["IMAGE HTTP TEST", "Source: " + url]
if url:
    cases = [
        ("Basic UA", url, "KamdarE621RSS/1.0 (by Kamdar-Wolf on e621)", None),
        ("Browser without referer", url, "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:159.0) Gecko/20100101 Firefox/159.0", None),
        ("Browser e621 referer", url, "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:159.0) Gecko/20100101 Firefox/159.0", "https://e621.net/"),
        ("Browser GitHub referer", url, "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:159.0) Gecko/20100101 Firefox/159.0", "https://kamdar-wolf.github.io/"),
        ("e926 mirror", url.replace("static1.e621.net", "static1.e926.net"), "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:159.0) Gecko/20100101 Firefox/159.0", "https://e621.net/"),
    ]
    for label, target, agent, referer in cases:
        time.sleep(0.7)
        headers = {"User-Agent": agent, "Accept": "image/*", "Range": "bytes=0-256"}
        if referer:
            headers["Referer"] = referer
        try:
            with urlopen(Request(target, headers=headers), timeout=18) as response:
                part = response.read(16)
                lines.append(f"{label}: HTTP {response.status}; Content-Type: {response.headers.get('Content-Type')}; first 16 bytes: {part.hex()}")
        except HTTPError as e:
            lines.append(f"{label}: HTTP {e.code}; Content-Type: {e.headers.get('Content-Type')}")
        except (URLError, TimeoutError, OSError) as e:
            lines.append(f"{label}: {type(e).__name__}: {str(e)[:100]}")
else:
    lines.append("Feed contains no image URL")
report = "\n".join(lines) + "\n"
Path("public/image-test.txt").write_text(report, encoding="utf-8")
print(report)

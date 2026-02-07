#!/usr/bin/env python3
import sys

try:
    import cloudscraper
except Exception as exc:  # pragma: no cover
    sys.stderr.write(f"cloudscraper_import_failed:{exc}\n")
    sys.exit(2)


def main() -> int:
    if len(sys.argv) < 2:
        sys.stderr.write("missing_url\n")
        return 2

    url = str(sys.argv[1] or "").strip()
    if not url:
        sys.stderr.write("missing_url\n")
        return 2

    try:
        scraper = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "darwin", "mobile": False}
        )
        resp = scraper.get(url, timeout=45)
        sys.stdout.write(resp.text or "")
        return 0
    except Exception as exc:  # pragma: no cover
        sys.stderr.write(f"cloudscraper_fetch_failed:{exc}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

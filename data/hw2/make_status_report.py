#!/usr/bin/env python3
"""
Generate HW2 status report from CSVs.

Usage:
  python make_status_report.py \
    --name "Tommy Trojan" \
    --usc-id 1234567890 \
    --news-site foxnews.com \
    --threads 25 \
    --fetch fetch_foxnews.csv \
    --urls urls_foxnews.csv \
    --visit visit_foxnews.csv \
    --out status_report.txt

If --out is omitted, the report prints to stdout.
"""

import argparse
import sys
import pandas as pd

STATUS_CODES_OF_INTEREST = [200, 301, 401, 403, 404]

# Size buckets (bytes)
B1 = 1024                # 1KB
B10 = 10 * 1024          # 10KB
B100 = 100 * 1024        # 100KB
B1M = 1024 * 1024        # 1MB

CONTENT_TYPES_OF_INTEREST = [
    "text/html",
    "image/gif",
    "image/jpeg",
    "image/png",
    "application/pdf",
]

def load_csv(path: str) -> pd.DataFrame:
    return pd.read_csv(path)

def format_report(
    name: str,
    usc_id: str,
    news_site: str,
    threads: int,
    fetch_df: pd.DataFrame,
    urls_df: pd.DataFrame,
    visit_df: pd.DataFrame,
) -> str:
    # --- Fetch statistics ---
    # Expected columns in fetch.csv: ["URL","Status","Content-Type","Size(Bytes)"]
    attempted = len(fetch_df)
    # Some CSVs may store non-int or missing; coerce safely
    status_series = pd.to_numeric(fetch_df.get("Status"), errors="coerce").fillna(-1).astype(int)
    succeeded = int(((status_series >= 200) & (status_series < 300)).sum())
    failed_or_aborted = int(attempted - succeeded)

    # --- Outgoing URLs / totals ---
    # Expected columns in urls.csv: ["URL","OK/N_OK"]
    total_urls_extracted = len(urls_df)
    unique_urls_extracted = urls_df["URL"].nunique()

    # Unique within/outside by OK/N_OK
    in_mask = (urls_df["OK/N_OK"].astype(str).str.upper() == "OK")
    out_mask = (urls_df["OK/N_OK"].astype(str).str.upper() == "N_OK")
    unique_in = urls_df.loc[in_mask, "URL"].nunique()
    unique_out = urls_df.loc[out_mask, "URL"].nunique()

    # --- Status code breakdown (from fetch.csv) ---
    status_counts = {code: int((status_series == code).sum()) for code in STATUS_CODES_OF_INTEREST}

    # --- File sizes (from visit.csv) ---
    # visit.csv rows are only for 2xx, with columns: ["URL","Size(Bytes)","Outlinks","Content-Type"]
    size_bytes = pd.to_numeric(visit_df.get("Size(Bytes)"), errors="coerce").fillna(-1).astype(int)
    sz_lt_1k   = int(((size_bytes >= 0) & (size_bytes < B1)).sum())
    sz_1_10k   = int(((size_bytes >= B1) & (size_bytes < B10)).sum())
    sz_10_100k = int(((size_bytes >= B10) & (size_bytes < B100)).sum())
    sz_100k_1m = int(((size_bytes >= B100) & (size_bytes < B1M)).sum())
    sz_ge_1m   = int((size_bytes >= B1M).sum())


    # --- Content types (from visit.csv) ---
    # We expect plain types like "text/html" (no charset)
    ct_series = visit_df.get("Content-Type").astype(str).str.strip().str.lower()
    ct_counts = {ct: int((ct_series == ct).sum()) for ct in CONTENT_TYPES_OF_INTEREST}

    # Build the report string exactly as requested
    lines = []
    lines.append(f"Name: {name}")
    lines.append(f"USC ID: {usc_id}")
    lines.append(f"News site crawled: {news_site}")
    lines.append(f"Number of threads: {threads}")
    lines.append("Fetch Statistics")
    lines.append("================")
    lines.append(f"# fetches attempted: {attempted}")
    lines.append(f"# fetches succeeded: {succeeded}")
    lines.append(f"# fetches failed or aborted: {failed_or_aborted}")
    lines.append("Outgoing URLs:")
    lines.append("==============")
    lines.append(f"Total URLs extracted: {total_urls_extracted}")
    lines.append(f"# unique URLs extracted: {unique_urls_extracted}")
    lines.append(f"# unique URLs within News Site: {unique_in}")
    lines.append(f"# unique URLs outside News Site: {unique_out}")
    lines.append("Status Codes:")
    lines.append("=============")
    lines.append(f"200 OK: {status_counts.get(200,0)}")
    lines.append(f"301 Moved Permanently: {status_counts.get(301,0)}")
    lines.append(f"401 Unauthorized: {status_counts.get(401,0)}")
    lines.append(f"403 Forbidden: {status_counts.get(403,0)}")
    lines.append(f"404 Not Found: {status_counts.get(404,0)}")
    lines.append("File Sizes:")
    lines.append("===========")
    lines.append(f"< 1KB: {sz_lt_1k}")
    lines.append(f"1KB ~ <10KB: {sz_1_10k}")
    lines.append(f"10KB ~ <100KB: {sz_10_100k}")
    lines.append(f"100KB ~ <1MB: {sz_100k_1m}")
    lines.append(f">= 1MB: {sz_ge_1m}")
    lines.append("Content Types:")
    lines.append("==============")
    lines.append(f"text/html: {ct_counts.get('text/html',0)}")
    lines.append(f"image/gif: {ct_counts.get('image/gif',0)}")
    lines.append(f"image/jpeg: {ct_counts.get('image/jpeg',0)}")
    lines.append(f"image/png: {ct_counts.get('image/png',0)}")
    lines.append(f"application/pdf: {ct_counts.get('application/pdf',0)}")

    return "\n".join(lines)

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--name", required=True, help="Your name")
    p.add_argument("--usc-id", required=True, help="Your USC ID")
    p.add_argument("--news-site", required=True, help="e.g., foxnews.com")
    p.add_argument("--threads", type=int, required=True, help="Number of crawler threads used")
    p.add_argument("--fetch", default="fetch_foxnews.csv", help="Path to fetch CSV")
    p.add_argument("--urls", default="urls_foxnews.csv", help="Path to urls CSV")
    p.add_argument("--visit", default="visit_foxnews.csv", help="Path to visit CSV")
    p.add_argument("--out", default="", help="Optional output file path")
    args = p.parse_args()

    fetch_df = load_csv(args.fetch)
    urls_df = load_csv(args.urls)
    visit_df = load_csv(args.visit)

    report = format_report(
        name=args.name,
        usc_id=args.usc_id,
        news_site=args.news_site,
        threads=args.threads,
        fetch_df=fetch_df,
        urls_df=urls_df,
        visit_df=visit_df,
    )

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(report + "\n")
    else:
        sys.stdout.write(report + "\n")

if __name__ == "__main__":
    main()

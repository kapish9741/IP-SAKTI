"""Fill the validated-answer cache from the real pipeline, before the demo.

    .venv/bin/python scripts/demo/warm_cache.py                  # dry run
    .venv/bin/python scripts/demo/warm_cache.py --warm           # send requests
    .venv/bin/python scripts/demo/warm_cache.py --warm --max-requests 2

Nothing here writes an answer. It asks the running server the questions
`scripts/demo/verify.py` already defines — the same list, imported rather than
copied — over the same HTTP endpoint the browser uses, and the server caches
whatever its own pipeline publishes. A question that abstains is not cached,
and a question the provider could not answer is not cached; both are reported
and neither is retried.

The default is a dry run because the point of this script is to spend a token
budget deliberately. `--warm` sends requests, `--max-requests` caps how many,
and `--delay` paces them, because firing six questions back-to-back at a
free-tier per-minute cap produces rate limits rather than cached answers.

A question that is already cached costs no provider tokens, so it neither
consumes the request budget nor triggers a delay. Re-running this after a
partial warm therefore picks up only what is still missing.
"""
from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from verify import SCENARIOS, request  # noqa: E402

ENDPOINTS = {"demo": "/api/ask", "api": "/api/v1/query"}


def read_state(endpoint: str, body: dict) -> tuple[str, bool]:
    """`(status, cache_hit)` from either server's response shape.

    `/api/ask` returns the pipeline result as-is; `/api/v1/query` reshapes it
    and puts the same flag under `meta`. One function reads both so the script
    does not care which server is running.
    """
    if endpoint == "api":
        return body.get("status", "?"), bool((body.get("meta") or {})
                                             .get("cache", {}).get("hit"))
    return body.get("status", "?"), bool((body.get("cache") or {}).get("hit"))


def warm(base: str, endpoint: str, scenarios, *, send: bool, max_requests: int,
         delay: float) -> int:
    path = ENDPOINTS[endpoint]
    spent = 0
    cached = 0
    print(f"{'warming' if send else 'DRY RUN — nothing will be sent'}  "
          f"{base}{path}  (budget: {max_requests} provider request(s))\n")

    for index, (label, question) in enumerate(scenarios, start=1):
        print(f"{index}. {label}")
        print(f"   Q: {question}")
        if not send:
            print("   would send one request; re-run with --warm\n")
            continue
        if spent >= max_requests:
            print("   skipped — request budget exhausted\n")
            continue

        try:
            http_status, body = request(base, path, {"question": question})
        except OSError as exc:
            print(f"   UNREACHABLE  {exc}")
            print("   Start the server first:  .venv/bin/python -m app.server\n")
            return 2

        if http_status not in (200, 503):
            print(f"   ERROR  HTTP {http_status}\n")
            continue

        status, hit = read_state(endpoint, body)
        if status == "ANSWERED" and hit:
            cached += 1
            print("   ALREADY CACHED — no provider request was made\n")
            continue

        spent += 1
        if status == "ANSWERED":
            cached += 1
            print("   CACHED — answered, citations validated, grounding passed")
        elif status == "ABSTAINED":
            print("   NOT CACHED — safe abstention (this is correct; only "
                  "published answers are cached)")
        elif status == "UNAVAILABLE":
            code = ((body.get("service_failure") or body.get("error", {})
                     .get("provider_error") or {}).get("code"))
            print(f"   NOT CACHED — provider unavailable ({code}); not retried")
        else:
            print(f"   NOT CACHED — status {status}")

        remaining = len(scenarios) - index
        if remaining and spent < max_requests and delay > 0:
            print(f"   waiting {delay:.0f}s before the next request "
                  f"(free-tier per-minute cap)")
            time.sleep(delay)
        print()

    print("=" * 76)
    if send:
        print(f"{cached}/{len(scenarios)} question(s) cached · "
              f"{spent} provider request(s) spent")
        print("Repeat clicks on cached questions now consume zero provider tokens.")
    else:
        print(f"{len(scenarios)} question(s) would be warmed. Re-run with --warm.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    parser.add_argument("--endpoint", choices=tuple(ENDPOINTS), default="demo",
                        help="demo: POST /api/ask (what the web UI calls). "
                             "api: POST /api/v1/query")
    parser.add_argument("--warm", action="store_true",
                        help="actually send requests; without it nothing leaves "
                             "this machine")
    parser.add_argument("--max-requests", type=int, default=len(SCENARIOS),
                        help="hard cap on requests that reach the provider "
                             "(cache hits do not count)")
    parser.add_argument("--delay", type=float, default=25.0,
                        help="seconds between requests that reached the "
                             "provider (default 25)")
    parser.add_argument("--question", action="append",
                        help="warm this question instead of the demo scenarios; "
                             "repeatable")
    args = parser.parse_args(argv)

    scenarios = ([(f"ad hoc {i}", q) for i, q in enumerate(args.question, start=1)]
                 if args.question else list(SCENARIOS))
    return warm(args.base, args.endpoint, scenarios, send=args.warm,
                max_requests=max(0, args.max_requests), delay=args.delay)


if __name__ == "__main__":
    raise SystemExit(main())

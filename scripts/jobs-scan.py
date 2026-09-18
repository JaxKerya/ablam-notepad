#!/usr/bin/env python3
"""One scan per systemd timer tick; uses only Python's standard library."""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    base = urllib.parse.urlsplit(os.environ.get("JOBS_SITE_URL", ""))
    secret = os.environ.get("CRON_SECRET", "")
    local = base.hostname in ("localhost", "127.0.0.1", "::1")
    if not secret or not base.hostname or base.username or base.password:
        print("JOBS_SITE_URL ve CRON_SECRET ayarlarini kontrol edin.", file=sys.stderr)
        return 1
    if base.scheme != "https" and not (local and base.scheme == "http"):
        print("Yerel test disinda HTTPS gereklidir.", file=sys.stderr)
        return 1
    url = urllib.parse.urlunsplit((base.scheme, base.netloc, "/api/jobs/scan", "", ""))
    if sys.argv[1:] == ["--check-config"]:
        print("Zamanlayici yapilandirmasi gecerli; tarama yapilmadi.")
        return 0
    request = urllib.request.Request(url, headers={"Authorization": "Bearer " + secret})
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=290) as response:
            raw = response.read(65537)
            if len(raw) > 65536:
                raise ValueError("response too large")
            result = json.loads(raw)
            if not isinstance(result, dict) or result.get("status") not in ("paused", "busy", "cooldown", "completed"):
                raise ValueError("unexpected scan response")
            summary = {"status": result["status"]}
            for key in ("found", "evaluated", "sent"):
                value = result.get(key, 0)
                if type(value) is not int or value < 0:
                    raise ValueError("unexpected count")
                summary[key] = value
            errors = result.get("errors", [])
            if not isinstance(errors, list):
                raise ValueError("unexpected errors")
            summary["error_count"] = len(errors)
            print(json.dumps(summary))
            return 1 if errors else 0
    except urllib.error.HTTPError as error:
        print("Tarama HTTP %d; kaynak yaniti gunluge yazilmadi." % error.code, file=sys.stderr)
    except (OSError, ValueError, urllib.error.URLError):
        print("Tarama baglantisi veya yanit bicimi basarisiz; sonraki zamanlayici turunda yeniden denenecek.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env bash
set -eu

# Run from the extracted deployment bundle. Does not start live scans.
if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' 'Run with sudo or as root.' >&2
  exit 1
fi
bundle_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
command -v python3 >/dev/null
command -v systemctl >/dev/null
for target in /etc/systemd/system/ablam-jobs-scan.service /etc/systemd/system/ablam-jobs-scan.timer /opt/ablam/scripts/jobs-scan.py /etc/ablam/jobs-worker.env; do
  if [ -e "$target" ]; then
    printf 'Existing file; inspect before updating: %s\n' "$target" >&2
    exit 1
  fi
done
for source in scripts/jobs-scan.py deploy/jobs-scan.service deploy/jobs-scan.timer; do
  test -f "$bundle_dir/$source"
done
install -d -m 755 /opt/ablam/scripts
install -d -m 700 /etc/ablam
install -m 644 "$bundle_dir/scripts/jobs-scan.py" /opt/ablam/scripts/jobs-scan.py
install -m 644 "$bundle_dir/deploy/jobs-scan.service" /etc/systemd/system/ablam-jobs-scan.service
install -m 644 "$bundle_dir/deploy/jobs-scan.timer" /etc/systemd/system/ablam-jobs-scan.timer
python3 - <<'PY'
import os, secrets
path = '/etc/ablam/jobs-worker.env'
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as env:
    env.write('JOBS_SITE_URL=https://ablamablam.com\n')
    env.write('CRON_SECRET=' + secrets.token_hex(32) + '\n')
PY
systemd-analyze verify /etc/systemd/system/ablam-jobs-scan.service /etc/systemd/system/ablam-jobs-scan.timer
systemctl daemon-reload
set -a
. /etc/ablam/jobs-worker.env
set +a
python3 /opt/ablam/scripts/jobs-scan.py --check-config
printf '%s\n' 'Installed, but NOT started or enabled.' 'Configure the same CRON_SECRET in Vercel, deploy /is, finish database/provider setup, then follow VPS_WORKER.md.'

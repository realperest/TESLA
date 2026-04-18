#!/usr/bin/env bash
# Git Bash: proje kokunde:  bash upload-cookies-to-railway.sh
set -e
cd "$(dirname "$0")"
if [ ! -f youtube-cookies.txt ]; then
  echo "HATA: youtube-cookies.txt bu klasorde yok: $(pwd)"
  exit 1
fi
echo "railway link yapildiysa devam ediyor..."
cat youtube-cookies.txt | railway run sh -c 'cat > /data/youtube-cookies.txt'
echo "Tamam. Kontrol:"
railway run sh -c "ls -la /data/youtube-cookies.txt && wc -c /data/youtube-cookies.txt"

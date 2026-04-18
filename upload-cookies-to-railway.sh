#!/usr/bin/env bash
# railway run = cogu zaman sadece YEREL ortam; /data sunucuda. Bu yuzden "b64" yontemi eklendi.
cd "$(dirname "$0")"
echo "=== 1) PowerShell'de (TESLA klasorundayken) base64 uret, panoya alir: ==="
echo "[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Content -Path '.\youtube-cookies.txt' -Raw))) | Set-Clipboard"
echo ""
echo "=== 2) Railway > TESLA > Variables: ==="
echo "  YOUTUBE_COOKIES_FILE = /data/youtube-cookies.txt"
echo "  YOUTUBE_COOKIES_B64  = (panodaki tum satir, tek parca)"
echo ""
echo "=== 3) Redeploy. Uygulama acilista dosyayi /data'ya yazar. ==="

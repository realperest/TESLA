@echo off
title Açıl Susam
cd /d "%~dp0"

if /i "%~1"=="cookies" goto cookies_b64
if /i "%~1"=="b64" goto cookies_b64
if /i "%~1"=="railway" goto cookies_b64
goto start_normal

:cookies_b64
title Açıl Susam - YouTube cookies (Railway B64)
echo.
echo  YouTube cookies ^> Base64 (tek seferlik, panoya)
echo  Kaynak: bu klasordeki youtube-cookies.txt
echo.
if not exist "youtube-cookies.txt" (
    echo  HATA: youtube-cookies.txt yok. Tarayicidan cikardiginiz
    echo  cikere dosyasini proje kokune "youtube-cookies.txt" adiyla kaydedin.
    echo.
    pause
    exit /b 1
)
echo  Base64 uretilip PANO'ya aliniyor...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Content -Path '.\youtube-cookies.txt' -Raw))) | Set-Clipboard"
if errorlevel 1 (
    echo  HATA: PowerShell / pano islemi basarisiz.
    pause
    exit /b 1
)
echo.
echo  Tamam. Panoda tek satir Base64 var.
echo.
echo  Railway: TESLA proje - Variables - ekle:
echo    YOUTUBE_COOKIES_FILE  =  /data/youtube-cookies.txt
echo    YOUTUBE_COOKIES_B64   =  (panodaki satiri yapistir)
echo  Sonra Redeploy.
echo.
pause
exit /b 0

:start_normal
echo.
echo  Açıl Susam Başlatıcı
echo.

echo [1/5] Port temizleniyor...
taskkill /F /FI "WINDOWTITLE eq Açıl Susam - Node*" >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    if not "%%a"=="0" taskkill /F /PID %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul
echo    Tamam.

echo [2/5] Python axtariliyor...
set PYTHON_EXE=
python --version >nul 2>&1
if not errorlevel 1 ( set "PYTHON_EXE=python" & goto python_found )
py --version >nul 2>&1
if not errorlevel 1 ( set "PYTHON_EXE=py" & goto python_found )
echo    UYARI: Python bulunamadi - YouTube ozelligi olmayacak.
goto skip_python

:python_found
for /f "tokens=*" %%v in ('%PYTHON_EXE% --version 2^>^&1') do echo    %%v

set "VENV_PY=venv\Scripts\python.exe"
if not exist "%VENV_PY%" (
    echo [3/5] venv olusturuluyor...
    %PYTHON_EXE% -m venv venv
    if errorlevel 1 (
        echo HATA: venv olusturulamadi.
        pause
        exit /b 1
    )
    echo    venv hazir.
) else (
    "%VENV_PY%" --version >nul 2>&1
    if errorlevel 1 (
        echo [3/5] venv kirik bulundu. Yeniden olusturuluyor...
        rmdir /s /q venv
        %PYTHON_EXE% -m venv venv
        if errorlevel 1 (
            echo HATA: venv yeniden olusturulamadi.
            pause
            exit /b 1
        )
        echo    venv yeniden olusturuldu.
    ) else (
        echo [3/5] venv mevcut.
    )
)

echo [4/5] Paketler yukleniyor...
"%VENV_PY%" -m ensurepip --upgrade
if errorlevel 1 (
    echo HATA: pip hazirlanamadi.
    pause
    exit /b 1
)

"%VENV_PY%" -m pip install --upgrade pip
if errorlevel 1 (
    echo HATA: pip guncellenemedi.
    pause
    exit /b 1
)

"%VENV_PY%" -m pip install -r requirements.txt --upgrade
if errorlevel 1 (
    echo HATA: requirements kurulumu basarisiz.
    pause
    exit /b 1
)

"%VENV_PY%" -m yt_dlp --version >nul 2>&1
if errorlevel 1 (
    echo HATA: yt-dlp dogrulamasi basarisiz.
    pause
    exit /b 1
)
set "PATH=%~dp0venv\Scripts;%PATH%"
echo    Hazir.
goto after_python

:skip_python
echo [3/5] Atlaniyor.
echo [4/5] Atlaniyor.

:after_python
where node >nul 2>&1
if errorlevel 1 ( echo HATA: Node.js bulunamadi - https://nodejs.org & pause & exit /b 1 )

if not exist "node_modules" (
    echo [5/5] npm install calistiriliyor...
    npm install
    if errorlevel 1 ( echo HATA: npm install basarisiz! & pause & exit /b 1 )
) else (
    echo [5/5] node_modules mevcut.
)

if not exist ".env" (
    copy .env.example .env >nul
    echo UYARI: .env olusturuldu. Google OAuth bilgilerini girin.
    notepad .env
)

echo.
echo  Sunucu baslatiliyor...
set "PATH=%~dp0venv\Scripts;%PATH%"
start "Açıl Susam - Node" cmd /k node server.js

timeout /t 3 /nobreak >nul
start "" "http://localhost:3000"

echo.
echo  Açıl Susam çalışıyor
echo  Adres   : http://localhost:3000
echo  Yonetim : http://localhost:3000/manage
echo  Railway B64 (PowerShell):  .\baslat.bat cookies
echo  CMD icin:  baslat.bat cookies
echo.
echo  Kapatmak icin bir tusa basin.
pause >nul

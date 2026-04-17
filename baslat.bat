@echo off
title Tesla TV
cd /d "%~dp0"

echo.
echo  Tesla TV Baslatici
echo.

echo [1/5] Port temizleniyor...
taskkill /F /FI "WINDOWTITLE eq Tesla TV - Node*" >nul 2>&1
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
for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo    %%v

if not exist "venv\Scripts\activate.bat" (
    echo [3/5] venv olusturuluyor...
    %PYTHON_EXE% -m venv venv
    if errorlevel 1 goto skip_python
    echo    venv hazir.
) else (
    echo [3/5] venv mevcut.
)

echo [4/5] Paketler yukleniyor...
call venv\Scripts\activate.bat
pip install -q -r requirements.txt --upgrade 2>nul
call venv\Scripts\deactivate.bat
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
start "Tesla TV - Node" cmd /k node server.js

timeout /t 3 /nobreak >nul
start "" "http://localhost:3000"

echo.
echo  Tesla TV CALISIYOR
echo  Adres   : http://localhost:3000
echo  Yonetim : http://localhost:3000/manage
echo.
echo  Kapatmak icin bir tusa basin.
pause >nul

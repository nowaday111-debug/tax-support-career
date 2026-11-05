@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

REM ============================================================
REM  Chay du an tren localhost
REM  Cach dung:
REM    run-local.cmd          -> hien menu chon che do
REM    run-local.cmd real     -> ket noi cong that dichvucong.gdt.gov.vn
REM    run-local.cmd mock     -> cong gia lap (du lieu bia, de dung thu)
REM    run-local.cmd docker   -> chay bang Docker Compose
REM    run-local.cmd test     -> chay unit test
REM ============================================================

set "MODE=%~1"
if "%MODE%"=="" (
  echo  1. Chay that  ^(DVC_MODE=real^)
  echo  2. Chay thu   ^(DVC_MODE=mock - cong gia lap^)
  echo  3. Docker Compose
  echo  4. Chay unit test
  set /p CHON=Chon [1-4, mac dinh 2]: 
  if "!CHON!"=="1" set "MODE=real"
  if "!CHON!"=="3" set "MODE=docker"
  if "!CHON!"=="4" set "MODE=test"
  if "!MODE!"=="" set "MODE=mock"
)

REM --- Tao .env tu .env.example neu chua co ---
if not exist ".env" if exist ".env.example" (
  copy /y ".env.example" ".env" >nul
  echo [*] Da tao .env tu .env.example
)
if not exist "config\doanh-nghiep.json" if exist "config\doanh-nghiep.example.json" (
  copy /y "config\doanh-nghiep.example.json" "config\doanh-nghiep.json" >nul
  echo [*] Da tao config\doanh-nghiep.json tu file mau - nho sua thong tin doanh nghiep
)

REM --- Nap bien moi truong tu .env (bo qua dong bat dau bang #) ---
if exist ".env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)
if "%PORT%"=="" set "PORT=3000"

if /i "%MODE%"=="docker" goto :docker

REM --- Kiem tra Node.js ---
where node >nul 2>nul || (echo [LOI] Chua cai Node.js 20+. Tai tai https://nodejs.org & pause & exit /b 1)
for /f "tokens=1 delims=." %%v in ('node -v') do set "NODEV=%%v"
set "NODEV=%NODEV:v=%"
if %NODEV% LSS 20 (echo [LOI] Can Node.js 20 tro len ^(hien tai v%NODEV%^) & pause & exit /b 1)

REM --- Cai thu vien ---
if not exist "node_modules" (
  echo [*] Cai thu vien npm...
  if exist "package-lock.json" (call npm ci --no-audit --no-fund) else (call npm install --no-audit --no-fund)
  if errorlevel 1 goto :err
)

if /i "%MODE%"=="test" (
  call npm test
  pause
  exit /b %errorlevel%
)

set "DVC_MODE=%MODE%"

REM --- Che do real can trinh duyet Chromium cho Playwright (cai 1 lan) ---
if /i "%DVC_MODE%"=="real" (
  if not exist "%LOCALAPPDATA%\ms-playwright\chromium-*" (
    echo [*] Cai Chromium cho Playwright ^(chi lan dau^)...
    call npx playwright install chromium || goto :err
  )
)

REM --- Bao port dang bi chiem ---
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul && (
  echo [!] Port %PORT% dang duoc dung boi chuong trinh khac. Doi PORT trong .env hoac tat chuong trinh do.
  pause & exit /b 1
)

if not exist "data" mkdir data
echo.
echo [*] Khoi dong: http://localhost:%PORT%   ^(DVC_MODE=%DVC_MODE%^)   - Ctrl+C de dung
start "" cmd /c "timeout /t 3 >nul & start http://localhost:%PORT%"
node server.js
pause
exit /b 0

:docker
where docker >nul 2>nul || (echo [LOI] Chua cai Docker Desktop & pause & exit /b 1)
echo [*] Build va chay container...
docker compose up -d --build || goto :err
echo [OK] Dang chay tai http://localhost:%PORT%
echo      Xem log : docker compose logs -f
echo      Dung    : docker compose down
start http://localhost:%PORT%
pause
exit /b 0

:err
echo.
echo [LOI] Co loi xay ra, xem thong bao phia tren.
pause
exit /b 1

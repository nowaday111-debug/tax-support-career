@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

REM ============================================================
REM  Dua du an len GitHub
REM  Cach dung:
REM    push-github.cmd                         (hoi URL repo lan dau, commit theo gio)
REM    push-github.cmd "noi dung commit"
REM    push-github.cmd "noi dung commit" https://github.com/<user>/<repo>.git
REM ============================================================

where git >nul 2>nul || (echo [LOI] Chua cai Git. Tai tai https://git-scm.com/download/win & pause & exit /b 1)

set "MSG=%~1"
if "%MSG%"=="" set "MSG=Cap nhat %date% %time:~0,8%"
set "REMOTE_URL=%~2"

REM --- Khoi tao repo neu chua co ---
if not exist ".git" (
  echo [*] Khoi tao Git repo...
  git init || goto :err
  git branch -M main
)
git config core.quotepath false
git config core.autocrlf true

REM --- Can user.name / user.email de commit ---
git config user.name >nul 2>nul || (
  set /p GUSER=Nhap ten Git ^(user.name^): 
  call git config user.name "%%GUSER%%"
)
git config user.email >nul 2>nul || (
  set /p GMAIL=Nhap email Git ^(user.email^): 
  call git config user.email "%%GMAIL%%"
)

REM --- Remote origin ---
git remote get-url origin >nul 2>nul
if errorlevel 1 (
  if "%REMOTE_URL%"=="" set /p REMOTE_URL=Nhap URL repo GitHub ^(vd https://github.com/ten/hoa-don-to-khai-trial.git^): 
  call git remote add origin "%%REMOTE_URL%%" || goto :err
) else if not "%REMOTE_URL%"=="" (
  git remote set-url origin "%REMOTE_URL%"
)

REM --- Kiem tra file bi mat khong bi dua len ---
if not exist ".gitignore" (echo [LOI] Thieu file .gitignore - dung lai de tranh lo .env / node_modules & pause & exit /b 1)

echo [*] Them file...
git add -A || goto :err
git rm -r --cached --ignore-unmatch node_modules data output .env config/doanh-nghiep.json >nul 2>nul

git diff --cached --quiet
if errorlevel 1 (
  echo [*] Commit: %MSG%
  git commit -m "%MSG%" || goto :err
) else (
  echo [i] Khong co thay doi moi de commit.
)

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BR=%%b"
echo [*] Day len origin/%BR% ...
git push -u origin %BR%
if errorlevel 1 (
  echo [!] Push bi tu choi. Neu repo GitHub da co san commit ^(README...^), chay:
  echo     git pull origin %BR% --rebase --allow-unrelated-histories
  echo     roi chay lai push-github.cmd
  goto :err
)
echo.
echo [OK] Da dua len GitHub.
pause
exit /b 0

:err
echo.
echo [LOI] Co loi xay ra, xem thong bao phia tren.
pause
exit /b 1

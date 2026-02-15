@echo off
chcp 65001 >nul

echo ===============================
echo  GIT OTOMATIK COMMIT
echo ===============================
echo.

git rev-parse --is-inside-work-tree >nul 2>&1
if %errorlevel% neq 0 (
    echo Bu klasor bir git reposu degil.
    pause
    exit /b
)

git diff --quiet
if %errorlevel% neq 0 (
    echo Degisiklikler var. Commit icin hazirlaniyor...
) else (
    echo Degisiklik yok. Cikis yapiliyor.
    pause
    exit /b
)

echo.
set /p msg="Commit mesaji: "

if "%msg%"=="" (
    echo Mesaj bos olamaz.
    pause
    exit /b
)

git add .
git commit -m "%msg%"
git push

echo.
echo [SUCCESS] Commit ve Push BASARIYLA TAMAMLANDI.
echo ===============================
pause
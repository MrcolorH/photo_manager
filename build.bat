@echo off
chcp 65001 >nul
echo ========================================
echo   相机照片管理器 - 构建脚本 v2.1
echo ========================================
echo.

echo [1/3] 构建前端...
cd /d "%~dp0frontend"
call npm run build
if %errorlevel% neq 0 (
    echo 前端构建失败!
    pause
    exit /b 1
)

echo.
echo [2/3] 确认依赖...
cd /d "%~dp0backend"
call npm install
if %errorlevel% neq 0 (
    echo 后端依赖安装失败!
    pause
    exit /b 1
)

echo.
echo [3/3] 打包 exe...
cd /d "%~dp0"
py -m PyInstaller launcher.spec --clean --noconfirm
if %errorlevel% neq 0 (
    echo 打包失败!
    pause
    exit /b 1
)

echo.
echo ========================================
echo   构建完成!
echo   输出: dist\CameraPhotoManager.exe
echo ========================================
pause

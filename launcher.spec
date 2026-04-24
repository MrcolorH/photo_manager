# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller 打包配置 - 相机照片管理器 v3.0
静默后台启动 (console=False)，仅显示系统托盘图标
"""
from pathlib import Path

ROOT = Path(SPECPATH)

a = Analysis(
    ['launcher.py'],
    pathex=[],
    binaries=[],
    datas=[
        (str(ROOT / 'frontend-server.js'), '.'),
        (str(ROOT / 'backend'), 'backend'),
        (str(ROOT / 'frontend' / 'dist'), 'frontend/dist'),
        (str(ROOT / 'electron' / 'assets' / 'icon.png'), 'assets'),
    ],
    hiddenimports=[
        'PIL', 'PIL.Image', 'PIL.ImageDraw',
        'pystray', 'pystray._win32', 'pystray._base',
        'urllib', 'urllib.request',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['matplotlib', 'numpy', 'scipy', 'pandas', 'tensorflow', 'torch'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=None,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=None)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='CameraPhotoManager',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,    # 静默后台启动，不显示控制台窗口
    disable_windowed_traceback=True,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(ROOT / 'electron' / 'assets' / 'icon.png'),
)

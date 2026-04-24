# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['launcher.py'],
    pathex=[],
    binaries=[],
    datas=[('frontend-server.js', '.'), ('backend', 'backend'), ('frontend/dist', 'frontend/dist'), ('electron/assets/icon.png', 'assets')],
    hiddenimports=['PIL', 'PIL.Image', 'PIL.ImageDraw', 'pystray', 'pystray._win32', 'pystray._base', 'logging', 'logging.handlers'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='CameraPhotoManager',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['electron\\assets\\icon.png'],
)

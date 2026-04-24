#!/usr/bin/env python3
"""
相机照片管理器 - 桌面启动器 v3.1
系统托盘应用，同时启动前后端服务
- 前端: 端口 9900 (静态文件 + API代理到9901)
- 后端: 端口 9901 (API 服务)

v3.1 改进:
- 启动前自动清理占用端口的旧进程 (netstat + taskkill)
- 重启时等待 3 秒确保端口完全释放
- 前端服务器增加 EADDRINUSE 容错处理
"""

import os, sys, subprocess, webbrowser, threading, time, shutil
from pathlib import Path
from datetime import datetime

# ============================================================
# 配置
# ============================================================
FRONTEND_PORT = 9900
BACKEND_PORT = 9901
APP_NAME = "相机照片管理器"

# ============================================================
# 路径工具
# ============================================================
def get_base_path():
    if getattr(sys, 'frozen', False):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent

def get_user_data_dir():
    if sys.platform == 'win32':
        base = Path(os.environ.get('APPDATA', Path.home() / 'AppData' / 'Roaming'))
    elif sys.platform == 'darwin':
        base = Path.home() / 'Library' / 'Application Support'
    else:
        base = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local' / 'share'))
    data_dir = base / 'CameraPhotoManager'
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir

def get_node_path():
    node = shutil.which('node')
    if node:
        return node
    for p in [Path('C:/Program Files/nodejs/node.exe'), Path('C:/Program Files (x86)/nodejs/node.exe')]:
        if p.exists():
            return str(p)
    return None

def get_script_path(relative_path):
    p = get_base_path() / relative_path
    return str(p) if p.exists() else None

def get_icon_path():
    base = get_base_path()
    for p in [base / 'assets' / 'icon.png', base / 'icon.png']:
        if p.exists():
            return str(p)
    return None

# ============================================================
# 日志 (立即刷新)
# ============================================================
class _Logger:
    def __init__(self):
        data_dir = get_user_data_dir()
        self.log_file = data_dir / 'launcher.log'
        self._f = open(self.log_file, 'a', encoding='utf-8')
        self._lock = threading.Lock()

    def _write(self, level, msg):
        ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        line = f"{ts} [{level}] {msg}"
        with self._lock:
            self._f.write(line + '\n')
            self._f.flush()
            # 同时输出到控制台 (如果存在)
            try:
                print(line, flush=True)
            except Exception:
                pass

    def info(self, msg):
        self._write('INFO', msg)

    def error(self, msg):
        self._write('ERROR', msg)

    def debug(self, msg):
        self._write('DEBUG', msg)

    def get_path(self):
        return self.log_file

_log = _Logger()

def log_info(msg):
    _log.info(msg)

def log_error(msg):
    _log.error(msg)

# ============================================================
# 弹窗提示
# ============================================================
def show_message(title, message, error=False):
    try:
        import ctypes
        style = 0x10 if error else 0x40  # MB_ICONERROR=0x10, MB_ICONINFORMATION=0x40
        ctypes.windll.user32.MessageBoxW(0, str(message), str(title), style)
    except Exception:
        pass

# ============================================================
# 启动器核心逻辑 (无托盘依赖)
# ============================================================

class ServiceStarter:
    """负责启动 Node.js 前后端服务，使用端口轮询确认启动成功"""

    def __init__(self):
        self.backend_process = None
        self.frontend_process = None

    @property
    def is_backend_running(self):
        return self.backend_process is not None and self.backend_process.poll() is None

    @property
    def is_frontend_running(self):
        return self.frontend_process is not None and self.frontend_process.poll() is None

    @property
    def all_running(self):
        return self.is_backend_running and self.is_frontend_running

    def _check_port(self, port, timeout=2):
        """HTTP GET /api/health 确认服务就绪"""
        import urllib.request
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                req = urllib.request.Request(f"http://localhost:{port}/api/health")
                with urllib.request.urlopen(req, timeout=1) as resp:
                    if resp.status == 200:
                        return True
            except Exception:
                pass
            time.sleep(0.3)
        return False

    def _kill_port_process(self, port):
        """杀死占用指定端口的进程 (Windows only)"""
        if sys.platform != 'win32':
            return
        try:
            # 用 netstat 找到占用端口的 PID
            result = subprocess.run(
                ['netstat', '-ano', '-p', 'TCP'],
                capture_output=True, text=True,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            for line in result.stdout.splitlines():
                if f':{port}' in line and 'LISTENING' in line:
                    parts = line.strip().split()
                    pid = parts[-1]
                    log_info(f"端口 {port} 被 PID={pid} 占用，正在清理...")
                    subprocess.run(
                        ['taskkill', '/F', '/PID', pid],
                        capture_output=True,
                        creationflags=subprocess.CREATE_NO_WINDOW
                    )
                    time.sleep(0.5)
        except Exception as e:
            log_error(f"端口清理异常: {e}")

    def start_all(self):
        """并行启动前后端，使用端口轮询确认"""
        log_info("=" * 50)
        log_info("启动所有服务...")

        node_path = get_node_path()
        if not node_path:
            log_error("未找到 Node.js!")
            show_message(APP_NAME, "未找到 Node.js!\n请安装: https://nodejs.org", error=True)
            return False

        log_info(f"Node.js: {node_path}")

        # 验证 Node.js
        try:
            r = subprocess.run([node_path, '--version'], capture_output=True, text=True, timeout=5,
                               creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
            log_info(f"Node 版本: {r.stdout.strip()}")
        except Exception as e:
            log_error(f"Node.js 不可用: {e}")
            show_message(APP_NAME, f"Node.js 测试失败:\n{e}", error=True)
            return False

        base = get_base_path()
        data_dir = get_user_data_dir()

        # 初始化用户数据
        repos_file = data_dir / 'repos.json'
        if not repos_file.exists():
            template = base / 'backend' / 'src' / 'data' / 'repos.json'
            if template.exists():
                shutil.copy(template, repos_file)
                log_info(f"已初始化配置: {repos_file}")

        # 检查文件
        backend_script = base / 'backend' / 'src' / 'app.js'
        frontend_script = base / 'frontend-server.js'
        frontend_dist = base / 'frontend' / 'dist' / 'index.html'

        for path, name in [(backend_script, '后端'), (frontend_script, '前端'), (frontend_dist, '前端构建')]:
            if not path.exists():
                log_error(f"{name}不存在: {path}")
                show_message(APP_NAME, f"应用文件不完整\n缺少: {name}", error=True)
                return False

        # 启动前清理端口占用 (防止旧进程残留)
        log_info("清理已有端口占用...")
        for port in [BACKEND_PORT, FRONTEND_PORT]:
            self._kill_port_process(port)

        # 后端日志文件
        backend_log = data_dir / 'backend.log'
        frontend_log = data_dir / 'frontend.log'

        # 收集启动错误
        startup_errors = []

        # 启动后端
        log_info(f"启动后端: {backend_script}")
        log_info(f"后端 CWD: {base / 'backend'}")
        try:
            env = os.environ.copy()
            env['PORT'] = str(BACKEND_PORT)
            env['DATA_DIR'] = str(data_dir)
            env['NODE_ENV'] = 'production'

            with open(backend_log, 'a', encoding='utf-8') as bf:
                bf.write(f"\n--- {datetime.now()} ---\n")
                self.backend_process = subprocess.Popen(
                    [node_path, str(backend_script)],
                    env=env,
                    cwd=str(base / 'backend'),  # CWD = backend/ 确保 .env 和 node_modules 正确解析
                    stdout=bf,
                    stderr=subprocess.STDOUT,
                    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
                )
            log_info(f"后端 PID={self.backend_process.pid}")

            # 检查是否立即退出
            time.sleep(0.5)
            if self.backend_process.poll() is not None:
                exit_code = self.backend_process.returncode
                log_error(f"后端启动失败! 退出码={exit_code}")
                if backend_log.exists():
                    with open(backend_log, 'r', encoding='utf-8') as bf:
                        tail = bf.readlines()[-20:]
                    log_error("后端日志:\n" + "".join(tail))
                startup_errors.append(f"后端进程退出码={exit_code}")
                self.backend_process = None
        except Exception as e:
            log_error(f"后端启动异常: {e}")
            startup_errors.append(f"后端异常: {e}")
            self.backend_process = None

        # 启动前端
        log_info(f"启动前端: {frontend_script}")
        log_info(f"前端 CWD: {base}")
        try:
            env = os.environ.copy()

            with open(frontend_log, 'a', encoding='utf-8') as ff:
                ff.write(f"\n--- {datetime.now()} ---\n")
                self.frontend_process = subprocess.Popen(
                    [node_path, str(frontend_script)],
                    env=env,
                    cwd=str(base),  # CWD = 基础目录，frontend-server.js 用 __dirname 定位前端文件
                    stdout=ff,
                    stderr=subprocess.STDOUT,
                    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
                )
            log_info(f"前端 PID={self.frontend_process.pid}")

            time.sleep(0.5)
            if self.frontend_process.poll() is not None:
                exit_code = self.frontend_process.returncode
                log_error(f"前端启动失败! 退出码={exit_code}")
                if frontend_log.exists():
                    with open(frontend_log, 'r', encoding='utf-8') as ff:
                        tail = ff.readlines()[-20:]
                    log_error("前端日志:\n" + "".join(tail))
                startup_errors.append(f"前端进程退出码={exit_code}")
                self.frontend_process = None
        except Exception as e:
            log_error(f"前端启动异常: {e}")
            startup_errors.append(f"前端异常: {e}")
            self.frontend_process = None

        # 端口轮询确认服务就绪 (仅当进程存活时)
        if self.is_backend_running:
            log_info("等待后端服务就绪...")
            if self._check_port(BACKEND_PORT, timeout=10):
                log_info("后端服务就绪!")
            else:
                log_error("后端端口无响应")
                startup_errors.append(f"后端进程运行中但端口 {BACKEND_PORT} 无响应")

        if self.is_frontend_running:
            log_info("等待前端服务就绪...")
            if self._check_port(FRONTEND_PORT, timeout=5):
                log_info("前端服务就绪!")
            else:
                log_error("前端端口无响应")
                startup_errors.append(f"前端进程运行中但端口 {FRONTEND_PORT} 无响应")

        ok = self.is_backend_running and self.is_frontend_running
        log_info(f"启动完成: {'全部成功' if ok else '部分失败'}")

        # 有错误时统一弹窗 (非阻塞式)
        if startup_errors:
            msg = "部分服务启动失败:\n\n" + "\n".join(startup_errors)
            msg += f"\n\n日志: {_log.get_path()}"
            show_message(f"{APP_NAME} - 启动异常", msg, error=True)

        return ok

    def stop_all(self):
        log_info("停止所有服务...")
        for proc in [self.backend_process, self.frontend_process]:
            if proc is None:
                continue
            pid = proc.pid
            log_info(f"停止 PID={pid}")
            try:
                if sys.platform == 'win32':
                    subprocess.run(['taskkill', '/F', '/T', '/PID', str(pid)],
                                   capture_output=True,
                                   creationflags=subprocess.CREATE_NO_WINDOW)
                else:
                    proc.terminate()
                    try:
                        proc.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        proc.kill()
            except Exception as e:
                log_error(f"停止 PID={pid} 出错: {e}")
        self.backend_process = None
        self.frontend_process = None
        log_info("服务已停止")

    def restart_all(self):
        log_info("重新启动服务...")
        self.stop_all()
        time.sleep(3)  # 等待端口完全释放
        return self.start_all()


# ============================================================
# 系统托盘
# ============================================================
def create_tray_icon():
    from PIL import Image, ImageDraw
    icon_path = get_icon_path()
    if icon_path:
        try:
            return Image.open(icon_path)
        except Exception:
            pass
    # 降级: 画一个简单的图标
    img = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse([4, 4, 60, 60], fill='#1890ff')
    draw.ellipse([20, 16, 44, 40], fill='white')
    draw.rectangle([28, 32, 36, 48], fill='#1890ff')
    return img


class TrayApp:
    def __init__(self):
        self.services = ServiceStarter()
        self.tray = None
        self._stopping = False

    def run(self):
        import pystray
        icon = create_tray_icon()
        self.tray = pystray.Icon(APP_NAME, icon, APP_NAME, self._build_menu())

        # 延迟启动服务 (1秒后，给托盘时间初始化)
        threading.Timer(1.0, self._start_services).start()
        threading.Thread(target=self._periodic_update, daemon=True).start()

        self.tray.run()
        log_info("托盘已退出")
        self.services.stop_all()

    def _start_services(self):
        self.services.start_all()
        self._update_menu()

    def _periodic_update(self):
        while not self._stopping:
            try:
                self._update_menu()
            except Exception:
                pass
            time.sleep(3)

    def _build_menu(self):
        import pystray
        running = self.services.all_running
        status = "状态: 运行中" if running else "状态: 已停止"
        return pystray.Menu(
            pystray.MenuItem(status, lambda: None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem('打开主页面', self._on_open, enabled=running, default=True),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem('查看日志', self._on_view_log),
            pystray.MenuItem('重新启动服务', self._on_restart),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem('退出', self._on_quit),
        )

    def _update_menu(self):
        if self.tray is None or self._stopping:
            return
        try:
            self.tray.menu = self._build_menu()
            running = self.services.all_running
            self.tray.title = f"{APP_NAME} - {'运行中' if running else '已停止'}"
        except Exception:
            pass

    def _on_open(self, icon, item):
        webbrowser.open(f"http://localhost:{FRONTEND_PORT}")

    def _on_view_log(self, icon, item):
        log_path = _log.get_path()
        if log_path and log_path.exists():
            os.startfile(str(log_path))
        else:
            show_message(APP_NAME, "日志文件尚未生成")

    def _on_restart(self, icon, item):
        log_info("用户请求重新启动")
        threading.Thread(target=self.services.restart_all, daemon=True).start()
        self._update_menu()

    def _on_quit(self, icon, item):
        log_info("用户请求退出")
        self._stopping = True
        if self.tray:
            self.tray.stop()


# ============================================================
# 入口
# ============================================================
def main():
    log_info("=" * 50)
    log_info(f"{APP_NAME} v3.0 启动")
    log_info(f"Python: {sys.version}")
    log_info(f"打包: {'是' if getattr(sys, 'frozen', False) else '否(开发)'}")
    log_info(f"基础路径: {get_base_path()}")
    log_info(f"前端端口:{FRONTEND_PORT} 后端端口:{BACKEND_PORT}")

    app = TrayApp()
    try:
        app.run()
    except KeyboardInterrupt:
        pass
    except Exception as e:
        log_error(f"托盘运行异常: {e}")
        import traceback
        log_error(traceback.format_exc())
        show_message(APP_NAME, f"运行错误:\n{e}", error=True)

    log_info(f"{APP_NAME} 已退出")
    sys.exit(0)


if __name__ == '__main__':
    main()

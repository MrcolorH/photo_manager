#!/bin/bash
# 构建开发版本 CameraManager App (使用系统 Node.js)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="CameraManager"
APP_DIR="$SCRIPT_DIR/${APP_NAME}.app"
RESOURCES_DIR="$APP_DIR/Contents/Resources"
MACOS_DIR="$APP_DIR/Contents/MacOS"

echo "=== 开始构建开发版 App ==="

# 1. 清理并创建目录
echo "[1/5] 准备目录..."
rm -rf "$APP_DIR"
mkdir -p "$RESOURCES_DIR/Project/backend"
mkdir -p "$RESOURCES_DIR/Project/frontend"
mkdir -p "$MACOS_DIR"

# 2. 复制后端代码（不复制 node_modules，使用系统的）
echo "[2/5] 复制后端代码..."
rsync -a --exclude='.git' --exclude='node_modules' --exclude='node_modules/.cache' \
    "$SCRIPT_DIR/backend/" "$RESOURCES_DIR/Project/backend/"

# 3. 复制前端代码（不复制 node_modules，使用系统的）
echo "[3/5] 复制前端代码..."
rsync -a --exclude='.git' --exclude='node_modules' --exclude='node_modules/.cache' \
    "$SCRIPT_DIR/frontend/" "$RESOURCES_DIR/Project/frontend/"

# 4. 创建启动脚本（使用系统 Node.js）
echo "[4/5] 创建启动脚本..."
cat > "$RESOURCES_DIR/Project/start.sh" << 'STARTEOF'
#!/bin/bash
APP_ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="/tmp/camera-manager-dev.log"

echo "[$(date)] 开始启动相机管理后台 (开发版)..." > "$LOG_FILE"
echo "[$(date)] App 根目录: $APP_ROOT" >> "$LOG_FILE"

# 加载用户 shell 配置以获取 nvm/node 环境
if [ -f "$HOME/.zshrc" ]; then
    source "$HOME/.zshrc" 2>/dev/null
elif [ -f "$HOME/.bash_profile" ]; then
    source "$HOME/.bash_profile" 2>/dev/null
elif [ -f "$HOME/.bashrc" ]; then
    source "$HOME/.bashrc" 2>/dev/null
fi

# 如果还是找不到 node，尝试 nvm 的默认路径
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "错误: 未找到 Node.js" >> "$LOG_FILE"
    exit 1
fi

echo "[$(date)] Node.js 路径: $(which node)" >> "$LOG_FILE"
node -v >> "$LOG_FILE" 2>&1

# 安装依赖（如果 node_modules 不存在）
if [ ! -d "$APP_ROOT/backend/node_modules" ]; then
    echo "[$(date)] 安装后端依赖..." >> "$LOG_FILE"
    cd "$APP_ROOT/backend" && npm install >> "$LOG_FILE" 2>&1
fi

if [ ! -d "$APP_ROOT/frontend/node_modules" ]; then
    echo "[$(date)] 安装前端依赖..." >> "$LOG_FILE"
    cd "$APP_ROOT/frontend" && npm install >> "$LOG_FILE" 2>&1
fi

# 并行启动后端和前端
(
  cd "$APP_ROOT/backend"
  echo "[$(date)] 启动后端服务 (端口 9901)..." >> "$LOG_FILE"
  PORT=9901 nohup node src/app.js >> "$LOG_FILE" 2>&1 &
  echo $! > /tmp/camera-manager-backend.pid
) &

(
  cd "$APP_ROOT/frontend"
  echo "[$(date)] 启动前端服务 (端口 9900)..." >> "$LOG_FILE"
  nohup npx vite --port 9900 >> "$LOG_FILE" 2>&1 &
  echo $! > /tmp/camera-manager-frontend.pid
) &

sleep 1

BACKEND_PID=$(cat /tmp/camera-manager-backend.pid 2>/dev/null)
FRONTEND_PID=$(cat /tmp/camera-manager-frontend.pid 2>/dev/null)
echo "[$(date)] 启动进程已创建 (后端: $BACKEND_PID, 前端: $FRONTEND_PID)" >> "$LOG_FILE"
STARTEOF
chmod +x "$RESOURCES_DIR/Project/start.sh"

# 创建停止脚本
cat > "$RESOURCES_DIR/Project/stop.sh" << 'STOPEOF'
#!/bin/bash
stop_service() {
    local pid_file=$1
    local port=$2
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file" 2>/dev/null)
        if [ -n "$pid" ]; then
            pkill -P "$pid" 2>/dev/null
            kill "$pid" 2>/dev/null
            sleep 1
            kill -9 "$pid" 2>/dev/null
            pkill -9 -P "$pid" 2>/dev/null
        fi
        rm -f "$pid_file"
    fi
    if lsof -i :"$port" > /dev/null 2>&1; then
        lsof -i :"$port" | grep LISTEN | awk '{print $2}' | xargs kill -9 2>/dev/null
    fi
}
stop_service /tmp/camera-manager-backend.pid 9901
stop_service /tmp/camera-manager-frontend.pid 9900
pkill -f "node src/app.js" 2>/dev/null
pkill -f "vite --port 9900" 2>/dev/null
echo "[$(date)] 所有服务已停止" >> /tmp/camera-manager-dev.log
STOPEOF
chmod +x "$RESOURCES_DIR/Project/stop.sh"

# 5. 创建 Swift 代码
echo "[5/5] 创建 Swift 应用..."
cat > "$MACOS_DIR/CameraManager.swift" << 'SWIFTEOF'
import Cocoa

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var statusMenuItem: NSMenuItem!
    var showPageMenuItem: NSMenuItem!
    var projectPath: String = ""
    var appState: AppState = .starting
    
    enum AppState {
        case starting
        case running
        case error
    }
    
    func applicationDidFinishLaunching(_ notification: Notification) {
        // 获取内嵌项目路径: App.app/Contents/Resources/Project
        projectPath = Bundle.main.bundleURL
            .appendingPathComponent("Contents")
            .appendingPathComponent("Resources")
            .appendingPathComponent("Project")
            .path
        
        // 创建菜单栏图标
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "📷"
        statusItem.button?.action = #selector(showMenu)
        
        // 创建菜单
        let menu = NSMenu()
        
        statusMenuItem = NSMenuItem(title: "⏳ 启动中请稍后...", action: nil, keyEquivalent: "")
        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)
        
        menu.addItem(NSMenuItem.separator())
        
        showPageMenuItem = NSMenuItem(title: "显示主页面", action: #selector(showMainPage), keyEquivalent: "")
        showPageMenuItem.isEnabled = false
        menu.addItem(showPageMenuItem)
        
        menu.addItem(NSMenuItem.separator())
        
        let quitMenuItem = NSMenuItem(title: "退出", action: #selector(quitApp), keyEquivalent: "q")
        menu.addItem(quitMenuItem)
        
        statusItem.menu = menu
        
        // 验证路径
        let fm = FileManager.default
        if !fm.fileExists(atPath: projectPath + "/start.sh") {
            updateMenuStatus("❌ 启动脚本丢失")
            showAlert(title: "启动失败", message: "无法找到内嵌的启动脚本，请重新安装应用。")
            return
        }
        
        startServices()
        startHealthCheck()
    }
    
    func startServices() {
        let task = Process()
        task.launchPath = projectPath + "/start.sh"
        task.arguments = []
        
        do {
            try task.run()
        } catch {
            print("启动服务失败: \(error)")
            updateMenuStatus("❌ 启动失败")
        }
    }
    
    func startHealthCheck() {
        var checkCount = 0
        Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] timer in
            guard let self = self else { timer.invalidate(); return }
            checkCount += 1
            
            if self.checkHealth() && self.appState == .starting {
                self.appState = .running
                self.updateMenu()
                self.showNotification()
                self.showMainPage()
                timer.invalidate()
            } else if checkCount > 30 {
                self.appState = .error
                self.updateMenuStatus("❌ 启动超时，请检查日志")
                timer.invalidate()
            }
        }
    }
    
    func checkHealth() -> Bool {
        guard let url = URL(string: "http://localhost:9901/api/health") else { return false }
        let semaphore = DispatchSemaphore(value: 0)
        var isSuccess = false
        var request = URLRequest(url: url)
        request.timeoutInterval = 1
        let task = URLSession.shared.dataTask(with: request) { _, _, error in
            if error == nil { isSuccess = true }
            semaphore.signal()
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + 1)
        return isSuccess
    }
    
    func updateMenu() {
        DispatchQueue.main.async {
            if self.appState == .running {
                self.statusMenuItem.title = "✓ 运行中"
                self.showPageMenuItem.isEnabled = true
            }
        }
    }
    
    func updateMenuStatus(_ title: String) {
        DispatchQueue.main.async { self.statusMenuItem.title = title }
    }
    
    @objc func showMainPage() {
        if let url = URL(string: "http://localhost:9900") {
            NSWorkspace.shared.open(url)
        }
    }
    
    @objc func quitApp() {
        if !projectPath.isEmpty {
            let task = Process()
            task.launchPath = projectPath + "/stop.sh"
            try? task.run()
            task.waitUntilExit()
        }
        NSApplication.shared.terminate(nil)
    }
    
    func showNotification() {
        let process = Process()
        process.launchPath = "/usr/bin/osascript"
        process.arguments = ["-e", "display notification \"相机管理后台已就绪\" with title \"启动成功\""]
        try? process.run()
    }
    
    func showAlert(title: String, message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "确定")
        alert.runModal()
    }
    
    @objc func showMenu() {
        statusItem.button?.performClick(nil)
    }
}

let appDelegate = AppDelegate()
let app = NSApplication.shared
app.delegate = appDelegate
app.setActivationPolicy(.accessory)
app.run()
SWIFTEOF

# 编译 Swift
echo "编译 Swift 应用..."
cd "$MACOS_DIR"
swiftc -o CameraManager CameraManager.swift
chmod +x CameraManager

echo ""
echo "=== 开发版构建完成 ==="
echo "开发版 App: $APP_DIR"
echo ""
echo "使用方式:"
echo "1. 双击 CameraManager.app 打开"
echo "2. 首次启动会自动安装依赖 (需要网络)"
echo "3. 从菜单栏图标访问应用"
echo ""
echo "注意: 开发版需要系统已安装 Node.js"

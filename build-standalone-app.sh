#!/bin/bash
# 构建完全独立的 CameraManager App

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="CameraManager"
STANDALONE_DIR="$SCRIPT_DIR/Standalone"
APP_DIR="$STANDALONE_DIR/${APP_NAME}.app"
RESOURCES_DIR="$APP_DIR/Contents/Resources"
MACOS_DIR="$APP_DIR/Contents/MacOS"
BUILD_DIR="$SCRIPT_DIR/build"
NODE_PATH="/Users/colorh/.nvm/versions/node/v20.19.0/bin/node"

echo "=== 开始构建独立 App ==="

# 1. 清理并创建目录
echo "[1/6] 准备目录..."
rm -rf "$STANDALONE_DIR" "$BUILD_DIR"
mkdir -p "$STANDALONE_DIR"
mkdir -p "$BUILD_DIR"
mkdir -p "$RESOURCES_DIR/Project/backend"
mkdir -p "$RESOURCES_DIR/Project/frontend"
mkdir -p "$MACOS_DIR"

# 2. 复制后端代码和依赖
echo "[2/6] 复制后端代码..."
rsync -a --exclude='.git' --exclude='node_modules/.cache' \
    "$SCRIPT_DIR/backend/" "$RESOURCES_DIR/Project/backend/"

# 3. 复制前端代码和依赖
echo "[3/6] 复制前端代码..."
rsync -a --exclude='.git' --exclude='node_modules/.cache' \
    "$SCRIPT_DIR/frontend/" "$RESOURCES_DIR/Project/frontend/"

# 4. 复制 Node.js 运行时
echo "[4/6] 复制 Node.js 运行时..."
cp "$NODE_PATH" "$RESOURCES_DIR/Project/node"
chmod +x "$RESOURCES_DIR/Project/node"

# 5. 创建内嵌启动脚本
echo "[5/6] 创建启动脚本..."
cat > "$RESOURCES_DIR/Project/start.sh" << 'STARTEOF'
#!/bin/bash
APP_ROOT="$(cd "$(dirname "$0")" && pwd)"
NODE="$APP_ROOT/node"
LOG_FILE="/tmp/camera-manager.log"

echo "[$(date)] 开始启动相机管理后台..." > "$LOG_FILE"
echo "[$(date)] Node 路径: $NODE" >> "$LOG_FILE"
echo "[$(date)] App 根目录: $APP_ROOT" >> "$LOG_FILE"

# 检查 Node.js
if [ ! -x "$NODE" ]; then
    echo "错误: 内嵌 Node.js 不存在" >> "$LOG_FILE"
    exit 1
fi

"$NODE" -v >> "$LOG_FILE" 2>&1

# 并行启动后端和前端
(
  cd "$APP_ROOT/backend"
  echo "[$(date)] 启动后端服务 (端口 9901)..." >> "$LOG_FILE"
  PORT=9901 nohup "$NODE" src/app.js >> "$LOG_FILE" 2>&1 &
  echo $! > /tmp/camera-manager-backend.pid
) &

(
  cd "$APP_ROOT/frontend"
  echo "[$(date)] 启动前端服务 (端口 9900)..." >> "$LOG_FILE"
  nohup "$NODE" "$APP_ROOT/frontend/node_modules/.bin/vite" --port 9900 >> "$LOG_FILE" 2>&1 &
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
echo "[$(date)] 所有服务已停止" >> /tmp/camera-manager.log
STOPEOF
chmod +x "$RESOURCES_DIR/Project/stop.sh"

# 6. 更新 Swift 代码（指向 Resources/Project）
echo "[6/6] 更新 Swift 代码..."
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

# 创建 .dmg
echo "=== 创建 DMG 安装包 ==="
DMG_NAME="CameraManager-Standalone.dmg"
DMG_PATH="$STANDALONE_DIR/${APP_NAME}-Standalone.dmg"

# 创建临时挂载目录
TMP_DMG="$BUILD_DIR/tmp.dmg"
MOUNT_POINT="$BUILD_DIR/mount"

# 计算 App 大小
APP_SIZE=$(du -sm "$APP_DIR" | cut -f1)
DMG_SIZE=$((APP_SIZE + 50))

# 创建 DMG
hdiutil create -size "${DMG_SIZE}m" -volname "CameraManager" -srcfolder "$APP_DIR" -ov -format UDZO "$DMG_PATH"

echo ""
echo "=== 构建完成 ==="
echo "独立版 App: $APP_DIR"
echo "DMG 安装包: $DMG_PATH"
echo "App 大小: ${APP_SIZE}MB"
echo ""
echo "使用方式:"
echo "1. 进入 Standalone 目录"
echo "2. 双击 DMG 挂载"
echo "3. 将 CameraManager.app 拖到 Applications 文件夹"
echo "4. 从启动台或 Applications 双击打开"
echo ""
echo "或直接复制 App 到 Applications:"
echo "  cp -r \"$APP_DIR\" /Applications/"

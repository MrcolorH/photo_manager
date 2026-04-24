import Cocoa

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var statusMenuItem: NSMenuItem!
    var showPageMenuItem: NSMenuItem!
    var projectPath: String = ""
    var appState: AppState = .starting
    let projectPathKey = "ProjectPath"
    
    enum AppState {
        case starting
        case running
        case error
    }
    
    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "📷"
        statusItem.button?.action = #selector(showMenu)
        
        let menu = NSMenu()
        
        statusMenuItem = NSMenuItem(title: "⏳ 启动中请稍后...", action: nil, keyEquivalent: "")
        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)
        
        menu.addItem(NSMenuItem.separator())
        
        showPageMenuItem = NSMenuItem(title: "显示主页面", action: #selector(showMainPage), keyEquivalent: "")
        showPageMenuItem.isEnabled = false
        menu.addItem(showPageMenuItem)
        
        menu.addItem(NSMenuItem.separator())
        
        let selectPathMenuItem = NSMenuItem(title: "重新选择项目路径...", action: #selector(selectProjectPath), keyEquivalent: "")
        menu.addItem(selectPathMenuItem)
        
        menu.addItem(NSMenuItem.separator())
        
        let quitMenuItem = NSMenuItem(title: "退出", action: #selector(quitApp), keyEquivalent: "q")
        menu.addItem(quitMenuItem)
        
        statusItem.menu = menu
        
        if !resolveProjectPath() {
            return
        }
        
        startServices()
        startHealthCheck()
    }
    
    func resolveProjectPath() -> Bool {
        let bundleURL = Bundle.main.bundleURL
        let autoDetectedPath = bundleURL.deletingLastPathComponent().path
        if isValidProjectPath(autoDetectedPath) {
            projectPath = autoDetectedPath
            return true
        }
        
        if let savedPath = UserDefaults.standard.string(forKey: projectPathKey) {
            if isValidProjectPath(savedPath) {
                projectPath = savedPath
                return true
            }
        }
        
        DispatchQueue.main.async {
            self.selectProjectPath()
        }
        return false
    }
    
    func isValidProjectPath(_ path: String) -> Bool {
        let fm = FileManager.default
        return fm.fileExists(atPath: path + "/start.sh")
            && fm.fileExists(atPath: path + "/stop.sh")
            && fm.fileExists(atPath: path + "/backend")
            && fm.fileExists(atPath: path + "/frontend")
    }
    
    @objc func selectProjectPath() {
        let openPanel = NSOpenPanel()
        openPanel.title = "选择相机管理后台项目文件夹"
        openPanel.message = "请选择包含 start.sh 和 stop.sh 的项目根目录"
        openPanel.canChooseDirectories = true
        openPanel.canChooseFiles = false
        openPanel.allowsMultipleSelection = false
        
        if let projectParentURL = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent() as URL? {
            openPanel.directoryURL = projectParentURL
        }
        
        let response = openPanel.runModal()
        
        if response == .OK, let url = openPanel.url {
            let selectedPath = url.path
            if isValidProjectPath(selectedPath) {
                projectPath = selectedPath
                UserDefaults.standard.set(selectedPath, forKey: projectPathKey)
                updateMenuStatus("✓ 路径已设置，正在启动...")
                startServices()
                startHealthCheck()
            } else {
                showAlert(title: "路径无效", message: "所选文件夹不包含 start.sh、stop.sh 或前后端目录。")
            }
        }
    }
    
    func startServices() {
        let task = Process()
        task.launchPath = projectPath + "/start.sh"
        do {
            try task.run()
        } catch {
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
                self.updateMenuStatus("❌ 启动超时")
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

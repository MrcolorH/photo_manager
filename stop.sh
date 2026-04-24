#!/bin/bash
# 相机管理后台停止脚本

stop_service() {
    local pid_file=$1
    local port=$2
    
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file" 2>/dev/null)
        if [ -n "$pid" ]; then
            # 先终止子进程（node/vite）
            pkill -P "$pid" 2>/dev/null
            # 再终止主进程（npm）
            kill "$pid" 2>/dev/null
            # 强制终止残留进程
            sleep 1
            kill -9 "$pid" 2>/dev/null
            pkill -9 -P "$pid" 2>/dev/null
        fi
        rm -f "$pid_file"
    fi
    
    # 兜底：按端口清理残留进程
    if lsof -i :"$port" > /dev/null 2>&1; then
        lsof -i :"$port" | grep LISTEN | awk '{print $2}' | xargs kill -9 2>/dev/null
    fi
}

# 停止后端（端口9901）
stop_service /tmp/camera-manager-backend.pid 9901

# 停止前端（端口9900）
stop_service /tmp/camera-manager-frontend.pid 9900

# 最终兜底：按进程名清理
pkill -f "node src/app.js" 2>/dev/null
pkill -f "vite --port 9900" 2>/dev/null

echo "[$(date)] 所有服务已停止" >> /tmp/camera-manager.log

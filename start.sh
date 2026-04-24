#!/bin/bash
# 相机管理后台快速启动脚本

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

LOG_FILE="/tmp/camera-manager.log"
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "[$(date)] 开始启动相机管理后台..." > "$LOG_FILE"

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "错误: 未找到 Node.js" >> "$LOG_FILE"
    exit 1
fi

echo "[$(date)] Node.js 路径: $(which node)" >> "$LOG_FILE"

# 完全并行启动后端和前端（同时启动）
(
  cd "$PROJECT_ROOT/backend"
  echo "[$(date)] 启动后端服务 (端口 9901)..." >> "$LOG_FILE"
  PORT=9901 nohup npm start >> "$LOG_FILE" 2>&1 &
  echo $! > /tmp/camera-manager-backend.pid
) &

(
  cd "$PROJECT_ROOT/frontend"
  echo "[$(date)] 启动前端服务 (端口 9900)..." >> "$LOG_FILE"
  nohup npm run dev -- --port 9900 >> "$LOG_FILE" 2>&1 &
  echo $! > /tmp/camera-manager-frontend.pid
) &

# 等待PID文件被写入
sleep 1

BACKEND_PID=$(cat /tmp/camera-manager-backend.pid 2>/dev/null)
FRONTEND_PID=$(cat /tmp/camera-manager-frontend.pid 2>/dev/null)

echo "[$(date)] 启动进程已创建 (后端: $BACKEND_PID, 前端: $FRONTEND_PID)" >> "$LOG_FILE"

#!/bin/bash

# 相机管理后台 - 一键停止脚本
# 双击此文件即可停止所有服务

echo "========================================="
echo "  相机管理后台 - 停止服务"
echo "========================================="
echo ""

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 读取后端端口配置
BACKEND_PORT=3001
if [ -f "$SCRIPT_DIR/backend/.env" ]; then
    BACKEND_PORT=$(grep '^PORT=' "$SCRIPT_DIR/backend/.env" | cut -d'=' -f2)
    if [ -z "$BACKEND_PORT" ]; then
        BACKEND_PORT=3001
    fi
fi

# 检测前端实际端口
FRONTEND_PORT=5173
# 从日志文件中提取实际端口（如果存在）
if [ -f /tmp/frontend.log ]; then
    DETECTED_PORT=$(grep -o 'Local:[[:space:]]*http://localhost:[0-9]*' /tmp/frontend.log 2>/dev/null | grep -o '[0-9]*$' | head -1)
    if [ -n "$DETECTED_PORT" ]; then
        FRONTEND_PORT=$DETECTED_PORT
    else
        # 如果日志中没有，检查常见端口
        for port in 5173 5174 5175 5176 5177; do
            if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
                if lsof -Pi :$port -sTCP:LISTEN -t 2>/dev/null | xargs ps -p 2>/dev/null | grep -q 'node\|vite'; then
                    FRONTEND_PORT=$port
                    break
                fi
            fi
        done
    fi
else
    # 没有日志文件，检查常见端口
    for port in 5173 5174 5175 5176 5177; do
        if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
            if lsof -Pi :$port -sTCP:LISTEN -t 2>/dev/null | xargs ps -p 2>/dev/null | grep -q 'node\|vite'; then
                FRONTEND_PORT=$port
                break
            fi
        fi
    done
fi

# 显示当前运行的服务
echo "🔍 检测运行中的服务..."
BACKEND_RUNNING=false
FRONTEND_RUNNING=false

if lsof -Pi :$BACKEND_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "   ✅ 后端服务运行中 (端口: $BACKEND_PORT)"
    BACKEND_RUNNING=true
else
    echo "   ❌ 后端服务未运行"
fi

if lsof -Pi :$FRONTEND_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "   ✅ 前端服务运行中 (端口: $FRONTEND_PORT)"
    FRONTEND_RUNNING=true
else
    echo "   ❌ 前端服务未运行"
fi

echo ""

# 如果没有服务运行，直接退出
if [ "$BACKEND_RUNNING" = false ] && [ "$FRONTEND_RUNNING" = false ]; then
    echo "⚠️  没有运行中的服务需要停止"
    echo ""
    echo "========================================="
    echo "  完成"
    echo "========================================="
    exit 0
fi

# 停止后端服务
if [ "$BACKEND_RUNNING" = true ]; then
    echo "🛑 正在停止后端服务 (端口: $BACKEND_PORT)..."
    pkill -f "nodemon src/app.js" 2>/dev/null
    pkill -f "node src/app.js" 2>/dev/null
    
    # 等待进程结束
    for i in {1..5}; do
        if ! lsof -Pi :$BACKEND_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
            break
        fi
        sleep 1
    done
    
    if ! lsof -Pi :$BACKEND_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo "✅ 后端服务已停止"
    else
        echo "⚠️  后端服务停止失败，尝试强制停止..."
        pkill -9 -f "node.*app.js" 2>/dev/null
        echo "✅ 后端服务已强制停止"
    fi
    echo ""
fi

# 停止前端服务
if [ "$FRONTEND_RUNNING" = true ]; then
    echo "🛑 正在停止前端服务 (端口: $FRONTEND_PORT)..."
    pkill -f "vite" 2>/dev/null
    pkill -f "npm run dev" 2>/dev/null
    
    # 等待进程结束
    for i in {1..5}; do
        if ! lsof -Pi :$FRONTEND_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
            break
        fi
        sleep 1
    done
    
    if ! lsof -Pi :$FRONTEND_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo "✅ 前端服务已停止"
    else
        echo "⚠️  前端服务停止失败，尝试强制停止..."
        pkill -9 -f "vite" 2>/dev/null
        echo "✅ 前端服务已强制停止"
    fi
    echo ""
fi

# 清理日志文件
if [ -f /tmp/backend.log ]; then
    rm -f /tmp/backend.log
fi
if [ -f /tmp/frontend.log ]; then
    rm -f /tmp/frontend.log
fi

echo "========================================="
echo "  所有服务已停止"
echo "========================================="

#!/bin/bash

# 相机管理后台 - 一键启动脚本（优化版）
# 双击此文件即可同时启动前后端服务

echo "========================================="
echo "  相机管理后台 - 启动服务"
echo "========================================="
echo ""

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 检查后端目录
if [ ! -d "$SCRIPT_DIR/backend" ]; then
    echo "❌ 错误：backend 目录不存在"
    exit 1
fi

# 检查前端目录
if [ ! -d "$SCRIPT_DIR/frontend" ]; then
    echo "❌ 错误：frontend 目录不存在"
    exit 1
fi

echo "📁 项目目录: $SCRIPT_DIR"
echo ""

# 读取后端端口配置
BACKEND_PORT=3001
if [ -f "$SCRIPT_DIR/backend/.env" ]; then
    BACKEND_PORT=$(grep '^PORT=' "$SCRIPT_DIR/backend/.env" | cut -d'=' -f2)
    if [ -z "$BACKEND_PORT" ]; then
        BACKEND_PORT=3001
    fi
fi

# 检查是否已有服务在运行
echo "🔍 检查现有服务..."
BACKEND_RUNNING=false
FRONTEND_RUNNING=false

if lsof -Pi :$BACKEND_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "✅ 后端服务已在端口 $BACKEND_PORT 运行"
    BACKEND_RUNNING=true
fi

if lsof -Pi :5173 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "✅ 前端服务已在端口 5173 运行"
    FRONTEND_RUNNING=true
fi

if [ "$BACKEND_RUNNING" = true ] && [ "$FRONTEND_RUNNING" = true ]; then
    echo ""
    echo "💡 提示：服务已经在运行，无需重新启动"
    echo "📌 前端地址: http://localhost:5173"
    echo "📌 后端地址: http://localhost:$BACKEND_PORT"
    exit 0
fi

echo ""

# 启动后端服务（如果未运行）
if [ "$BACKEND_RUNNING" = false ]; then
    echo "🚀 正在启动后端服务..."
    cd "$SCRIPT_DIR/backend"
    
    # 使用 node 直接启动（比 nodemon 更快）
    # 如果需要热重载，可以改回 npm run dev
    npm start > /tmp/backend.log 2>&1 &
    BACKEND_PID=$!
    echo "✅ 后端服务已启动 (PID: $BACKEND_PID)"
    echo ""
    
    # 等待后端启动（缩短等待时间）
    echo "⏳ 等待后端服务就绪..."
    for i in {1..10}; do
        if lsof -Pi :$BACKEND_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
            echo "✅ 后端服务已在端口 $BACKEND_PORT 上运行"
            break
        fi
        if [ $i -eq 10 ]; then
            echo "⚠️  后端服务启动超时，请检查日志"
            echo "📄 后端日志: /tmp/backend.log"
        fi
        sleep 0.5
    done
    echo ""
fi

# 启动前端服务（如果未运行）
if [ "$FRONTEND_RUNNING" = false ]; then
    echo "🚀 正在启动前端服务..."
    cd "$SCRIPT_DIR/frontend"
    npm run dev > /tmp/frontend.log 2>&1 &
    FRONTEND_PID=$!
    echo "✅ 前端服务已启动 (PID: $FRONTEND_PID)"
    echo ""
    
    # 等待前端启动（缩短等待时间）
    echo "⏳ 等待前端服务就绪..."
    FRONTEND_PORT=5173
    for i in {1..15}; do
        # 尝试从日志中提取实际端口
        if [ -f /tmp/frontend.log ]; then
            DETECTED_PORT=$(grep -o 'Local:[[:space:]]*http://localhost:[0-9]*' /tmp/frontend.log 2>/dev/null | grep -o '[0-9]*$' | head -1)
            
            if [ -z "$DETECTED_PORT" ]; then
                DETECTED_PORT=$(grep -o 'port [0-9]*' /tmp/frontend.log 2>/dev/null | grep -o '[0-9]*$' | head -1)
            fi
            
            if [ -n "$DETECTED_PORT" ]; then
                FRONTEND_PORT=$DETECTED_PORT
                echo "✅ 前端服务已在端口 $FRONTEND_PORT 上运行"
                break
            fi
        fi
        
        # 检查常见端口
        for port in 5173 5174 5175; do
            if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
                FRONTEND_PORT=$port
                echo "✅ 前端服务已在端口 $FRONTEND_PORT 上运行"
                break 2
            fi
        done
        
        if [ $i -eq 15 ]; then
            echo "⚠️  前端服务启动超时，使用默认端口 5173"
        fi
        sleep 0.5
    done
    echo ""
fi

echo "========================================="
echo "  服务启动成功！"
echo "========================================="
echo ""
echo "📌 后端地址: http://localhost:$BACKEND_PORT"
echo "📌 前端地址: http://localhost:$FRONTEND_PORT"
echo ""
echo "💡 提示："
echo "   - 在浏览器中打开 http://localhost:$FRONTEND_PORT 访问应用"
echo "   - 按 Ctrl+C 可停止所有服务"
echo "   - 后端日志: /tmp/backend.log"
echo "   - 前端日志: /tmp/frontend.log"
echo ""
echo "========================================="

# 等待用户按 Ctrl+C 停止
wait

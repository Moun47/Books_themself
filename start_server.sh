#!/bin/bash

# 一键启动电子书阅读器服务脚本

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# 切换到项目根目录
cd "$SCRIPT_DIR"

echo "📚 正在启动电子书阅读器服务..."

# 定义服务器地址和端口
SERVER_URL="http://127.0.0.1:8000"
PORT=8000

# 自动打开浏览器函数
open_browser() {
    echo "🌐 正在打开浏览器访问 $SERVER_URL..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        open "$SERVER_URL"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        if command -v xdg-open &> /dev/null; then
            xdg-open "$SERVER_URL"
        elif command -v gnome-open &> /dev/null; then
            gnome-open "$SERVER_URL"
        else
            echo "⚠️  无法自动打开浏览器，请手动访问 $SERVER_URL"
        fi
    elif [[ "$OSTYPE" == "msys"* || "$OSTYPE" == "cygwin"* ]]; then
        # Windows
        start "$SERVER_URL"
    else
        echo "⚠️  无法自动打开浏览器，请手动访问 $SERVER_URL"
    fi
}

# 检查端口是否被占用
check_port() {
    if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null ; then
        echo "❌ 端口 $PORT 已被占用，请关闭占用该端口的程序或使用其他端口"
        exit 1
    fi
}

# 检查端口
check_port

# 检查服务器是否就绪的函数
check_server_ready() {
    local max_attempts=10
    local attempt=1
    local delay=1
    
    echo "⏳ 等待服务器启动..."
    while [ $attempt -le $max_attempts ]; do
        if curl -s -o /dev/null -w "%{http_code}" $SERVER_URL > /dev/null 2>&1; then
            echo "✅ 服务器已就绪，正在打开浏览器..."
            return 0
        fi
        echo "   尝试 $attempt/$max_attempts：服务器未就绪，等待 $delay 秒..."
        sleep $delay
        attempt=$((attempt + 1))
    done
    
    echo "⚠️  服务器可能未正常启动，请手动访问 $SERVER_URL"
    return 1
}

# 启动服务器并自动打开浏览器
if command -v python3 &> /dev/null; then
    echo "✅ 使用 Python 3 启动本地服务器"
    python3 -m http.server $PORT --bind 127.0.0.1 &
    SERVER_PID=$!
elif command -v python &> /dev/null; then
    echo "✅ 使用 Python 2 启动本地服务器"
    python -m SimpleHTTPServer $PORT &
    SERVER_PID=$!
elif command -v npx &> /dev/null; then
    echo "✅ 使用 npx serve 启动本地服务器"
    npx serve -l $PORT &
    SERVER_PID=$!
elif command -v http-server &> /dev/null; then
    echo "✅ 使用 http-server 启动本地服务器"
    http-server -p $PORT &
    SERVER_PID=$!
else
    echo "❌ 未找到可用的 HTTP 服务器，请安装 Python 或 http-server"
    echo "   安装方法："
    echo "   - Python: 访问 https://www.python.org/downloads/ 下载安装"
    echo "   - http-server: npm install -g http-server"
    exit 1
fi

# 等待服务器启动
check_server_ready

# 打开浏览器
open_browser

# 等待服务器进程结束，保持脚本运行
echo "📡 服务器运行在 $SERVER_URL，按 Ctrl+C 停止服务"
wait $SERVER_PID
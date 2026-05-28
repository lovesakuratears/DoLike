#!/bin/bash
# 安装 DoLike Native Messaging Host
#
# 用法：
#   ./install.sh [extension_id]
#
# 如果不传 extension_id，清单文件中的 allowed_origins 将使用通配符

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_PATH="$SCRIPT_DIR/dolike_cookie_reader.py"
EXT_ID="${1:-*}"

# 确保 Python 脚本可执行
chmod +x "$HOST_PATH"

# 确定清单文件安装路径
if [[ "$(uname)" == "Darwin" ]]; then
    MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
else
    MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
fi

mkdir -p "$MANIFEST_DIR"

# 生成清单文件
MANIFEST_FILE="$MANIFEST_DIR/com.dolike.cookie_reader.json"
sed "s|NATIVE_HOST_PATH_PLACEHOLDER|$HOST_PATH|g" \
    "$SCRIPT_DIR/com.dolike.cookie_reader.json" | \
sed "s|chrome-extension://\\*/|chrome-extension://$EXT_ID/|g" \
    > "$MANIFEST_FILE"

echo "✅ Native Messaging Host 已安装"
echo "   清单文件：$MANIFEST_FILE"
echo "   脚本路径：$HOST_PATH"
echo "   Extension ID：$EXT_ID"
echo ""
echo "请确认已安装 Python 依赖："
echo "   pip3 install cryptography"
echo ""
echo "然后在 chrome://extensions/ 重新加载 DoLike 扩展即可使用方法4。"

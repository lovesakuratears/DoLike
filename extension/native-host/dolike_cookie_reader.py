#!/usr/bin/env python3
"""
DoLike Native Messaging Host — Cookie 读取器

通过 Chrome Native Messaging 协议与扩展通信，
直接读取 Chrome 的 Cookies SQLite 数据库，解密后返回。

使用方法：
1. 将本文件放在某个固定路径，如 /usr/local/bin/dolike_cookie_reader.py
2. 注册清单文件（见下方说明）
3. 在扩展中点击「方法4 Native」即可调用

macOS 清单文件注册路径：
  ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.dolike.cookie_reader.json

Linux 清单文件注册路径：
  ~/.config/google-chrome/NativeMessagingHosts/com.dolike.cookie_reader.json

清单文件内容示例（需修改 path 为实际路径）：
{
  "name": "com.dolike.cookie_reader",
  "description": "DoLike Cookie Reader",
  "path": "/usr/local/bin/dolike_cookie_reader.py",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://YOUR_EXTENSION_ID/"
  ]
}
"""

import sys
import os
import json
import struct
import sqlite3
import shutil
import tempfile
import subprocess
import platform

def get_chrome_cookie_path():
    """获取 Chrome Cookie 数据库路径"""
    system = platform.system()
    if system == 'Darwin':  # macOS
        base = os.path.expanduser('~/Library/Application Support/Google/Chrome')
    elif system == 'Linux':
        base = os.path.expanduser('~/.config/google-chrome')
    else:
        return None

    # 检查默认配置和所有 Profile
    profiles = ['Default']
    if os.path.isdir(os.path.join(base, 'Profile 1')):
        profiles.append('Profile 1')
    if os.path.isdir(os.path.join(base, 'Profile 2')):
        profiles.append('Profile 2')

    for profile in profiles:
        cookie_path = os.path.join(base, profile, 'Cookies')
        if os.path.exists(cookie_path):
            return cookie_path

    return None


def get_chrome_encryption_key():
    """从 macOS Keychain 或 Linux Secret Service 获取 Chrome 加密密钥"""
    system = platform.system()

    if system == 'Darwin':
        # macOS: 从 Keychain 读取
        try:
            result = subprocess.run(
                ['security', 'find-generic-password', '-w',
                 '-s', 'Chrome Safe Storage', '-a', 'Chrome'],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                password = result.stdout.strip()
                # Chrome on macOS 使用 PBKDF2 派生密钥
                import hashlib
                # Chrome 使用 'peanuts' 作为 salt，1003 次迭代
                key = hashlib.pbkdf2_hmac('sha1', password.encode('utf-8'),
                                          b'peanuts', 1003, 16)
                return key
        except Exception:
            pass

    elif system == 'Linux':
        # Linux: 尝试从 Secret Service 读取
        try:
            import secretstorage
            bus = secretstorage.dbus_init()
            collection = secretstorage.get_default_collection(bus)
            for item in collection.get_all_items():
                if item.get_label() == 'Chrome Safe Storage':
                    return item.get_secret()
        except Exception:
            pass

    # 回退：Chrome 在 Linux 上默认用 'peanuts' 作为密钥
    if system == 'Linux':
        import hashlib
        return hashlib.pbkdf2_hmac('sha1', b'peanuts', b'saltysalt', 1, 16)

    return None


def decrypt_cookie_value(encrypted_value, key):
    """解密 Chrome 加密的 Cookie 值"""
    if not encrypted_value:
        return ''

    # Chrome v80+ 使用 AES-256-GCM 加密，前缀为 'v10' (macOS) 或 'v11' (Windows)
    if encrypted_value[:3] in (b'v10', b'v11'):
        try:
            # 格式: v10/v11 + nonce(12 bytes) + ciphertext + tag(16 bytes)
            import hashlib
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM

            nonce = encrypted_value[3:15]
            ciphertext = encrypted_value[15:]

            aesgcm = AESGCM(key)
            decrypted = aesgcm.decrypt(nonce, ciphertext, None)
            return decrypted.decode('utf-8', errors='replace')
        except ImportError:
            # 如果没有 cryptography 库，返回提示
            return '[加密 — 请安装 cryptography: pip install cryptography]'
        except Exception as e:
            return f'[解密失败: {e}]'

    # 旧版 Chrome 直接存储（未加密）
    try:
        return encrypted_value.decode('utf-8', errors='replace')
    except Exception:
        return str(encrypted_value)


def read_cookies():
    """读取 Chrome Cookie 数据库"""
    cookie_path = get_chrome_cookie_path()
    if not cookie_path:
        return {
            'error': '未找到 Chrome Cookie 数据库。请确认 Chrome 已安装并至少登录过一次。',
            'cookies': []
        }

    # Chrome 可能锁定数据库，需要复制后读取
    tmp_path = None
    try:
        tmp_fd, tmp_path = tempfile.mkstemp(suffix='.db')
        os.close(tmp_fd)
        shutil.copy2(cookie_path, tmp_path)

        conn = sqlite3.connect(tmp_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Chrome cookies 表结构
        cursor.execute('''
            SELECT name, value, encrypted_value, host_key as domain, path,
                   is_secure as secure, is_httponly as http_only,
                   samesite, expires_utc as expiration_date
            FROM cookies
            ORDER BY host_key, name
        ''')

        rows = cursor.fetchall()
        conn.close()

        # 只返回 douyin.com 相关的 cookie
        cookies = []
        for row in rows:
            domain = row['domain'] or ''
            if 'douyin' not in domain and 'toutiao' not in domain:
                continue

            # 解密
            encrypted = row['encrypted_value']
            if encrypted and len(encrypted) > 3:
                key = get_chrome_encryption_key()
                value = decrypt_cookie_value(encrypted, key) if key else '[需要密钥]'
            else:
                value = row['value'] or ''

            # SameSite 转换
            samesite_map = {0: 'unspecified', 1: 'no_restriction', 2: 'lax', 3: 'strict'}

            cookies.append({
                'name': row['name'],
                'value': value,
                'domain': domain,
                'path': row['path'] or '/',
                'secure': bool(row['secure']),
                'httpOnly': bool(row['http_only']),
                'sameSite': samesite_map.get(row['sameSite'], 'unspecified'),
                'expirationDate': row['expiration_date'],
                'encrypted': bool(encrypted and len(encrypted) > 3)
            })

        return {
            'cookies': cookies,
            'source': cookie_path,
            'profilePath': os.path.dirname(cookie_path)
        }

    except sqlite3.Error as e:
        return {
            'error': f'SQLite 读取失败：{e}',
            'cookies': []
        }
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


# ─── Native Messaging 协议 ────────────────────────────────────────────

def read_message():
    """从 stdin 读取一条 Native Messaging 消息"""
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) < 4:
        return None
    length = struct.unpack('<I', raw_length)[0]
    raw_message = sys.stdin.buffer.read(length)
    if len(raw_message) < length:
        return None
    return json.loads(raw_message.decode('utf-8'))


def send_message(message):
    """向 stdout 发送一条 Native Messaging 消息"""
    encoded = json.dumps(message).encode('utf-8')
    length = struct.pack('<I', len(encoded))
    sys.stdout.buffer.write(length)
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def main():
    """主循环：读取请求，处理，返回结果"""
    while True:
        msg = read_message()
        if msg is None:
            break

        action = msg.get('action', '')

        if action == 'getAllCookies':
            result = read_cookies()
            send_message(result)
        elif action == 'ping':
            send_message({'status': 'ok', 'platform': platform.system()})
        else:
            send_message({'error': f'未知 action: {action}'})


if __name__ == '__main__':
    main()

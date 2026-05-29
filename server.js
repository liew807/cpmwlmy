const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');

const HTTP_PORT = 8080;
const HTTPS_PORT = 8443;
const app = express();

// ==================== 上传配置 ====================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const name = Date.now() + '-' + Math.random().toString(36).substr(2, 9) + '.ipa';
        cb(null, name);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 500 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        file.originalname.toLowerCase().endsWith('.ipa') ? cb(null, true) : cb(new Error('仅支持IPA'));
    }
});

// ==================== 数据存储 ====================
const ipaStore = new Map();

// ==================== 中间件 ====================
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/certs', express.static(path.join(__dirname, 'certs')));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

// ==================== 首页 ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== 上传IPA ====================
app.post('/upload', upload.single('ipa'), (req, res) => {
    try {
        if (!req.file) {
            return res.json({ success: false, message: '请选择IPA文件' });
        }

        const fileId = crypto.randomBytes(8).toString('hex');
        const appName = req.file.originalname.replace('.ipa', '');
        
        ipaStore.set(fileId, {
            id: fileId,
            originalName: req.file.originalname,
            appName: appName,
            fileName: req.file.filename,
            path: req.file.path,
            size: req.file.size,
            time: Date.now()
        });

        const host = req.hostname;

        res.json({
            success: true,
            data: {
                fileId,
                appName,
                fileName: req.file.originalname,
                fileSize: (req.file.size / 1024 / 1024).toFixed(2) + ' MB',
                installPageUrl: `https://${host}:${HTTPS_PORT}/install/${fileId}`
            }
        });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// ==================== 安装跳转页面（关键！触发iOS安装弹窗） ====================
app.get('/install/:fileId', (req, res) => {
    const fileId = req.params.fileId;
    const ipaInfo = ipaStore.get(fileId);
    
    if (!ipaInfo) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>错误</title>
                <style>
                    body { font-family: -apple-system; background:#000; color:#fff; display:flex; justify-content:center; align-items:center; height:100vh; margin:0; }
                    div { text-align:center; padding:30px; background:#1c1c1e; border-radius:20px; }
                    h2 { color:#ff3b30; }
                </style>
            </head>
            <body>
                <div>
                    <h2>❌ 文件不存在</h2>
                    <p>文件可能已过期，请重新上传</p>
                    <a href="/" style="color:#007aff;text-decoration:none;">返回首页</a>
                </div>
            </body>
            </html>
        `);
    }

    const host = req.hostname;
    const plistUrl = `https://${host}:${HTTPS_PORT}/plist/${fileId}`;
    const installUrl = `itms-services://?action=download-manifest&url=${encodeURIComponent(plistUrl)}`;

    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <title>安装 - ${ipaInfo.appName}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%);
            color: #fff;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 20px;
            text-align: center;
        }
        .card {
            background: rgba(255,255,255,0.08);
            backdrop-filter: blur(30px);
            border-radius: 30px;
            padding: 40px 25px;
            max-width: 350px;
            width: 100%;
            border: 1px solid rgba(255,255,255,0.1);
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        .app-icon {
            width: 70px;
            height: 70px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 18px;
            margin: 0 auto 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 35px;
            box-shadow: 0 10px 30px rgba(102,126,234,0.4);
        }
        h2 {
            font-size: 20px;
            font-weight: 700;
            margin-bottom: 8px;
            letter-spacing: -0.3px;
        }
        .version {
            font-size: 13px;
            color: rgba(255,255,255,0.5);
            margin-bottom: 25px;
        }
        .install-btn {
            display: block;
            width: 100%;
            padding: 16px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #fff;
            border: none;
            border-radius: 16px;
            font-size: 18px;
            font-weight: 700;
            cursor: pointer;
            text-decoration: none;
            box-shadow: 0 8px 25px rgba(102,126,234,0.4);
            transition: all 0.2s;
            margin-bottom: 15px;
        }
        .install-btn:active {
            transform: scale(0.96);
            opacity: 0.9;
        }
        .hint {
            font-size: 12px;
            color: rgba(255,255,255,0.4);
            line-height: 1.6;
        }
        .hint a {
            color: #667eea;
            text-decoration: none;
        }
        .spinner {
            display: none;
            width: 30px;
            height: 30px;
            border: 3px solid rgba(255,255,255,0.2);
            border-top-color: #fff;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin: 20px auto;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="card">
        <div class="app-icon">📱</div>
        <h2>${ipaInfo.appName}</h2>
        <div class="version">版本 1.0 · ${(ipaInfo.size / 1024 / 1024).toFixed(1)} MB</div>
        
        <a href="${installUrl}" class="install-btn" id="installBtn" onclick="handleInstall()">
            📲 安装到主屏幕
        </a>
        
        <div class="spinner" id="spinner"></div>
        
        <div class="hint">
            <p>点击按钮后，在弹出的对话框中</p>
            <p>点击<strong>「安装」</strong>即可</p>
            <p style="margin-top:10px;">
                安装后请前往<br>
                <strong>设置 > 通用 > VPN与设备管理</strong><br>
                信任企业证书
            </p>
            <p style="margin-top:10px;">
                <a href="/cert">📥 下载信任证书</a>
            </p>
        </div>
    </div>

    <script>
        function handleInstall() {
            document.getElementById('installBtn').textContent = '正在打开安装...';
            document.getElementById('spinner').style.display = 'block';
            
            // 3秒后恢复按钮
            setTimeout(() => {
                document.getElementById('installBtn').textContent = '📲 安装到主屏幕';
                document.getElementById('spinner').style.display = 'none';
            }, 3000);
        }

        // 自动尝试触发安装
        window.addEventListener('load', () => {
            // 延迟500ms自动触发
            setTimeout(() => {
                document.getElementById('installBtn').click();
            }, 500);
        });
    </script>
</body>
</html>
    `);
});

// ==================== 生成plist（iOS安装必需） ====================
app.get('/plist/:fileId', (req, res) => {
    const fileId = req.params.fileId;
    const ipaInfo = ipaStore.get(fileId);
    
    if (!ipaInfo) {
        return res.status(404).send('文件不存在');
    }

    const host = req.hostname;
    const ipaUrl = `https://${host}:${HTTPS_PORT}/ipa/${fileId}`;
    const bundleId = `com.ipa.installer.${fileId}`;

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>items</key>
    <array>
        <dict>
            <key>assets</key>
            <array>
                <dict>
                    <key>kind</key>
                    <string>software-package</string>
                    <key>url</key>
                    <string>${ipaUrl}</string>
                </dict>
            </array>
            <key>metadata</key>
            <dict>
                <key>bundle-identifier</key>
                <string>${bundleId}</string>
                <key>bundle-version</key>
                <string>1.0</string>
                <key>kind</key>
                <string>software</string>
                <key>title</key>
                <string>${ipaInfo.appName}</string>
            </dict>
        </dict>
    </array>
</dict>
</plist>`;

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(plist);
});

// ==================== 下载IPA文件 ====================
app.get('/ipa/:fileId', (req, res) => {
    const fileId = req.params.fileId;
    const ipaInfo = ipaStore.get(fileId);
    
    if (!ipaInfo || !fs.existsSync(ipaInfo.path)) {
        return res.status(404).send('文件不存在');
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(ipaInfo.originalName)}"`);
    res.setHeader('Content-Length', ipaInfo.size);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Accept-Ranges', 'bytes');
    
    const stream = fs.createReadStream(ipaInfo.path);
    stream.on('error', () => {
        if (!res.headersSent) res.status(500).send('读取错误');
    });
    stream.pipe(res);
});

// ==================== 下载证书 ====================
app.get('/cert', (req, res) => {
    const certPath = path.join(__dirname, 'certs', 'ca.crt');
    if (fs.existsSync(certPath)) {
        res.download(certPath, 'IPA-Server-CA.crt');
    } else {
        res.status(404).send('证书不存在，请先运行: npm run cert');
    }
});

// ==================== 下载配置文件 ====================
app.get('/profile', (req, res) => {
    const profilePath = path.join(__dirname, 'certs', 'trust-profile.mobileconfig');
    if (fs.existsSync(profilePath)) {
        res.setHeader('Content-Type', 'application/x-apple-aspen-config');
        res.download(profilePath, 'trust-profile.mobileconfig');
    } else {
        res.status(404).send('配置文件不存在');
    }
});

// ==================== 启动服务器 ====================

http.createServer(app).listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`\n🌐 HTTP服务器: http://0.0.0.0:${HTTP_PORT}`);
    console.log(`📱 证书下载: http://0.0.0.0:${HTTP_PORT}/cert\n`);
});

const certsDir = path.join(__dirname, 'certs');
const keyPath = path.join(certsDir, 'server.key');
const certPath = path.join(certsDir, 'server.crt');

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const httpsOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
    };
    
    https.createServer(httpsOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => {
        console.log(`🔒 HTTPS服务器: https://0.0.0.0:${HTTPS_PORT}`);
        console.log(`✅ 服务器启动完成！\n`);
    });
} else {
    console.log('⚠️  未找到证书！请先运行: npm run cert\n');
}

// 定时清理
setInterval(() => {
    const now = Date.now();
    for (const [id, info] of ipaStore) {
        if (now - info.time > 3600000) {
            if (fs.existsSync(info.path)) fs.unlinkSync(info.path);
            ipaStore.delete(id);
        }
    }
}, 300000);

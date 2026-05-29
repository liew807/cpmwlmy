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

// CORS 跨域
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

        // 获取服务器地址（自动检测）
        const host = req.hostname;
        const ipaUrl = `https://${host}:${HTTPS_PORT}/ipa/${fileId}`;
        const plistUrl = `https://${host}:${HTTPS_PORT}/plist/${fileId}`;
        const installUrl = `itms-services://?action=download-manifest&url=${encodeURIComponent(plistUrl)}`;

        res.json({
            success: true,
            data: {
                fileId,
                appName,
                fileName: req.file.originalname,
                fileSize: (req.file.size / 1024 / 1024).toFixed(2) + ' MB',
                installUrl: installUrl,
                plistUrl: plistUrl,
                ipaUrl: ipaUrl
            }
        });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// ==================== 生成plist（iOS安装必需） ====================
app.get('/plist/:fileId', (req, res) => {
    const fileId = req.params.fileId;
    const ipaInfo = ipaStore.get(fileId);
    
    if (!ipaInfo) {
        return res.status(404).send('文件不存在或已过期');
    }

    const host = req.hostname;
    const ipaUrl = `https://${host}:${HTTPS_PORT}/ipa/${fileId}`;
    const bundleId = `com.ipa.${fileId}`;

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
                <dict>
                    <key>kind</key>
                    <string>display-image</string>
                    <key>url</key>
                    <string>https://${host}:${HTTPS_PORT}/icon.png</string>
                </dict>
                <dict>
                    <key>kind</key>
                    <string>full-size-image</string>
                    <key>url</key>
                    <string>https://${host}:${HTTPS_PORT}/icon.png</string>
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
        return res.status(404).send('文件不存在或已过期');
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(ipaInfo.originalName)}"`);
    res.setHeader('Content-Length', ipaInfo.size);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Accept-Ranges', 'bytes');
    
    const stream = fs.createReadStream(ipaInfo.path);
    stream.on('error', (err) => {
        console.error('文件读取错误:', err);
        if (!res.headersSent) {
            res.status(500).send('文件读取错误');
        }
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

// HTTP服务器
http.createServer(app).listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`\n🌐 HTTP服务器: http://0.0.0.0:${HTTP_PORT}`);
    console.log(`📱 证书下载: http://0.0.0.0:${HTTP_PORT}/cert\n`);
});

// HTTPS服务器
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
        console.log(`📲 iOS安装链接: itms-services://?action=download-manifest&url=https://你的IP:${HTTPS_PORT}/plist/文件ID`);
        console.log(`\n✅ 服务器启动完成！\n`);
    });
} else {
    console.log('⚠️  未找到证书！请先运行: npm run cert\n');
}

// ==================== 定时清理 ====================
setInterval(() => {
    const now = Date.now();
    for (const [id, info] of ipaStore) {
        if (now - info.time > 3600000) {
            if (fs.existsSync(info.path)) fs.unlinkSync(info.path);
            ipaStore.delete(id);
        }
    }
}, 300000);

console.log('💡 提示：iPhone访问请使用HTTPS地址\n');

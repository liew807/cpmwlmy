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

// ==================== 路由 ====================

// 首页
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 上传IPA
app.post('/upload', upload.single('ipa'), (req, res) => {
    try {
        if (!req.file) {
            return res.json({ success: false, message: '请选择IPA文件' });
        }

        const fileId = crypto.randomBytes(8).toString('hex');
        const ipaUrl = `/ipa/${fileId}`;
        
        ipaStore.set(fileId, {
            id: fileId,
            originalName: req.file.originalname,
            fileName: req.file.filename,
            path: req.file.path,
            size: req.file.size,
            ipaUrl: ipaUrl,
            installUrl: `itms-services://?action=download-manifest&url=${encodeURIComponent(`https://${req.hostname}:${HTTPS_PORT}/plist/${fileId}`)}`,
            time: Date.now()
        });

        res.json({
            success: true,
            data: {
                fileId,
                fileName: req.file.originalname,
                fileSize: (req.file.size / 1024 / 1024).toFixed(2) + ' MB',
                ipaUrl,
                installUrl: ipaStore.get(fileId).installUrl
            }
        });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// 生成plist清单文件（iOS安装必需）
app.get('/plist/:fileId', (req, res) => {
    const fileId = req.params.fileId;
    const ipaInfo = ipaStore.get(fileId);
    
    if (!ipaInfo) {
        return res.status(404).json({ error: '文件不存在' });
    }

    const host = req.hostname;
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
                    <string>https://${host}:${HTTPS_PORT}/ipa/${fileId}</string>
                </dict>
            </array>
            <key>metadata</key>
            <dict>
                <key>bundle-identifier</key>
                <string>com.ipa.installer</string>
                <key>bundle-version</key>
                <string>1.0</string>
                <key>kind</key>
                <string>software</string>
                <key>title</key>
                <string>${ipaInfo.originalName.replace('.ipa', '')}</string>
            </dict>
        </dict>
    </array>
</dict>
</plist>`;

    res.setHeader('Content-Type', 'application/xml');
    res.send(plist);
});

// 下载IPA文件
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
    
    const stream = fs.createReadStream(ipaInfo.path);
    stream.pipe(res);
});

// 下载证书
app.get('/cert', (req, res) => {
    const certPath = path.join(__dirname, 'certs', 'ca.crt');
    if (fs.existsSync(certPath)) {
        res.download(certPath, 'IPA-Server-CA.crt');
    } else {
        res.status(404).send('证书不存在，请先运行: npm run cert');
    }
});

// 下载iOS配置文件
app.get('/profile', (req, res) => {
    const profilePath = path.join(__dirname, 'certs', 'trust-profile.mobileconfig');
    if (fs.existsSync(profilePath)) {
        res.setHeader('Content-Type', 'application/x-apple-aspen-config');
        res.download(profilePath, 'trust-profile.mobileconfig');
    } else {
        res.status(404).send('配置文件不存在');
    }
});

// 文件列表
app.get('/files', (req, res) => {
    const files = [];
    ipaStore.forEach((value, key) => {
        files.push({
            id: key,
            name: value.originalName,
            size: (value.size / 1024 / 1024).toFixed(2) + ' MB',
            time: new Date(value.time).toLocaleString()
        });
    });
    res.json({ success: true, files });
});

// ==================== 启动服务器 ====================

// HTTP服务器
http.createServer(app).listen(HTTP_PORT, () => {
    console.log(`\n🌐 HTTP服务器: http://localhost:${HTTP_PORT}`);
    console.log(`📱 证书下载: http://localhost:${HTTP_PORT}/cert`);
    console.log(`📋 配置文件: http://localhost:${HTTP_PORT}/profile\n`);
});

// HTTPS服务器（用于iOS安装）
const certsDir = path.join(__dirname, 'certs');
const keyPath = path.join(certsDir, 'server.key');
const certPath = path.join(certsDir, 'server.crt');

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const httpsOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
    };
    
    https.createServer(httpsOptions, app).listen(HTTPS_PORT, () => {
        console.log(`🔒 HTTPS服务器: https://localhost:${HTTPS_PORT}`);
        console.log(`📱 iOS安装需要HTTPS，请使用此地址\n`);
    });
} else {
    console.log('⚠️  未找到证书，请先运行: npm run cert');
    console.log('⚠️  iOS安装需要HTTPS，请先生成证书\n');
}

// 定时清理（1小时后）
setInterval(() => {
    const now = Date.now();
    for (const [id, info] of ipaStore) {
        if (now - info.time > 3600000) {
            if (fs.existsSync(info.path)) fs.unlinkSync(info.path);
            ipaStore.delete(id);
        }
    }
}, 300000);

console.log('✅ 服务器启动完成！');
console.log('💡 提示：iOS设备安装需要先信任证书\n');

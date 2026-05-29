const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// 配置文件上传
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + '.ipa';
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.originalname.toLowerCase().endsWith('.ipa')) {
            cb(null, true);
        } else {
            cb(new Error('只支持IPA文件格式！'));
        }
    },
    limits: {
        fileSize: 500 * 1024 * 1024 // 500MB
    }
});

// 中间件
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 存储上传文件信息
const fileStore = new Map();

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
        fileStore.set(fileId, {
            originalName: req.file.originalname,
            fileName: req.file.filename,
            path: req.file.path,
            size: req.file.size,
            time: Date.now()
        });

        res.json({
            success: true,
            fileId: fileId,
            fileName: req.file.originalname,
            size: (req.file.size / 1024 / 1024).toFixed(2) + ' MB'
        });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// 下载IPA（兼容所有iOS版本）
app.get('/download/:fileId', (req, res) => {
    const fileId = req.params.fileId;
    const fileInfo = fileStore.get(fileId);

    if (!fileInfo || !fs.existsSync(fileInfo.path)) {
        return res.status(404).send('文件不存在');
    }

    // 关键：设置正确的MIME类型，确保iOS识别
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileInfo.originalName)}"`);
    res.setHeader('Content-Length', fileInfo.size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const stream = fs.createReadStream(fileInfo.path);
    stream.pipe(res);
});

// 定时清理（1小时后）
setInterval(() => {
    const now = Date.now();
    for (const [id, info] of fileStore) {
        if (now - info.time > 3600000) {
            if (fs.existsSync(info.path)) {
                fs.unlinkSync(info.path);
            }
            fileStore.delete(id);
        }
    }
}, 300000);

app.listen(PORT, () => {
    console.log(`服务器启动: http://localhost:${PORT}`);
});

const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 确保 downloads 目录存在
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

// 解析并下载接口
app.post('/api/parse', (req, res) => {
  const { url, format } = req.body;

  if (!url) {
    return res.status(400).json({ message: '缺少链接' });
  }

  // 简单校验链接
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return res.status(400).json({ message: '链接格式不正确' });
    }
  } catch {
    return res.status(400).json({ message: '链接格式不正确' });
  }

  const id = Date.now();
  const outTemplate = path.join(downloadsDir, `${id}.%(ext)s`);

  // 根据格式构造 yt-dlp 命令
  let cmd;
  if (format === 'mp3') {
    // 提取音频并转成 mp3
    cmd = `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${outTemplate}" "${url}"`;
  } else {
    // 下载 mp4 视频，优先选 mp4 格式
    cmd = `yt-dlp -f "best[ext=mp4]/best" -o "${outTemplate}" "${url}"`;
  }

  console.log('执行命令:', cmd);

  exec(cmd, { timeout: 180000, maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
    if (err) {
      console.error('下载失败:', stderr || err.message);
      return res.status(500).json({
        message: '解析失败，链接可能不支持或需要登录'
      });
    }

    // 找到生成的文件
    const files = fs.readdirSync(downloadsDir).filter(f => f.startsWith(String(id)));

    if (!files.length) {
      return res.status(500).json({ message: '未生成文件' });
    }

    const filename = files[0];
    console.log('生成文件:', filename);

    res.json({
      downloadUrl: `/downloads/${filename}`,
      filename
    });
  });
});

// 下载静态文件
app.use('/downloads', express.static(downloadsDir));

// 定时清理：删除 1 小时前的文件（可选）
setInterval(() => {
  const now = Date.now();
  fs.readdir(downloadsDir, (err, files) => {
    if (err) return;
    files.forEach(f => {
      const fp = path.join(downloadsDir, f);
      fs.stat(fp, (err, stat) => {
        if (err) return;
        if (now - stat.mtimeMs > 3600 * 1000) {
          fs.unlink(fp, () => {});
        }
      });
    });
  });
}, 10 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`✅ 服务已启动: http://localhost:${PORT}`);
});

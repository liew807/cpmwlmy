const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

const certsDir = path.join(__dirname, 'certs');
if (!fs.existsSync(certsDir)) {
    fs.mkdirSync(certsDir, { recursive: true });
}

console.log('🔐 正在生成自签名证书...\n');

// 生成密钥对
const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();

cert.publicKey = keys.publicKey;
cert.serialNumber = Date.now().toString(16);

const now = new Date();
cert.validity.notBefore = now;
cert.validity.notAfter = new Date(now.getFullYear() + 10, now.getMonth(), now.getDate());

const attrs = [
    { name: 'commonName', value: 'IPA Installer CA' },
    { name: 'organizationName', value: 'IPA Server' },
    { name: 'organizationalUnitName', value: 'Development' },
    { name: 'countryName', value: 'CN' }
];

cert.setSubject(attrs);
cert.setIssuer(attrs);

cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, digitalSignature: true },
    { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
    { 
        name: 'subjectAltName', 
        altNames: [
            { type: 2, value: 'localhost' },
            { type: 2, value: '*.local' },
            { type: 7, ip: '127.0.0.1' },
            { type: 7, ip: '0.0.0.0' }
        ] 
    }
]);

cert.sign(keys.privateKey, forge.md.sha256.create());

// 保存证书和私钥
const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
const certPem = forge.pki.certificateToPem(cert);

fs.writeFileSync(path.join(certsDir, 'ca.key'), privateKeyPem);
fs.writeFileSync(path.join(certsDir, 'ca.crt'), certPem);
fs.writeFileSync(path.join(certsDir, 'server.key'), privateKeyPem);
fs.writeFileSync(path.join(certsDir, 'server.crt'), certPem);

// 生成iOS配置文件
const mobileConfig = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>PayloadCertificateFileName</key>
            <string>IPA-Server-CA.crt</string>
            <key>PayloadContent</key>
            <data>${Buffer.from(certPem).toString('base64')}</data>
            <key>PayloadDescription</key>
            <string>IPA安装服务器证书</string>
            <key>PayloadDisplayName</key>
            <string>IPA Server CA</string>
            <key>PayloadIdentifier</key>
            <string>com.ipa.server.ca</string>
            <key>PayloadType</key>
            <string>com.apple.security.root</string>
            <key>PayloadUUID</key>
            <string>${crypto.randomUUID()}</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
        </dict>
    </array>
    <key>PayloadDescription</key>
    <string>安装此证书以信任IPA服务器</string>
    <key>PayloadDisplayName</key>
    <string>IPA Server 证书</string>
    <key>PayloadIdentifier</key>
    <string>com.ipa.server.profile</string>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>${crypto.randomUUID()}</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>`;

fs.writeFileSync(path.join(certsDir, 'trust-profile.mobileconfig'), mobileConfig);

console.log('✅ 证书生成成功！');
console.log('📁 证书位置:', certsDir);
console.log('📜 CA证书: ca.crt');
console.log('📱 iOS配置文件: trust-profile.mobileconfig');
console.log('\n📱 在iPhone上信任证书：');
console.log('方法1: 将 ca.crt 发送到iPhone，点击安装');
console.log('方法2: 访问 http://你的IP:8080/cert 下载配置文件');
console.log('然后: 设置 > 通用 > VPN与设备管理 > 安装证书');
console.log('最后: 设置 > 通用 > 关于本机 > 证书信任设置 > 开启信任\n');

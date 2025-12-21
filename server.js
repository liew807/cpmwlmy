require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 静态文件服务 - 提供前端HTML页面
app.use(express.static('public'));

// 处理所有路由，都返回前端页面
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 数据库配置
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'cpmwl_store',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// 创建数据库连接池
const pool = mysql.createPool(dbConfig);

// 初始化数据库表（只创建表结构，不包含API）
async function initializeDatabase() {
  try {
    const connection = await pool.getConnection();
    
    console.log('开始初始化数据库...');
    
    // 创建用户表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        points INT DEFAULT 99,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ 用户表已创建');
    
    // 创建商品表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        description TEXT,
        image_url VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ 商品表已创建');
    
    // 创建订单表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(50) PRIMARY KEY,
        user_id INT NOT NULL,
        total_amount DECIMAL(10, 2) NOT NULL,
        point_discount DECIMAL(10, 2) DEFAULT 0,
        final_amount DECIMAL(10, 2) NOT NULL,
        status ENUM('pending', 'paid', 'shipped', 'completed', 'cancelled') DEFAULT 'pending',
        payment_method VARCHAR(50),
        tng_reference VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ 订单表已创建');
    
    // 创建订单商品表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id VARCHAR(50) NOT NULL,
        product_name VARCHAR(100) NOT NULL,
        product_price DECIMAL(10, 2) NOT NULL,
        quantity INT NOT NULL,
        coupon_code VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ 订单商品表已创建');
    
    // 创建优惠券表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS coupons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        type VARCHAR(20) NOT NULL,
        discount_value DECIMAL(10, 2),
        is_used BOOLEAN DEFAULT FALSE,
        user_id INT,
        purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        used_at TIMESTAMP NULL
      )
    `);
    console.log('✓ 优惠券表已创建');
    
    // 创建积分记录表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS point_transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        points INT NOT NULL,
        type ENUM('earn', 'redeem', 'register_bonus', 'purchase_earn') NOT NULL,
        description VARCHAR(255),
        order_id VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ 积分记录表已创建');
    
    // 创建后台管理表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS admin_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        admin_id INT NOT NULL,
        action VARCHAR(50) NOT NULL,
        target_type VARCHAR(50),
        target_id VARCHAR(100),
        details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ 后台管理表已创建');
    
    connection.release();
    
    // 检查并创建默认管理员（如果不存在）
    try {
      const [adminRows] = await pool.execute(
        'SELECT * FROM users WHERE username = ?',
        ['CPMWLADMIN']
      );
      
      if (adminRows.length === 0) {
        await pool.execute(
          'INSERT INTO users (username, password, phone, points) VALUES (?, ?, ?, ?)',
          ['CPMWLADMIN', 'WLCY1111', '', 9999]
        );
        console.log('✓ 默认管理员账户已创建: CPMWLADMIN / WLCY1111');
      }
    } catch (error) {
      console.log('⚠️ 跳过管理员创建（表可能为空）');
    }
    
    // 添加示例商品（如果表为空）
    try {
      const [productRows] = await pool.execute('SELECT COUNT(*) as count FROM products');
      if (productRows[0].count === 0) {
        const sampleProducts = [
          ['汽车涂装 A', 99.99, '高级汽车涂装服务'],
          ['摩托车涂装 B', 79.99, '摩托车专业涂装'],
          ['自行车涂装 C', 49.99, '自行车定制涂装'],
          ['金属涂装 D', 129.99, '金属表面专业处理'],
          ['塑料涂装 E', 69.99, '塑料材质涂装服务']
        ];
        
        for (const product of sampleProducts) {
          await pool.execute(
            'INSERT INTO products (name, price, description) VALUES (?, ?, ?)',
            product
          );
        }
        console.log('✓ 5个示例商品已添加');
      }
    } catch (error) {
      console.log('⚠️ 跳过示例商品添加');
    }
    
    console.log('========================================');
    console.log('数据库初始化完成！');
    console.log('========================================');
    console.log('数据库配置信息:');
    console.log(`- 主机: ${dbConfig.host}`);
    console.log(`- 数据库: ${dbConfig.database}`);
    console.log(`- 用户名: ${dbConfig.user}`);
    console.log('========================================');
    
  } catch (error) {
    console.error('❌ 数据库初始化失败:', error.message);
    console.log('请检查:');
    console.log('1. MySQL服务是否运行');
    console.log('2. 数据库用户密码是否正确');
    console.log('3. 数据库是否存在');
  }
}

// 启动服务器
async function startServer() {
  try {
    // 初始化数据库
    await initializeDatabase();
    
    // 启动Web服务器
    app.listen(PORT, () => {
      console.log('\n========================================');
      console.log(`🚀 服务器启动成功！`);
      console.log(`🌐 访问地址: http://localhost:${PORT}`);
      console.log(`📁 静态文件目录: ./public/`);
      console.log('========================================');
      console.log('\n前端功能说明:');
      console.log('- 使用LocalStorage存储数据');
      console.log('- 支持用户注册/登录');
      console.log('- 支持商品管理');
      console.log('- 支持购物车功能');
      console.log('- 支持订单管理');
      console.log('- 支持优惠券系统');
      console.log('========================================');
    });
  } catch (error) {
    console.error('❌ 服务器启动失败:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;

require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

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

// 验证Token的中间件
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: '访问被拒绝' });
  }
  
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET || 'cpmwl_secret_key');
    const [rows] = await pool.execute(
      'SELECT id, username, phone, points FROM users WHERE id = ?',
      [user.id]
    );
    
    if (rows.length === 0) {
      return res.status(401).json({ error: '用户不存在' });
    }
    
    req.user = rows[0];
    next();
  } catch (error) {
    return res.status(403).json({ error: '无效的token' });
  }
};

// 初始化数据库表
async function initializeDatabase() {
  try {
    const connection = await pool.getConnection();
    
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    
    // 创建订单商品表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id VARCHAR(50) NOT NULL,
        product_name VARCHAR(100) NOT NULL,
        product_price DECIMAL(10, 2) NOT NULL,
        quantity INT NOT NULL,
        coupon_code VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
      )
    `);
    
    // 创建优惠券表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS coupons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        type VARCHAR(20) NOT NULL, -- '10%', '20%', 'RMxxx'
        discount_value DECIMAL(10, 2),
        is_used BOOLEAN DEFAULT FALSE,
        user_id INT,
        purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        used_at TIMESTAMP NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    
    // 创建积分记录表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS point_transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        points INT NOT NULL,
        type ENUM('earn', 'redeem', 'register_bonus', 'purchase_earn') NOT NULL,
        description VARCHAR(255),
        order_id VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
      )
    `);
    
    // 创建后台管理表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS admin_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        admin_id INT NOT NULL,
        action VARCHAR(50) NOT NULL,
        target_type VARCHAR(50),
        target_id VARCHAR(100),
        details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    
    connection.release();
    
    // 检查并创建默认管理员
    const [adminRows] = await pool.execute(
      'SELECT * FROM users WHERE username = ?',
      ['CPMWLADMIN']
    );
    
    if (adminRows.length === 0) {
      const hashedPassword = await bcrypt.hash('WLCY1111', 10);
      await pool.execute(
        'INSERT INTO users (username, password, phone, points) VALUES (?, ?, ?, ?)',
        ['CPMWLADMIN', hashedPassword, '', 9999]
      );
      console.log('默认管理员账户已创建');
    }
    
    // 添加一些示例商品
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
      console.log('示例商品已添加');
    }
    
    console.log('数据库初始化完成');
  } catch (error) {
    console.error('数据库初始化失败:', error);
  }
}

// ============ API 路由 ============

// 1. 用户认证相关
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, phone } = req.body;
    
    // 验证输入
    if (!username || !password || !phone) {
      return res.status(400).json({ error: '请填写所有字段' });
    }
    
    if (!/^\+601\d{8,9}$/.test(phone)) {
      return res.status(400).json({ error: '电话号码格式错误' });
    }
    
    // 检查用户名是否已存在
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE username = ?',
      [username]
    );
    
    if (existingUsers.length > 0) {
      return res.status(400).json({ error: '用户名已存在' });
    }
    
    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // 创建用户
    const [result] = await pool.execute(
      'INSERT INTO users (username, password, phone, points) VALUES (?, ?, ?, ?)',
      [username, hashedPassword, phone, 99]
    );
    
    // 创建注册积分记录
    await pool.execute(
      'INSERT INTO point_transactions (user_id, points, type, description) VALUES (?, ?, ?, ?)',
      [result.insertId, 99, 'register_bonus', '注册奖励']
    );
    
    // 生成JWT token
    const token = jwt.sign(
      { id: result.insertId, username },
      process.env.JWT_SECRET || 'cpmwl_secret_key',
      { expiresIn: '7d' }
    );
    
    res.status(201).json({
      message: '注册成功',
      user: { id: result.insertId, username, phone, points: 99 },
      token
    });
  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // 查找用户
    const [users] = await pool.execute(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );
    
    if (users.length === 0) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    
    const user = users[0];
    
    // 验证密码
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    
    // 生成JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET || 'cpmwl_secret_key',
      { expiresIn: '7d' }
    );
    
    res.json({
      message: '登录成功',
      user: {
        id: user.id,
        username: user.username,
        phone: user.phone,
        points: user.points
      },
      token
    });
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.execute(
      'SELECT id, username, phone, points FROM users WHERE id = ?',
      [req.user.id]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }
    
    res.json({ user: users[0] });
  } catch (error) {
    console.error('获取资料错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 2. 商品相关
app.get('/api/products', async (req, res) => {
  try {
    const [products] = await pool.execute(
      'SELECT id, name, price, description, image_url FROM products ORDER BY id DESC'
    );
    res.json(products);
  } catch (error) {
    console.error('获取商品错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

app.post('/api/products', authenticateToken, async (req, res) => {
  try {
    // 检查是否为管理员
    if (req.user.username !== 'CPMWLADMIN') {
      return res.status(403).json({ error: '无权限操作' });
    }
    
    const { name, price, description } = req.body;
    
    if (!name || !price) {
      return res.status(400).json({ error: '请填写名称和价格' });
    }
    
    const [result] = await pool.execute(
      'INSERT INTO products (name, price, description) VALUES (?, ?, ?)',
      [name, parseFloat(price), description || '']
    );
    
    // 记录管理日志
    await pool.execute(
      'INSERT INTO admin_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'create_product', 'product', result.insertId, `创建商品: ${name}, 价格: RM${price}`]
    );
    
    res.status(201).json({
      message: '商品添加成功',
      product: {
        id: result.insertId,
        name,
        price: parseFloat(price),
        description: description || ''
      }
    });
  } catch (error) {
    console.error('添加商品错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

app.delete('/api/products/:id', authenticateToken, async (req, res) => {
  try {
    // 检查是否为管理员
    if (req.user.username !== 'CPMWLADMIN') {
      return res.status(403).json({ error: '无权限操作' });
    }
    
    const productId = req.params.id;
    
    const [result] = await pool.execute(
      'DELETE FROM products WHERE id = ?',
      [productId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '商品不存在' });
    }
    
    // 记录管理日志
    await pool.execute(
      'INSERT INTO admin_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'delete_product', 'product', productId, '删除商品']
    );
    
    res.json({ message: '商品删除成功' });
  } catch (error) {
    console.error('删除商品错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 3. 购物车和订单相关
app.post('/api/cart/add', authenticateToken, async (req, res) => {
  try {
    const { productId, quantity } = req.body;
    
    if (!productId || !quantity || quantity <= 0) {
      return res.status(400).json({ error: '无效的商品数量' });
    }
    
    // 获取商品信息
    const [products] = await pool.execute(
      'SELECT id, name, price FROM products WHERE id = ?',
      [productId]
    );
    
    if (products.length === 0) {
      return res.status(404).json({ error: '商品不存在' });
    }
    
    const product = products[0];
    const cartItem = {
      product: {
        id: product.id,
        name: product.name,
        price: product.price
      },
      quantity
    };
    
    // 在实际应用中，这里应该将购物车保存到数据库或Redis
    // 这里简化处理，直接返回商品信息
    
    res.json({
      message: '商品已加入购物车',
      cartItem,
      total: product.price * quantity
    });
  } catch (error) {
    console.error('添加购物车错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

app.post('/api/orders/create', authenticateToken, async (req, res) => {
  try {
    const { items, pointDiscount, paymentMethod } = req.body;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: '购物车为空' });
    }
    
    // 计算总额
    let totalAmount = 0;
    for (const item of items) {
      totalAmount += item.product.price * item.quantity;
    }
    
    const pointDiscountAmount = pointDiscount || 0;
    const finalAmount = totalAmount - pointDiscountAmount;
    
    // 生成订单号
    const orderId = `#CPMWL${Date.now()}${Math.floor(Math.random() * 1000)}`;
    
    // 开始事务
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // 创建订单
      await connection.execute(
        'INSERT INTO orders (id, user_id, total_amount, point_discount, final_amount, payment_method, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [orderId, req.user.id, totalAmount, pointDiscountAmount, finalAmount, paymentMethod || 'tng', 'pending']
      );
      
      // 添加订单商品
      for (const item of items) {
        await connection.execute(
          'INSERT INTO order_items (order_id, product_name, product_price, quantity, coupon_code) VALUES (?, ?, ?, ?, ?)',
          [orderId, item.product.name, item.product.price, item.quantity, item.product.code || null]
        );
      }
      
      // 如果使用了积分，扣除积分
      if (pointDiscountAmount > 0) {
        const pointsUsed = pointDiscountAmount * 100; // 1 RM = 100积分
        await connection.execute(
          'UPDATE users SET points = points - ? WHERE id = ?',
          [pointsUsed, req.user.id]
        );
        
        // 记录积分使用
        await connection.execute(
          'INSERT INTO point_transactions (user_id, points, type, description, order_id) VALUES (?, ?, ?, ?, ?)',
          [req.user.id, -pointsUsed, 'redeem', '订单积分抵扣', orderId]
        );
      }
      
      await connection.commit();
      connection.release();
      
      res.json({
        message: '订单创建成功',
        order: {
          id: orderId,
          totalAmount,
          pointDiscount: pointDiscountAmount,
          finalAmount,
          paymentMethod: paymentMethod || 'tng'
        }
      });
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  } catch (error) {
    console.error('创建订单错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

app.post('/api/orders/:id/pay', authenticateToken, async (req, res) => {
  try {
    const orderId = req.params.id;
    const { tngReference } = req.body;
    
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // 更新订单状态
      const [result] = await connection.execute(
        'UPDATE orders SET status = "paid", tng_reference = ? WHERE id = ? AND user_id = ?',
        [tngReference || null, orderId, req.user.id]
      );
      
      if (result.affectedRows === 0) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({ error: '订单不存在或无法支付' });
      }
      
      // 获取订单信息以计算积分
      const [orders] = await connection.execute(
        'SELECT final_amount FROM orders WHERE id = ?',
        [orderId]
      );
      
      if (orders.length > 0) {
        const order = orders[0];
        const pointsEarned = Math.floor(order.final_amount);
        
        // 添加积分
        await connection.execute(
          'UPDATE users SET points = points + ? WHERE id = ?',
          [pointsEarned, req.user.id]
        );
        
        // 记录积分获得
        await connection.execute(
          'INSERT INTO point_transactions (user_id, points, type, description, order_id) VALUES (?, ?, ?, ?, ?)',
          [req.user.id, pointsEarned, 'purchase_earn', '购物获得积分', orderId]
        );
      }
      
      await connection.commit();
      connection.release();
      
      res.json({
        message: '支付成功',
        orderId,
        pointsEarned: Math.floor(orders[0]?.final_amount || 0)
      });
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  } catch (error) {
    console.error('支付错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 4. 优惠券相关
app.get('/api/coupons', authenticateToken, async (req, res) => {
  try {
    const [coupons] = await pool.execute(
      'SELECT code, type, discount_value, is_used, purchased_at FROM coupons WHERE user_id = ? ORDER BY purchased_at DESC',
      [req.user.id]
    );
    res.json(coupons);
  } catch (error) {
    console.error('获取优惠券错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

app.post('/api/coupons/purchase', authenticateToken, async (req, res) => {
  try {
    const { type, customAmount } = req.body;
    
    let couponType, discountValue, price;
    
    if (type === '10%') {
      couponType = '10%';
      discountValue = 0.1;
      price = 9;
    } else if (type === '20%') {
      couponType = '20%';
      discountValue = 0.2;
      price = 19;
    } else if (customAmount) {
      couponType = `RM${customAmount}`;
      discountValue = customAmount;
      price = customAmount;
    } else {
      return res.status(400).json({ error: '无效的优惠券类型' });
    }
    
    // 检查用户积分是否足够
    const [users] = await pool.execute(
      'SELECT points FROM users WHERE id = ?',
      [req.user.id]
    );
    
    if (users.length === 0 || users[0].points < price) {
      return res.status(400).json({ error: '积分不足' });
    }
    
    const code = `CPMWL${Date.now()}${Math.floor(Math.random() * 1000)}`;
    
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // 扣除积分
      await connection.execute(
        'UPDATE users SET points = points - ? WHERE id = ?',
        [price, req.user.id]
      );
      
      // 记录积分消费
      await connection.execute(
        'INSERT INTO point_transactions (user_id, points, type, description) VALUES (?, ?, ?, ?)',
        [req.user.id, -price, 'redeem', `购买优惠券: ${couponType}`]
      );
      
      // 创建优惠券
      await connection.execute(
        'INSERT INTO coupons (code, type, discount_value, user_id) VALUES (?, ?, ?, ?)',
        [code, couponType, discountValue, req.user.id]
      );
      
      await connection.commit();
      connection.release();
      
      res.json({
        message: '优惠券购买成功',
        coupon: {
          code,
          type: couponType,
          price,
          discountValue
        }
      });
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  } catch (error) {
    console.error('购买优惠券错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 5. 积分相关
app.get('/api/points/history', authenticateToken, async (req, res) => {
  try {
    const [transactions] = await pool.execute(
      'SELECT points, type, description, order_id, created_at FROM point_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      [req.user.id]
    );
    res.json(transactions);
  } catch (error) {
    console.error('获取积分记录错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 6. 后台管理相关
app.get('/api/admin/orders', authenticateToken, async (req, res) => {
  try {
    if (req.user.username !== 'CPMWLADMIN') {
      return res.status(403).json({ error: '无权限访问' });
    }
    
    const [orders] = await pool.execute(`
      SELECT o.*, u.username 
      FROM orders o 
      LEFT JOIN users u ON o.user_id = u.id 
      ORDER BY o.created_at DESC
    `);
    
    res.json(orders);
  } catch (error) {
    console.error('获取订单列表错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

app.get('/api/admin/order/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.username !== 'CPMWLADMIN') {
      return res.status(403).json({ error: '无权限访问' });
    }
    
    const orderId = req.params.id;
    
    // 获取订单信息
    const [orders] = await pool.execute(`
      SELECT o.*, u.username, u.phone 
      FROM orders o 
      LEFT JOIN users u ON o.user_id = u.id 
      WHERE o.id = ?
    `, [orderId]);
    
    if (orders.length === 0) {
      return res.status(404).json({ error: '订单不存在' });
    }
    
    // 获取订单商品
    const [items] = await pool.execute(
      'SELECT * FROM order_items WHERE order_id = ?',
      [orderId]
    );
    
    res.json({
      order: orders[0],
      items
    });
  } catch (error) {
    console.error('获取订单详情错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

app.put('/api/admin/order/:id/status', authenticateToken, async (req, res) => {
  try {
    if (req.user.username !== 'CPMWLADMIN') {
      return res.status(403).json({ error: '无权限访问' });
    }
    
    const orderId = req.params.id;
    const { status } = req.body;
    
    const validStatuses = ['pending', 'paid', 'shipped', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: '无效的状态' });
    }
    
    const [result] = await pool.execute(
      'UPDATE orders SET status = ? WHERE id = ?',
      [status, orderId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '订单不存在' });
    }
    
    // 记录管理日志
    await pool.execute(
      'INSERT INTO admin_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'update_order_status', 'order', orderId, `更新订单状态为: ${status}`]
    );
    
    res.json({ message: '订单状态更新成功', orderId, status });
  } catch (error) {
    console.error('更新订单状态错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

app.get('/api/admin/users', authenticateToken, async (req, res) => {
  try {
    if (req.user.username !== 'CPMWLADMIN') {
      return res.status(403).json({ error: '无权限访问' });
    }
    
    const [users] = await pool.execute(
      'SELECT id, username, phone, points, created_at FROM users WHERE username != "CPMWLADMIN" ORDER BY created_at DESC'
    );
    
    res.json(users);
  } catch (error) {
    console.error('获取用户列表错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 7. 统计信息
app.get('/api/admin/stats', authenticateToken, async (req, res) => {
  try {
    if (req.user.username !== 'CPMWLADMIN') {
      return res.status(403).json({ error: '无权限访问' });
    }
    
    const connection = await pool.getConnection();
    
    // 总用户数
    const [userCount] = await connection.execute(
      'SELECT COUNT(*) as count FROM users WHERE username != "CPMWLADMIN"'
    );
    
    // 总订单数
    const [orderCount] = await connection.execute(
      'SELECT COUNT(*) as count FROM orders'
    );
    
    // 总销售额
    const [revenueResult] = await connection.execute(
      'SELECT SUM(final_amount) as total_revenue FROM orders WHERE status IN ("paid", "shipped", "completed")'
    );
    
    // 今日订单
    const [todayOrders] = await connection.execute(`
      SELECT COUNT(*) as count, SUM(final_amount) as revenue 
      FROM orders 
      WHERE DATE(created_at) = CURDATE()
    `);
    
    connection.release();
    
    res.json({
      userCount: userCount[0].count,
      orderCount: orderCount[0].count,
      totalRevenue: revenueResult[0].total_revenue || 0,
      todayOrders: todayOrders[0].count,
      todayRevenue: todayOrders[0].revenue || 0
    });
  } catch (error) {
    console.error('获取统计信息错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404处理
app.use((req, res) => {
  res.status(404).json({ error: 'API接口不存在' });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({ error: '服务器内部错误' });
});

// 启动服务器
async function startServer() {
  try {
    await initializeDatabase();
    
    app.listen(PORT, () => {
      console.log(`服务器运行在 http://localhost:${PORT}`);
      console.log('API文档:');
      console.log('  POST /api/register - 用户注册');
      console.log('  POST /api/login - 用户登录');
      console.log('  GET  /api/products - 获取商品列表');
      console.log('  POST /api/orders/create - 创建订单');
      console.log('  更多API请查看代码文档...');
    });
  } catch (error) {
    console.error('启动服务器失败:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;

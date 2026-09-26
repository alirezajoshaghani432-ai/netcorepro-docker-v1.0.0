-- NetCore Pro - MySQL / MariaDB schema (mirrors schema.sql for SQLite)
-- Charset: utf8mb4 for full Persian + emoji support

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  full_name VARCHAR(190) NOT NULL,
  phone VARCHAR(32),
  role VARCHAR(20) NOT NULL DEFAULT 'customer',
  company VARCHAR(190),
  address TEXT,
  city VARCHAR(100),
  postal_code VARCHAR(20),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  password_set TINYINT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  slug VARCHAR(190) UNIQUE NOT NULL,
  description TEXT,
  icon VARCHAR(100),
  image VARCHAR(500),
  parent_id INT NULL,
  sort_order INT DEFAULT 0,
  show_in_menu TINYINT NOT NULL DEFAULT 1,
  seo_title VARCHAR(255),
  seo_description TEXT,
  seo_keywords TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cat_parent FOREIGN KEY (parent_id) REFERENCES categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS brands (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  slug VARCHAR(190) UNIQUE NOT NULL,
  logo VARCHAR(500),
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(190) UNIQUE NOT NULL,
  sku VARCHAR(100) UNIQUE,
  category_id INT NULL,
  brand_id INT NULL,
  description LONGTEXT,
  short_description TEXT,
  price BIGINT NOT NULL DEFAULT 0,
  discount_price BIGINT NULL,
  stock INT NOT NULL DEFAULT 0,
  image VARCHAR(500),
  gallery LONGTEXT,
  specs LONGTEXT,
  seo_title VARCHAR(255),
  seo_description TEXT,
  seo_keywords TEXT,
  sort_order INT DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  featured TINYINT DEFAULT 0,
  views INT DEFAULT 0,
  key_features TEXT,
  guarantee VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_prod_cat FOREIGN KEY (category_id) REFERENCES categories(id),
  CONSTRAINT fk_prod_brand FOREIGN KEY (brand_id) REFERENCES brands(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_number VARCHAR(50) UNIQUE NOT NULL,
  user_id INT NULL,
  customer_name VARCHAR(190) NOT NULL,
  customer_phone VARCHAR(32) NOT NULL,
  customer_email VARCHAR(190),
  shipping_address TEXT NOT NULL,
  shipping_city VARCHAR(100),
  shipping_postal VARCHAR(20),
  notes TEXT,
  subtotal BIGINT NOT NULL,
  shipping_cost BIGINT DEFAULT 0,
  total BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  payment_status VARCHAR(20) DEFAULT 'unpaid',
  payment_method VARCHAR(20) DEFAULT 'cod',
  payment_ref VARCHAR(190),
  payment_note TEXT,
  paid_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NULL,
  product_name VARCHAR(255) NOT NULL,
  product_sku VARCHAR(100),
  unit_price BIGINT NOT NULL,
  quantity INT NOT NULL,
  total BIGINT NOT NULL,
  CONSTRAINT fk_oi_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_oi_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tickets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_number VARCHAR(50) UNIQUE NOT NULL,
  user_id INT NULL,
  guest_name VARCHAR(190),
  guest_email VARCHAR(190),
  guest_phone VARCHAR(32),
  subject VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  priority VARCHAR(20) DEFAULT 'normal',
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ticket_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_replies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT NOT NULL,
  user_id INT NULL,
  is_admin TINYINT DEFAULT 0,
  author_name VARCHAR(190) NOT NULL,
  message TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tr_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_tr_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(190) UNIQUE NOT NULL,
  excerpt TEXT,
  content LONGTEXT NOT NULL,
  cover_image VARCHAR(500),
  author_id INT NULL,
  category VARCHAR(100),
  tags TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'published',
  views INT DEFAULT 0,
  seo_title VARCHAR(255),
  seo_description TEXT,
  seo_keywords TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_post_author FOREIGN KEY (author_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_id INT NULL,
  product_id INT NULL,
  user_id INT NULL,
  author_name VARCHAR(190) NOT NULL,
  author_email VARCHAR(190),
  content TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) UNIQUE NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  email VARCHAR(190),
  phone VARCHAR(32),
  subject VARCHAR(255),
  body TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'unread',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
  `key` VARCHAR(190) PRIMARY KEY,
  value LONGTEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  user_name VARCHAR(190),
  action VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50),
  entity_id INT NULL,
  details TEXT,
  ip_address VARCHAR(64),
  user_agent VARCHAR(500),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_blocks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  page VARCHAR(50) NOT NULL,
  section VARCHAR(50) NOT NULL,
  icon VARCHAR(190),
  image VARCHAR(500),
  title VARCHAR(255),
  description TEXT,
  href VARCHAR(500),
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_pages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  page VARCHAR(50) NOT NULL,
  section VARCHAR(50) NOT NULL,
  title VARCHAR(255),
  subtitle VARCHAR(500),
  body LONGTEXT,
  seo_title VARCHAR(255),
  seo_description TEXT,
  seo_keywords TEXT,
  is_active TINYINT NOT NULL DEFAULT 1,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_site_pages (page, section)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS otp_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(32) NOT NULL,
  code VARCHAR(10) NOT NULL,
  is_used TINYINT NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_brand ON products(brand_id);
CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_products_featured ON products(featured);
CREATE INDEX idx_products_sort ON products(category_id, sort_order, id);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at);
CREATE INDEX idx_tickets_user ON tickets(user_id);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_comments_status ON comments(status);
CREATE INDEX idx_activity_user ON activity_logs(user_id);
CREATE INDEX idx_activity_entity ON activity_logs(entity_type, entity_id);
CREATE INDEX idx_activity_created ON activity_logs(created_at);
CREATE INDEX idx_posts_status ON posts(status);
CREATE INDEX idx_messages_status ON messages(status);
CREATE INDEX idx_site_blocks_ps ON site_blocks(page, section, is_active, sort_order);
CREATE INDEX idx_site_pages_page ON site_pages(page, is_active);
CREATE INDEX idx_otp_phone ON otp_codes(phone, is_used, expires_at);
CREATE INDEX idx_categories_parent ON categories(parent_id, sort_order);

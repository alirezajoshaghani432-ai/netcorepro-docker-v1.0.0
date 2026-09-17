-- NetCore Pro - Microsoft SQL Server schema (mirrors schema.mysql.sql)
-- Unicode: NVARCHAR throughout for full Persian support

IF OBJECT_ID(N'dbo.users', N'U') IS NULL
CREATE TABLE dbo.users (
  id INT IDENTITY(1,1) PRIMARY KEY,
  email NVARCHAR(190) NOT NULL UNIQUE,
  password NVARCHAR(255) NOT NULL,
  full_name NVARCHAR(190) NOT NULL,
  phone NVARCHAR(32) NULL,
  role NVARCHAR(20) NOT NULL CONSTRAINT DF_users_role DEFAULT N'customer',
  company NVARCHAR(190) NULL,
  address NVARCHAR(MAX) NULL,
  city NVARCHAR(100) NULL,
  postal_code NVARCHAR(20) NULL,
  status NVARCHAR(20) NOT NULL CONSTRAINT DF_users_status DEFAULT N'active',
  password_set TINYINT CONSTRAINT DF_users_password_set DEFAULT 1,
  created_at DATETIME2 CONSTRAINT DF_users_created DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 CONSTRAINT DF_users_updated DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID(N'dbo.categories', N'U') IS NULL
CREATE TABLE dbo.categories (
  id INT IDENTITY(1,1) PRIMARY KEY,
  name NVARCHAR(190) NOT NULL,
  slug NVARCHAR(190) NOT NULL UNIQUE,
  description NVARCHAR(MAX) NULL,
  icon NVARCHAR(100) NULL,
  image NVARCHAR(500) NULL,
  parent_id INT NULL,
  sort_order INT CONSTRAINT DF_cat_sort DEFAULT 0,
  show_in_menu TINYINT NOT NULL CONSTRAINT DF_cat_menu DEFAULT 1,
  seo_title NVARCHAR(255) NULL,
  seo_description NVARCHAR(MAX) NULL,
  seo_keywords NVARCHAR(MAX) NULL,
  created_at DATETIME2 CONSTRAINT DF_cat_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_cat_parent FOREIGN KEY (parent_id) REFERENCES dbo.categories(id)
);

IF OBJECT_ID(N'dbo.brands', N'U') IS NULL
CREATE TABLE dbo.brands (
  id INT IDENTITY(1,1) PRIMARY KEY,
  name NVARCHAR(190) NOT NULL,
  slug NVARCHAR(190) NOT NULL UNIQUE,
  logo NVARCHAR(500) NULL,
  description NVARCHAR(MAX) NULL,
  created_at DATETIME2 CONSTRAINT DF_brands_created DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID(N'dbo.products', N'U') IS NULL
CREATE TABLE dbo.products (
  id INT IDENTITY(1,1) PRIMARY KEY,
  name NVARCHAR(255) NOT NULL,
  slug NVARCHAR(190) NOT NULL UNIQUE,
  sku NVARCHAR(100) NULL UNIQUE,
  category_id INT NULL,
  brand_id INT NULL,
  description NVARCHAR(MAX) NULL,
  short_description NVARCHAR(MAX) NULL,
  price BIGINT NOT NULL CONSTRAINT DF_prod_price DEFAULT 0,
  discount_price BIGINT NULL,
  stock INT NOT NULL CONSTRAINT DF_prod_stock DEFAULT 0,
  image NVARCHAR(500) NULL,
  gallery NVARCHAR(MAX) NULL,
  specs NVARCHAR(MAX) NULL,
  seo_title NVARCHAR(255) NULL,
  seo_description NVARCHAR(MAX) NULL,
  seo_keywords NVARCHAR(MAX) NULL,
  sort_order INT CONSTRAINT DF_prod_sort DEFAULT 0,
  status NVARCHAR(20) NOT NULL CONSTRAINT DF_prod_status DEFAULT N'active',
  featured TINYINT CONSTRAINT DF_prod_featured DEFAULT 0,
  views INT CONSTRAINT DF_prod_views DEFAULT 0,
  key_features NVARCHAR(MAX) NULL,
  guarantee NVARCHAR(255) NULL,
  created_at DATETIME2 CONSTRAINT DF_prod_created DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 CONSTRAINT DF_prod_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_prod_cat FOREIGN KEY (category_id) REFERENCES dbo.categories(id),
  CONSTRAINT fk_prod_brand FOREIGN KEY (brand_id) REFERENCES dbo.brands(id)
);

IF OBJECT_ID(N'dbo.orders', N'U') IS NULL
CREATE TABLE dbo.orders (
  id INT IDENTITY(1,1) PRIMARY KEY,
  order_number NVARCHAR(50) NOT NULL UNIQUE,
  user_id INT NULL,
  customer_name NVARCHAR(190) NOT NULL,
  customer_phone NVARCHAR(32) NOT NULL,
  customer_email NVARCHAR(190) NULL,
  shipping_address NVARCHAR(MAX) NOT NULL,
  shipping_city NVARCHAR(100) NULL,
  shipping_postal NVARCHAR(20) NULL,
  notes NVARCHAR(MAX) NULL,
  subtotal BIGINT NOT NULL,
  shipping_cost BIGINT CONSTRAINT DF_ord_ship DEFAULT 0,
  total BIGINT NOT NULL,
  status NVARCHAR(20) NOT NULL CONSTRAINT DF_ord_status DEFAULT N'pending',
  payment_status NVARCHAR(20) CONSTRAINT DF_ord_paystatus DEFAULT N'unpaid',
  payment_method NVARCHAR(20) CONSTRAINT DF_ord_paymethod DEFAULT N'cod',
  payment_ref NVARCHAR(190) NULL,
  payment_note NVARCHAR(MAX) NULL,
  paid_at DATETIME2 NULL,
  created_at DATETIME2 CONSTRAINT DF_ord_created DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 CONSTRAINT DF_ord_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_order_user FOREIGN KEY (user_id) REFERENCES dbo.users(id)
);

IF OBJECT_ID(N'dbo.order_items', N'U') IS NULL
CREATE TABLE dbo.order_items (
  id INT IDENTITY(1,1) PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NULL,
  product_name NVARCHAR(255) NOT NULL,
  product_sku NVARCHAR(100) NULL,
  unit_price BIGINT NOT NULL,
  quantity INT NOT NULL,
  total BIGINT NOT NULL,
  CONSTRAINT fk_oi_order FOREIGN KEY (order_id) REFERENCES dbo.orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_oi_product FOREIGN KEY (product_id) REFERENCES dbo.products(id)
);

IF OBJECT_ID(N'dbo.tickets', N'U') IS NULL
CREATE TABLE dbo.tickets (
  id INT IDENTITY(1,1) PRIMARY KEY,
  ticket_number NVARCHAR(50) NOT NULL UNIQUE,
  user_id INT NULL,
  guest_name NVARCHAR(190) NULL,
  guest_email NVARCHAR(190) NULL,
  guest_phone NVARCHAR(32) NULL,
  subject NVARCHAR(255) NOT NULL,
  message NVARCHAR(MAX) NOT NULL,
  priority NVARCHAR(20) CONSTRAINT DF_tkt_pri DEFAULT N'normal',
  status NVARCHAR(20) NOT NULL CONSTRAINT DF_tkt_status DEFAULT N'open',
  created_at DATETIME2 CONSTRAINT DF_tkt_created DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 CONSTRAINT DF_tkt_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_ticket_user FOREIGN KEY (user_id) REFERENCES dbo.users(id)
);

IF OBJECT_ID(N'dbo.ticket_replies', N'U') IS NULL
CREATE TABLE dbo.ticket_replies (
  id INT IDENTITY(1,1) PRIMARY KEY,
  ticket_id INT NOT NULL,
  user_id INT NULL,
  is_admin TINYINT CONSTRAINT DF_tr_admin DEFAULT 0,
  author_name NVARCHAR(190) NOT NULL,
  message NVARCHAR(MAX) NOT NULL,
  created_at DATETIME2 CONSTRAINT DF_tr_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_tr_ticket FOREIGN KEY (ticket_id) REFERENCES dbo.tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_tr_user FOREIGN KEY (user_id) REFERENCES dbo.users(id)
);

IF OBJECT_ID(N'dbo.posts', N'U') IS NULL
CREATE TABLE dbo.posts (
  id INT IDENTITY(1,1) PRIMARY KEY,
  title NVARCHAR(255) NOT NULL,
  slug NVARCHAR(190) NOT NULL UNIQUE,
  excerpt NVARCHAR(MAX) NULL,
  content NVARCHAR(MAX) NOT NULL,
  cover_image NVARCHAR(500) NULL,
  author_id INT NULL,
  category NVARCHAR(100) NULL,
  tags NVARCHAR(MAX) NULL,
  status NVARCHAR(20) NOT NULL CONSTRAINT DF_posts_status DEFAULT N'published',
  views INT CONSTRAINT DF_posts_views DEFAULT 0,
  seo_title NVARCHAR(255) NULL,
  seo_description NVARCHAR(MAX) NULL,
  seo_keywords NVARCHAR(MAX) NULL,
  created_at DATETIME2 CONSTRAINT DF_posts_created DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 CONSTRAINT DF_posts_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_post_author FOREIGN KEY (author_id) REFERENCES dbo.users(id)
);

IF OBJECT_ID(N'dbo.comments', N'U') IS NULL
CREATE TABLE dbo.comments (
  id INT IDENTITY(1,1) PRIMARY KEY,
  post_id INT NULL,
  product_id INT NULL,
  user_id INT NULL,
  author_name NVARCHAR(190) NOT NULL,
  author_email NVARCHAR(190) NULL,
  content NVARCHAR(MAX) NOT NULL,
  status NVARCHAR(20) NOT NULL CONSTRAINT DF_cm_status DEFAULT N'pending',
  created_at DATETIME2 CONSTRAINT DF_cm_created DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID(N'dbo.newsletter_subscribers', N'U') IS NULL
CREATE TABLE dbo.newsletter_subscribers (
  id INT IDENTITY(1,1) PRIMARY KEY,
  email NVARCHAR(190) NOT NULL UNIQUE,
  status NVARCHAR(20) CONSTRAINT DF_nl_status DEFAULT N'active',
  created_at DATETIME2 CONSTRAINT DF_nl_created DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID(N'dbo.messages', N'U') IS NULL
CREATE TABLE dbo.messages (
  id INT IDENTITY(1,1) PRIMARY KEY,
  name NVARCHAR(190) NOT NULL,
  email NVARCHAR(190) NULL,
  phone NVARCHAR(32) NULL,
  subject NVARCHAR(255) NULL,
  body NVARCHAR(MAX) NOT NULL,
  status NVARCHAR(20) CONSTRAINT DF_msg_status DEFAULT N'unread',
  created_at DATETIME2 CONSTRAINT DF_msg_created DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID(N'dbo.settings', N'U') IS NULL
CREATE TABLE dbo.settings (
  [key] NVARCHAR(190) PRIMARY KEY,
  [value] NVARCHAR(MAX) NULL,
  updated_at DATETIME2 CONSTRAINT DF_set_updated DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID(N'dbo.activity_logs', N'U') IS NULL
CREATE TABLE dbo.activity_logs (
  id INT IDENTITY(1,1) PRIMARY KEY,
  user_id INT NULL,
  user_name NVARCHAR(190) NULL,
  action NVARCHAR(50) NOT NULL,
  entity_type NVARCHAR(50) NULL,
  entity_id INT NULL,
  details NVARCHAR(MAX) NULL,
  ip_address NVARCHAR(64) NULL,
  user_agent NVARCHAR(500) NULL,
  created_at DATETIME2 CONSTRAINT DF_al_created DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID(N'dbo.site_blocks', N'U') IS NULL
CREATE TABLE dbo.site_blocks (
  id INT IDENTITY(1,1) PRIMARY KEY,
  page NVARCHAR(50) NOT NULL,
  section NVARCHAR(50) NOT NULL,
  icon NVARCHAR(190) NULL,
  image NVARCHAR(500) NULL,
  title NVARCHAR(255) NULL,
  description NVARCHAR(MAX) NULL,
  href NVARCHAR(500) NULL,
  sort_order INT NOT NULL CONSTRAINT DF_sb_sort DEFAULT 0,
  is_active TINYINT NOT NULL CONSTRAINT DF_sb_active DEFAULT 1,
  created_at DATETIME2 CONSTRAINT DF_sb_created DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 CONSTRAINT DF_sb_updated DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID(N'dbo.site_pages', N'U') IS NULL
CREATE TABLE dbo.site_pages (
  id INT IDENTITY(1,1) PRIMARY KEY,
  page NVARCHAR(50) NOT NULL,
  section NVARCHAR(50) NOT NULL,
  title NVARCHAR(255) NULL,
  subtitle NVARCHAR(500) NULL,
  body NVARCHAR(MAX) NULL,
  seo_title NVARCHAR(255) NULL,
  seo_description NVARCHAR(MAX) NULL,
  seo_keywords NVARCHAR(MAX) NULL,
  is_active TINYINT NOT NULL CONSTRAINT DF_sp_active DEFAULT 1,
  updated_at DATETIME2 CONSTRAINT DF_sp_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT uq_site_pages UNIQUE (page, section)
);

IF OBJECT_ID(N'dbo.otp_codes', N'U') IS NULL
CREATE TABLE dbo.otp_codes (
  id INT IDENTITY(1,1) PRIMARY KEY,
  phone NVARCHAR(32) NOT NULL,
  code NVARCHAR(10) NOT NULL,
  is_used TINYINT NOT NULL CONSTRAINT DF_otp_used DEFAULT 0,
  expires_at DATETIME2 NOT NULL,
  created_at DATETIME2 CONSTRAINT DF_otp_created DEFAULT SYSUTCDATETIME()
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_products_category' AND object_id = OBJECT_ID(N'dbo.products'))
  CREATE INDEX idx_products_category ON dbo.products(category_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_products_brand' AND object_id = OBJECT_ID(N'dbo.products'))
  CREATE INDEX idx_products_brand ON dbo.products(brand_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_products_status' AND object_id = OBJECT_ID(N'dbo.products'))
  CREATE INDEX idx_products_status ON dbo.products(status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_products_featured' AND object_id = OBJECT_ID(N'dbo.products'))
  CREATE INDEX idx_products_featured ON dbo.products(featured);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_products_sort' AND object_id = OBJECT_ID(N'dbo.products'))
  CREATE INDEX idx_products_sort ON dbo.products(category_id, sort_order, id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_orders_user' AND object_id = OBJECT_ID(N'dbo.orders'))
  CREATE INDEX idx_orders_user ON dbo.orders(user_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_orders_status' AND object_id = OBJECT_ID(N'dbo.orders'))
  CREATE INDEX idx_orders_status ON dbo.orders(status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_orders_created' AND object_id = OBJECT_ID(N'dbo.orders'))
  CREATE INDEX idx_orders_created ON dbo.orders(created_at);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_tickets_user' AND object_id = OBJECT_ID(N'dbo.tickets'))
  CREATE INDEX idx_tickets_user ON dbo.tickets(user_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_tickets_status' AND object_id = OBJECT_ID(N'dbo.tickets'))
  CREATE INDEX idx_tickets_status ON dbo.tickets(status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_comments_status' AND object_id = OBJECT_ID(N'dbo.comments'))
  CREATE INDEX idx_comments_status ON dbo.comments(status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_activity_user' AND object_id = OBJECT_ID(N'dbo.activity_logs'))
  CREATE INDEX idx_activity_user ON dbo.activity_logs(user_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_activity_entity' AND object_id = OBJECT_ID(N'dbo.activity_logs'))
  CREATE INDEX idx_activity_entity ON dbo.activity_logs(entity_type, entity_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_activity_created' AND object_id = OBJECT_ID(N'dbo.activity_logs'))
  CREATE INDEX idx_activity_created ON dbo.activity_logs(created_at);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_posts_status' AND object_id = OBJECT_ID(N'dbo.posts'))
  CREATE INDEX idx_posts_status ON dbo.posts(status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_messages_status' AND object_id = OBJECT_ID(N'dbo.messages'))
  CREATE INDEX idx_messages_status ON dbo.messages(status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_site_blocks_ps' AND object_id = OBJECT_ID(N'dbo.site_blocks'))
  CREATE INDEX idx_site_blocks_ps ON dbo.site_blocks(page, section, is_active, sort_order);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_site_pages_page' AND object_id = OBJECT_ID(N'dbo.site_pages'))
  CREATE INDEX idx_site_pages_page ON dbo.site_pages(page, is_active);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_otp_phone' AND object_id = OBJECT_ID(N'dbo.otp_codes'))
  CREATE INDEX idx_otp_phone ON dbo.otp_codes(phone, is_used, expires_at);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_categories_parent' AND object_id = OBJECT_ID(N'dbo.categories'))
  CREATE INDEX idx_categories_parent ON dbo.categories(parent_id, sort_order);

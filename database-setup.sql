-- Authentication Database Setup Script
-- Run this in your Supabase SQL Editor or any PostgreSQL client

-- ============================================
-- 1. Create Roles Table
-- ============================================
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name VARCHAR(50) UNIQUE NOT NULL,
  permissions JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- 2. Create Users Table
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- 3. Create Indexes for Performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

-- ============================================
-- 4. Insert Default Roles
-- ============================================
INSERT INTO roles (role_name, permissions) VALUES
  ('admin', '{
    "create_quotes": true,
    "edit_quotes": true,
    "delete_quotes": true,
    "view_quotes": true,
    "manage_users": true,
    "export_pdf": true,
    "access_settings": true
  }'::jsonb),
  ('manager', '{
    "create_quotes": true,
    "edit_quotes": true,
    "view_quotes": true,
    "export_pdf": true
  }'::jsonb),
  ('sales', '{
    "create_quotes": true,
    "view_quotes": true,
    "export_pdf": true
  }'::jsonb),
  ('viewer', '{
    "view_quotes": true
  }'::jsonb)
ON CONFLICT (role_name) DO NOTHING;

-- ============================================
-- 5. Insert Test Users
-- ============================================
-- NOTE: Replace password hashes with actual bcrypt hashes!
-- Use the password hashing script provided in AUTHENTICATION.md
-- or use an online bcrypt generator (10 rounds)

-- Example Admin User
-- Email: admin@example.com
-- Password: Admin@123
-- Hash generated with: bcrypt.hash('Admin@123', 10)
INSERT INTO users (email, password_hash, full_name, role_id, is_active)
VALUES (
  'admin@example.com',
  '$2a$10$K5pFQ.rFQ5rFQ5rFQ5rFQuAbCdEfGhIjKlMnOpQrStUvWxYz12345',  -- REPLACE THIS!
  'Admin User',
  (SELECT id FROM roles WHERE role_name = 'admin'),
  true
)
ON CONFLICT (email) DO NOTHING;

-- Example Manager User
-- Email: manager@example.com
-- Password: Manager@123
INSERT INTO users (email, password_hash, full_name, role_id, is_active)
VALUES (
  'manager@example.com',
  '$2a$10$K5pFQ.rFQ5rFQ5rFQ5rFQuAbCdEfGhIjKlMnOpQrStUvWxYz67890',  -- REPLACE THIS!
  'Manager User',
  (SELECT id FROM roles WHERE role_name = 'manager'),
  true
)
ON CONFLICT (email) DO NOTHING;

-- Example Sales User
-- Email: sales@example.com
-- Password: Sales@123
INSERT INTO users (email, password_hash, full_name, role_id, is_active)
VALUES (
  'sales@example.com',
  '$2a$10$K5pFQ.rFQ5rFQ5rFQ5rFQuAbCdEfGhIjKlMnOpQrStUvWxYz13579',  -- REPLACE THIS!
  'Sales User',
  (SELECT id FROM roles WHERE role_name = 'sales'),
  true
)
ON CONFLICT (email) DO NOTHING;

-- ============================================
-- 6. Create Updated_at Trigger Function
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 7. Create Trigger for Users Table
-- ============================================
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 8. Verification Queries
-- ============================================
-- Check if tables were created
SELECT 'Roles table created' AS status, COUNT(*) AS role_count FROM roles;
SELECT 'Users table created' AS status, COUNT(*) AS user_count FROM users;

-- View all roles with their permissions
SELECT role_name, permissions, created_at 
FROM roles 
ORDER BY role_name;

-- View all users with their roles
SELECT 
  u.email,
  u.full_name,
  r.role_name,
  u.is_active,
  u.created_at
FROM users u
LEFT JOIN roles r ON u.role_id = r.id
ORDER BY u.created_at;

-- ============================================
-- IMPORTANT: Password Hashing
-- ============================================
-- You must replace the placeholder password hashes above!
-- 
-- Option 1: Use Node.js (recommended)
-- ---------------------------------
-- 1. Create a file called hash-password.js:
--    const bcrypt = require('bcryptjs');
--    const password = 'YourPasswordHere';
--    bcrypt.hash(password, 10).then(hash => console.log(hash));
--
-- 2. Run: node hash-password.js
-- 3. Copy the output hash and replace in INSERT statements above
--
-- Option 2: Use online bcrypt generator
-- -------------------------------------
-- 1. Visit: https://bcrypt-generator.com/
-- 2. Enter your password
-- 3. Set rounds to 10
-- 4. Copy the hash and replace in INSERT statements above
--
-- Option 3: Use PostgreSQL extension (if available)
-- -------------------------------------------------
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- UPDATE users SET password_hash = crypt('YourPassword', gen_salt('bf', 10));

-- ============================================
-- Additional Useful Queries
-- ============================================

-- Add a new user
-- INSERT INTO users (email, password_hash, full_name, role_id, is_active)
-- VALUES (
--   'newuser@example.com',
--   'bcrypt_hash_here',
--   'New User Name',
--   (SELECT id FROM roles WHERE role_name = 'viewer'),
--   true
-- );

-- Update user role
-- UPDATE users 
-- SET role_id = (SELECT id FROM roles WHERE role_name = 'admin')
-- WHERE email = 'user@example.com';

-- Deactivate user
-- UPDATE users SET is_active = false WHERE email = 'user@example.com';

-- Activate user
-- UPDATE users SET is_active = true WHERE email = 'user@example.com';

-- Add new permission to a role
-- UPDATE roles 
-- SET permissions = jsonb_set(permissions, '{new_permission}', 'true')
-- WHERE role_name = 'admin';

-- Remove permission from a role
-- UPDATE roles 
-- SET permissions = permissions - 'permission_name'
-- WHERE role_name = 'viewer';

-- ============================================
-- DONE!
-- ============================================
-- Your database is now ready for authentication.
-- Don't forget to update the password hashes!

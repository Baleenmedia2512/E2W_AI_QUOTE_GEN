/**
 * Password Hash Generator
 * 
 * This script helps generate bcrypt password hashes for the database.
 * 
 * Usage:
 * 1. Make sure bcryptjs is installed: npm install bcryptjs
 * 2. Run: node generate-password-hash.js
 * 3. Enter your password when prompted
 * 4. Copy the generated hash to your SQL INSERT statement
 */

const bcrypt = require('bcryptjs');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('===========================================');
console.log('  Password Hash Generator (Bcrypt)');
console.log('===========================================\n');

rl.question('Enter password to hash: ', async (password) => {
  if (!password || password.length < 6) {
    console.error('❌ Password must be at least 6 characters long');
    rl.close();
    return;
  }

  try {
    console.log('\n⏳ Generating hash...\n');
    
    const hash = await bcrypt.hash(password, 10);
    
    console.log('✅ Hash generated successfully!\n');
    console.log('Password:', password);
    console.log('Hash:', hash);
    console.log('\n📋 SQL Example:');
    console.log(`
INSERT INTO users (email, password_hash, full_name, role_id, is_active)
VALUES (
  'user@example.com',
  '${hash}',
  'User Name',
  (SELECT id FROM roles WHERE role_name = 'viewer'),
  true
);
    `);
    console.log('\n===========================================');
  } catch (error) {
    console.error('❌ Error generating hash:', error.message);
  }
  
  rl.close();
});

// Generate multiple hashes at once
async function generateMultipleHashes() {
  const passwords = [
    { email: 'admin@example.com', password: 'Admin@123', role: 'admin', name: 'Admin User' },
    { email: 'manager@example.com', password: 'Manager@123', role: 'manager', name: 'Manager User' },
    { email: 'sales@example.com', password: 'Sales@123', role: 'sales', name: 'Sales User' },
  ];

  console.log('\n🔄 Generating hashes for default users...\n');

  for (const user of passwords) {
    const hash = await bcrypt.hash(user.password, 10);
    console.log(`-- ${user.name}`);
    console.log(`INSERT INTO users (email, password_hash, full_name, role_id, is_active)`);
    console.log(`VALUES (`);
    console.log(`  '${user.email}',`);
    console.log(`  '${hash}',`);
    console.log(`  '${user.name}',`);
    console.log(`  (SELECT id FROM roles WHERE role_name = '${user.role}'),`);
    console.log(`  true`);
    console.log(`);\n`);
  }
}

// Uncomment to generate multiple hashes at once
// generateMultipleHashes();

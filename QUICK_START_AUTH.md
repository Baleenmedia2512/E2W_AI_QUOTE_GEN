# 🚀 Quick Start Guide - Authentication System

## Step-by-Step Setup

### 1️⃣ Setup Environment Variables

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` and add your Supabase Anon Key:

```env
VITE_SUPABASE_ANON_KEY=your-actual-anon-key-here
```

**Where to find your Anon Key:**
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project: `wkwrrdcjknvupwsfdjtd`
3. Navigate to: **Settings** → **API**
4. Copy the `anon` `public` key

---

### 2️⃣ Setup Database

#### Option A: Using Supabase SQL Editor (Recommended)

1. Go to your Supabase Dashboard
2. Navigate to: **SQL Editor**
3. Click **New Query**
4. Copy the contents of `database-setup.sql`
5. Paste and click **Run**

#### Option B: Using PostgreSQL Client

```bash
psql "postgresql://postgres.wkwrrdcjknvupwsfdjtd:Easy2work%4025@aws-1-ap-south-1.pooler.supabase.com:6543/postgres" -f database-setup.sql
```

---

### 3️⃣ Generate Password Hashes

**Important:** The default password hashes in `database-setup.sql` are placeholders!

#### Method 1: Using Node.js Script (Recommended)

```bash
node generate-password-hash.js
```

Follow the prompts and copy the generated hash.

#### Method 2: Programmatically

Create a temporary file `hash.js`:

```javascript
const bcrypt = require('bcryptjs');
bcrypt.hash('YourPassword', 10).then(hash => console.log(hash));
```

Run it:

```bash
node hash.js
```

#### Method 3: Online Generator

1. Visit: https://bcrypt-generator.com/
2. Enter your password
3. Set rounds to **10**
4. Copy the generated hash

---

### 4️⃣ Update Database with Real Password Hashes

Run this in Supabase SQL Editor (replace with your actual hash):

```sql
-- Update admin password
UPDATE users 
SET password_hash = '$2a$10$YOUR_ACTUAL_HASH_HERE'
WHERE email = 'admin@example.com';

-- Update manager password
UPDATE users 
SET password_hash = '$2a$10$YOUR_ACTUAL_HASH_HERE'
WHERE email = 'manager@example.com';

-- Update sales password
UPDATE users 
SET password_hash = '$2a$10$YOUR_ACTUAL_HASH_HERE'
WHERE email = 'sales@example.com';
```

---

### 5️⃣ Install Dependencies (if not already done)

```bash
npm install
```

The authentication dependencies were already installed:
- `@supabase/supabase-js` ✓
- `bcryptjs` ✓
- `@types/bcryptjs` ✓

---

### 6️⃣ Start the Application

```bash
npm run dev
```

---

### 7️⃣ Test Login

1. Open browser: http://localhost:5173/login
2. Try logging in with your credentials:
   - Email: `admin@example.com`
   - Password: (the password you set in step 3)

---

## 🎯 What's Working Now

### ✅ Available Routes

- `/login` - Login page
- `/unauthorized` - Access denied page
- `/` - Home page (currently unprotected)
- `/quote` - Quote page (currently unprotected)
- `/preview` - Preview page (currently unprotected)

### ✅ Features Working

- [x] Login with email/password
- [x] Session persistence (survives page refresh)
- [x] User profile display (desktop header)
- [x] Logout functionality
- [x] Role-based system ready
- [x] Permission-based system ready

### ⚠️ Current Behavior

**All existing routes are UNPROTECTED** - This is intentional to not break existing functionality!

- You can access all pages without logging in
- Login system is optional right now
- No existing functionality is affected

---

## 🔒 Enabling Route Protection (When Ready)

Edit `src/App.tsx`:

### Step 1: Uncomment PrivateRoute Import

```typescript
// Change this:
// import { PrivateRoute } from './components/PrivateRoute';

// To this:
import { PrivateRoute } from './components/PrivateRoute';
```

### Step 2: Replace Route with PrivateRoute

```typescript
// Before (unprotected):
<Route exact path="/" component={HomePage} />

// After (protected):
<PrivateRoute exact path="/" component={HomePage} />
```

### Step 3: Optional - Add Permission Requirements

```typescript
<PrivateRoute 
  exact 
  path="/quote" 
  component={QuotePage}
  requiredPermission="create_quotes"
/>
```

---

## 🧪 Testing Checklist

- [ ] Can access login page at `/login`
- [ ] Can login with correct credentials
- [ ] Login fails with wrong credentials
- [ ] User profile shows in header (desktop)
- [ ] Can logout successfully
- [ ] Session persists after page refresh
- [ ] Can access all pages without login (default behavior)

---

## 👥 Default Test Users

After setting up passwords, you'll have these test users:

| Email | Role | Permissions |
|-------|------|-------------|
| admin@example.com | Admin | All permissions |
| manager@example.com | Manager | Create, Edit, View |
| sales@example.com | Sales | Create, View |

---

## 🎨 Customizing Roles & Permissions

### Add New Permission

```sql
UPDATE roles 
SET permissions = jsonb_set(
  permissions, 
  '{new_permission_name}', 
  'true'
)
WHERE role_name = 'admin';
```

### Create New Role

```sql
INSERT INTO roles (role_name, permissions)
VALUES ('custom_role', '{
  "view_quotes": true,
  "custom_permission": true
}'::jsonb);
```

### Add New User

```sql
INSERT INTO users (email, password_hash, full_name, role_id, is_active)
VALUES (
  'newuser@example.com',
  '$2a$10$YOUR_HASH_HERE',
  'New User Name',
  (SELECT id FROM roles WHERE role_name = 'viewer'),
  true
);
```

---

## 🐛 Troubleshooting

### Issue: "Invalid credentials" error

**Possible causes:**
1. Password hash is incorrect (still using placeholder)
2. User doesn't exist in database
3. User is inactive (`is_active = false`)

**Solution:**
```sql
-- Check if user exists
SELECT email, is_active FROM users WHERE email = 'your@email.com';

-- Activate user if needed
UPDATE users SET is_active = true WHERE email = 'your@email.com';

-- Update password hash
UPDATE users SET password_hash = '$2a$10$YOUR_NEW_HASH' WHERE email = 'your@email.com';
```

### Issue: Cannot connect to database

**Check:**
1. Supabase project is active
2. `VITE_SUPABASE_ANON_KEY` is set in `.env`
3. Database URL in `supabaseClient.ts` is correct

**Test connection:**
```typescript
import { testConnection } from './services/supabaseClient';
testConnection();
```

### Issue: Login page shows white screen

**Check browser console for errors:**
1. Press F12
2. Look at Console tab
3. Check for missing dependencies or import errors

---

## 📚 Additional Resources

- Full documentation: `AUTHENTICATION.md`
- Database setup: `database-setup.sql`
- Password generator: `generate-password-hash.js`

---

## 🎉 Next Steps

1. ✅ Complete steps 1-7 above
2. ✅ Test login functionality
3. ✅ Familiar yourself with the system
4. ⏳ When ready, enable route protection
5. ⏳ Customize roles and permissions for your needs
6. ⏳ Add more users as needed

---

**Need Help?** Check `AUTHENTICATION.md` for detailed documentation.

**Happy Coding! 🚀**

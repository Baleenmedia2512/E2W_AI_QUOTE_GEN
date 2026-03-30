# Authentication System Documentation

## Overview
This application now includes a complete authentication system using PostgreSQL (Supabase) with role-based access control (RBAC).

## Database Setup

### Connection String
```
postgresql://postgres.wkwrrdcjknvupwsfdjtd:Easy2work%4025@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true
```

### Required Tables

#### 1. `roles` Table
```sql
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name VARCHAR(50) UNIQUE NOT NULL,
  permissions JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Example roles
INSERT INTO roles (role_name, permissions) VALUES
  ('admin', '{"create_quotes": true, "edit_quotes": true, "delete_quotes": true, "manage_users": true, "view_quotes": true}'),
  ('manager', '{"create_quotes": true, "edit_quotes": true, "view_quotes": true}'),
  ('sales', '{"create_quotes": true, "view_quotes": true}'),
  ('viewer', '{"view_quotes": true}');
```

#### 2. `users` Table
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role_id UUID REFERENCES roles(id),
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for faster email lookups
CREATE INDEX idx_users_email ON users(email);

-- Example user (password: Admin@123)
-- You'll need to hash passwords using bcrypt with 10 rounds
INSERT INTO users (email, password_hash, full_name, role_id, is_active)
VALUES (
  'admin@example.com',
  '$2a$10$YourBcryptHashHere',  -- Replace with actual bcrypt hash
  'Admin User',
  (SELECT id FROM roles WHERE role_name = 'admin'),
  true
);
```

### Creating Password Hashes
Use this Node.js script to generate password hashes:

```javascript
const bcrypt = require('bcryptjs');

async function hashPassword(password) {
  const hash = await bcrypt.hash(password, 10);
  console.log('Hash:', hash);
}

hashPassword('YourPasswordHere');
```

Or use an online bcrypt generator with 10 rounds.

## Environment Setup

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Get your Supabase Anon Key:
   - Go to [Supabase Dashboard](https://supabase.com/dashboard)
   - Navigate to: Settings -> API
   - Copy the `anon` `public` key

3. Update `.env`:
```env
VITE_SUPABASE_ANON_KEY=your-actual-anon-key-here
```

## Features Implemented

### ✅ Complete Features
1. **Login System**
   - Email & password authentication
   - Password visibility toggle
   - Form validation
   - Error handling
   - Remember user session

2. **User Management**
   - Role-based access control (RBAC)
   - Permission checking
   - User profile display
   - Logout functionality

3. **Protected Routes**
   - PrivateRoute wrapper component
   - Role-based route protection
   - Permission-based route protection
   - Automatic redirect to login

4. **UI Components**
   - Login page with modern design
   - User profile dropdown (desktop)
   - Header with user info
   - Unauthorized page

5. **Security**
   - Bcrypt password hashing
   - Session persistence
   - Automatic session restoration
   - Protected API endpoints ready

## File Structure

```
src/
├── components/
│   ├── Header/              # Desktop header with user profile
│   │   ├── Header.tsx
│   │   └── index.ts
│   ├── PrivateRoute/        # Route protection wrapper
│   │   ├── PrivateRoute.tsx
│   │   └── index.ts
│   └── UserProfile/         # User dropdown menu
│       ├── UserProfile.tsx
│       └── index.ts
├── pages/
│   ├── LoginPage.tsx        # Login form
│   └── UnauthorizedPage.tsx # Access denied page
├── services/
│   ├── supabaseClient.ts    # Database connection
│   └── authService.ts       # Authentication logic
├── store/
│   └── authStore.ts         # Auth state management (Zustand)
└── types/
    └── auth.ts              # TypeScript types
```

## Usage

### Current State (No Protection)
All routes are currently **unprotected** to maintain existing functionality. The auth system is ready but not enforcing authentication.

To access the login page:
```
http://localhost:5173/login
```

### Enabling Authentication Protection

#### Option 1: Protect All Routes
Uncomment the import in `App.tsx`:
```typescript
import { PrivateRoute } from './components/PrivateRoute';
```

Then replace `Route` with `PrivateRoute`:
```typescript
// Before
<Route exact path="/" component={HomePage} />

// After
<PrivateRoute exact path="/" component={HomePage} />
```

#### Option 2: Protect Specific Routes with Permissions
```typescript
<PrivateRoute 
  exact 
  path="/quote" 
  component={QuotePage}
  requiredPermission="create_quotes"
/>
```

#### Option 3: Protect by Role
```typescript
<PrivateRoute 
  exact 
  path="/admin" 
  component={AdminPage}
  requiredRole="admin"
/>
```

### Using Auth in Components

```typescript
import { useAuthStore } from '../store/authStore';

function MyComponent() {
  const { user, isAuthenticated, hasPermission, logout } = useAuthStore();

  if (!isAuthenticated) {
    return <div>Please login</div>;
  }

  if (!hasPermission('create_quotes')) {
    return <div>No permission</div>;
  }

  return (
    <div>
      <p>Welcome, {user?.full_name}!</p>
      <p>Role: {user?.role.role_name}</p>
      <button onClick={logout}>Logout</button>
    </div>
  );
}
```

## Permission System

### Default Permissions
- `create_quotes`: Can create new quotes
- `edit_quotes`: Can edit existing quotes
- `delete_quotes`: Can delete quotes
- `view_quotes`: Can view quotes
- `manage_users`: Can manage user accounts

### Adding Custom Permissions
Update the `roles` table:
```sql
UPDATE roles 
SET permissions = jsonb_set(
  permissions, 
  '{export_pdf}', 
  'true'
) 
WHERE role_name = 'admin';
```

## Testing

### Test Credentials (Example)
After setting up your database:

```
Email: admin@example.com
Password: [Your password]
Role: admin
```

### Manual Testing Checklist
- [ ] Login with valid credentials
- [ ] Login with invalid credentials (should fail)
- [ ] Session persists on page refresh
- [ ] User profile displays correctly
- [ ] Logout works properly
- [ ] Protected routes redirect to login
- [ ] Role-based access works
- [ ] Permission-based access works

## Troubleshooting

### Issue: "Invalid credentials"
- Check if user exists in database
- Verify password hash is correct
- Check if `is_active` is true

### Issue: "Cannot connect to database"
- Verify Supabase URL in `supabaseClient.ts`
- Check `VITE_SUPABASE_ANON_KEY` in `.env`
- Ensure database is accessible

### Issue: Routes not protected
- Uncomment `PrivateRoute` import in `App.tsx`
- Replace `Route` with `PrivateRoute`
- Clear browser localStorage if needed

### Issue: User not persisting
- Check browser localStorage
- Verify `auth-storage` exists in DevTools -> Application -> Local Storage
- Check Zustand persist configuration

## Production Considerations

### Security Enhancements
1. **Add JWT Tokens**: Implement proper JWT token authentication
2. **HTTPS Only**: Force HTTPS in production
3. **Rate Limiting**: Add login attempt rate limiting
4. **Session Timeout**: Implement automatic logout after inactivity
5. **CSRF Protection**: Add CSRF tokens for forms

### Performance
1. Use connection pooling (already configured with pgbouncer)
2. Add database indexes on frequently queried columns
3. Implement token refresh mechanism
4. Cache user permissions

### Monitoring
1. Log failed login attempts
2. Track user activity
3. Monitor database queries
4. Set up alerts for suspicious activity

## API Integration (Future)

When you need to call authenticated APIs:

```typescript
// Add token to requests
const token = localStorage.getItem('authToken');

const response = await fetch('/api/quotes', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});
```

## Migration Path

1. **Phase 1** (Current): Auth system ready, routes unprotected
2. **Phase 2**: Protect sensitive routes (admin, delete operations)
3. **Phase 3**: Protect all routes, enforce full authentication
4. **Phase 4**: Add advanced features (2FA, OAuth, etc.)

## Support

For issues or questions:
1. Check this documentation first
2. Review the code comments in each file
3. Test with console.log for debugging
4. Check browser DevTools -> Console for errors

---

**Last Updated**: March 30, 2026
**Version**: 1.0.0
**Status**: ✅ Ready to use (optional enforcement)

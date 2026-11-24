# External API - Railway Deployment Guide

## 🚨 IMPORTANT: This is a SEPARATE SERVICE

The **External API** (`external-api` folder) is **different** from the main WallXERP backend (`backend` folder). They need to be deployed as **separate Railway services**.

---

## 🎯 What is the External API?

This is the API service that powers the **External API Developer Portal** frontend. It provides:
- Sales, invoices, and expenses API (no tax computation)
- Developer portal authentication
- Admin console for managing API keys and platforms
- Multi-tenancy for external platforms

---

## 🚀 Deploy to Railway

### Step 1: Create New Railway Service

1. Go to https://railway.app
2. Create a **NEW project** (or add to existing project)
3. Click "New" → "GitHub Repo"
4. Select your repository (e.g., `devsilvar/eternalapiFrontend` or separate external-api repo)
5. Set **Root Directory:** `external-api` (if monorepo) or `.` (if standalone)

### Step 2: Add PostgreSQL Database

1. In Railway project, click "New" → "Database" → "Add PostgreSQL"
2. Railway automatically sets `DATABASE_URL` environment variable
3. The external-api service will connect automatically

### Step 3: Set Environment Variables

Go to your external-api service → Variables tab:

```env
NODE_ENV=production
PORT=5000
DATABASE_URL=(automatically set by Railway PostgreSQL)

# CORS - Add your Vercel frontend URL
ALLOWED_ORIGINS=https://your-app.vercel.app,https://your-app-*.vercel.app
```

### Step 4: Set Start Command

Railway Settings → Deploy → Custom Start Command:

```bash
npx prisma migrate deploy && node dist/server.js
```

Or use the `start` script from `package.json`:
```json
"start": "prisma migrate deploy && node dist/server.js"
```

### Step 5: Deploy & Seed

1. Railway will automatically build and deploy
2. After first deployment, run seed **once**:

```bash
railway ssh -- "npm run seed"
```

`railway run npm run seed` does **not** work — it runs on your machine while
injecting `DATABASE_URL=postgres.railway.internal`, which only resolves inside
Railway's private network. The seed must execute inside the container, hence
`railway ssh`.

The seed is idempotent (upsert on email), so it is safe to re-run.

---

## 🔐 Seeded Admin Credentials

After running the seed, use these credentials to login:

### Admin Account (for Admin Console)
```
Email: admin@paymytax.ng
Password: Admin@12345
```

### Test Developer Account (for Developer Portal)
```
Email: developer@test.com
Password: Test@12345
```

---

## 📋 Post-Deployment Checklist

- [ ] External API service deployed to Railway
- [ ] PostgreSQL database connected
- [ ] Migrations deployed (`prisma migrate deploy`)
- [ ] Seed script executed (`npm run seed`)
- [ ] Environment variables configured
- [ ] Backend URL copied (e.g., `https://external-api-app.railway.app`)
- [ ] Update frontend `VITE_EXTERNAL_API_BASE_URL` in Vercel

---

## 🔗 Connect Frontend to External API

After deploying the external-api to Railway:

1. **Copy Railway URL:**
   ```
   https://your-external-api-app.railway.app
   ```

2. **Update Frontend Environment Variable in Vercel:**
   - Go to Vercel Dashboard → Your Project → Settings → Environment Variables
   - Add or update:
     ```
     VITE_EXTERNAL_API_BASE_URL=https://your-external-api-app.railway.app
     ```

3. **Redeploy Frontend:**
   - Vercel will auto-redeploy when you update env vars
   - Or manually trigger redeploy

---

## 🧪 Test the Deployment

### 1. Health Check
```bash
curl https://your-external-api-app.railway.app/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-01-15T10:30:00.000Z"
}
```

### 2. Admin Login
```bash
curl -X POST https://your-external-api-app.railway.app/api/external/v1/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@paymytax.ng",
    "password": "Admin@12345"
  }'
```

Expected response:
```json
{
  "status": "success",
  "data": {
    "sessionToken": "...",
    "expiresIn": 43200,
    "admin": {
      "id": "...",
      "name": "PayMyTax Admin",
      "email": "admin@paymytax.ng",
      "role": "admin"
    }
  }
}
```

### 3. Test from Frontend
1. Visit: `https://your-app.vercel.app/admin/login`
2. Login with: `admin@paymytax.ng` / `Admin@12345`
3. You should be redirected to `/admin/platforms`

---

## 🐛 Troubleshooting

### Admin Login Fails

**Error:** Invalid credentials

**Causes:**
1. Seed script hasn't run yet
2. Using wrong credentials (should be `admin@paymytax.ng` / `Admin@12345`)
3. Wrong backend URL in frontend

**Fix:**
```bash
# Run seed inside the Railway container
railway ssh -- "npm run seed"

# Verify the admin row exists
railway ssh -- "npm run seed"   # re-runs upsert; prints the admin email
```

### CORS Errors

**Error:** Cross-origin request blocked

**Fix:**
1. Check `ALLOWED_ORIGINS` env var in Railway
2. Add your Vercel URL: `https://your-app.vercel.app`
3. Include preview URLs: `https://your-app-*.vercel.app`

### Database Connection Fails

**Fix:**
1. Verify PostgreSQL service is in same Railway project
2. Check `DATABASE_URL` is set automatically
3. View Railway logs for connection errors

---

## 📊 Monitoring

### View Logs
```bash
railway logs
```

### Check Database
```bash
railway run npx prisma studio
```

### View Metrics
Check Railway dashboard for:
- CPU usage
- Memory usage
- Request count
- Database connections

---

## 🔄 Continuous Deployment

Railway auto-deploys when you push to your connected branch:

```bash
git add .
git commit -m "Update external API"
git push origin main
# Railway automatically builds and deploys
```

---

## 🔐 Security Best Practices

1. ✅ Change default admin password after first login
2. ✅ Use strong, unique passwords
3. ✅ Enable CORS only for your frontend domains
4. ✅ Monitor Railway logs for suspicious activity
5. ✅ Keep dependencies updated: `npm audit fix`
6. ✅ Use environment variables, never hardcode secrets

---

## 📚 Additional Resources

- [Railway Documentation](https://docs.railway.app/)
- [Prisma Deployment Guide](https://www.prisma.io/docs/guides/deployment)
- [Express.js Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)

---

## 💡 Important Notes

### Two Separate Services

| Service | Purpose | Railway URL | Admin Credentials |
|---------|---------|-------------|-------------------|
| **backend** | Main WallXERP API (tax, businesses, users) | `backend-app.railway.app` | `admin@paymytax.com` / `Admin@123456` |
| **external-api** | External API for developers (sales, invoices, expenses) | `external-api-app.railway.app` | `admin@paymytax.ng` / `Admin@12345` |

### Which One Do I Deploy?

For the **External API Frontend** (developer portal), you need to deploy **`external-api`** service, NOT the main `backend` service.

---

## ✅ Summary

1. Deploy **`external-api`** folder to Railway (separate from main backend)
2. Add PostgreSQL database
3. Run migrations and seed
4. Use credentials: `admin@paymytax.ng` / `Admin@12345`
5. Update frontend `VITE_EXTERNAL_API_BASE_URL` with Railway URL
6. Test admin login at `/admin/login`

**You're all set!** 🚀

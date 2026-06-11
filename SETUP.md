# Umuhle — Production Setup Guide

> **Stack:** Next.js 14 · TypeScript · Tailwind CSS · Supabase · PayFast · WhatsApp Business API  
> **Estimated setup time:** 45–90 minutes

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Local Setup](#2-local-setup)
3. [Supabase Setup](#3-supabase-setup)
4. [Google OAuth](#4-google-oauth)
5. [Facebook OAuth](#5-facebook-oauth)
6. [PayFast Setup](#6-payfast-setup)
7. [WhatsApp Business API](#7-whatsapp-business-api)
8. [Deploy to Vercel](#8-deploy-to-vercel)
9. [Custom Domain](#9-custom-domain)
10. [Android APK (Capacitor)](#10-android-apk-capacitor)
11. [Environment Variables Reference](#11-environment-variables-reference)

---

## 1. Prerequisites

Install these before starting:

- **Node.js 18+** → https://nodejs.org
- **Git** → https://git-scm.com
- A **Supabase** account → https://supabase.com (free)
- A **Vercel** account → https://vercel.com (free)
- A **PayFast** merchant account → https://www.payfast.co.za
- A **Meta Business** account → https://business.facebook.com (for WhatsApp)

---

## 2. Local Setup

```bash
# Install dependencies
cd umuhle
npm install

# Copy environment variables
cp .env.example .env.local

# Start development server
npm run dev
```

Open http://localhost:3000 — you should see the Umuhle homepage.

> The site works with mock data. Complete the steps below to connect real services.

---

## 3. Supabase Setup

### 3.1 Create a project

1. Go to https://supabase.com/dashboard
2. Click **New Project**
3. Choose a name (e.g. `umuhle-prod`), set a database password, select region **af-south-1** (Cape Town) for best latency
4. Wait ~2 minutes for the project to provision

### 3.2 Run the database schema

1. In Supabase, go to **SQL Editor** → **New query**
2. Open `supabase/schema.sql` from this project
3. Paste the entire contents and click **Run**
4. You should see "Success" with no errors

### 3.3 Get your API keys

1. Go to **Project Settings** → **API**
2. Copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role / secret key** → `SUPABASE_SERVICE_ROLE_KEY` ⚠️ Never expose this in frontend code

### 3.4 Configure email auth

1. Go to **Authentication** → **Providers** → **Email**
2. Enable **Email confirmations** (optional but recommended for production)
3. Customise the confirmation email template under **Email Templates**

### 3.5 Configure storage buckets

In Supabase go to **Storage** → **New bucket** and create:

| Bucket name | Public | Purpose |
|---|---|---|
| `avatars` | ✅ Yes | Artist/user profile photos |
| `portfolio` | ✅ Yes | Artist portfolio images |
| `products` | ✅ Yes | Shop product images |

For each bucket, go to **Policies** and add:
- **SELECT**: `true` (public read)
- **INSERT/UPDATE/DELETE**: `auth.role() = 'authenticated'`

---

## 4. Google OAuth

### 4.1 Create a Google Cloud project

1. Go to https://console.cloud.google.com
2. Click **Select a project** → **New Project** → name it `Umuhle`
3. Go to **APIs & Services** → **OAuth consent screen**
4. Select **External**, fill in app name, support email, developer email
5. Add scope: `email`, `profile`, `openid`
6. Add your domain to **Authorised domains**: `umuhle.co.za`

### 4.2 Create OAuth credentials

1. Go to **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth 2.0 Client IDs**
2. Application type: **Web application**
3. Authorised redirect URIs:
   ```
   https://YOUR_PROJECT_ID.supabase.co/auth/v1/callback
   ```
   (replace YOUR_PROJECT_ID with your Supabase project ID)
4. Copy **Client ID** and **Client Secret**

### 4.3 Add to Supabase

1. In Supabase → **Authentication** → **Providers** → **Google**
2. Enable it, paste Client ID and Client Secret
3. Save

---

## 5. Facebook OAuth

### 5.1 Create a Meta app

1. Go to https://developers.facebook.com/apps
2. Click **Create App** → **Consumer** → name it `Umuhle`
3. Add the **Facebook Login** product

### 5.2 Configure Facebook Login

1. In the app dashboard, go to **Facebook Login** → **Settings**
2. Add **Valid OAuth Redirect URIs**:
   ```
   https://YOUR_PROJECT_ID.supabase.co/auth/v1/callback
   ```
3. Go to **Settings** → **Basic** → copy **App ID** and **App Secret**

### 5.3 Add to Supabase

1. In Supabase → **Authentication** → **Providers** → **Facebook**
2. Enable it, paste App ID and App Secret
3. Save

> **Note:** Facebook requires your app to go through App Review before other users can log in. During development, add test users under **Roles** → **Test Users**.

---

## 6. PayFast Setup

### 6.1 Sandbox testing

PayFast provides a free sandbox for testing. Use these credentials in `.env.local`:

```env
PAYFAST_MERCHANT_ID=10000100
PAYFAST_MERCHANT_KEY=46f0cd694581a
PAYFAST_ENV=sandbox
```

Test cards at https://sandbox.payfast.co.za — use any amount, the sandbox accepts all payments.

### 6.2 Live credentials

1. Log in at https://www.payfast.co.za
2. Go to **My Account** → **Settings** → **Developer Settings**
3. Copy your live **Merchant ID** and **Merchant Key**
4. Optionally set a **Passphrase** for extra security (add it to `PAYFAST_PASSPHRASE`)
5. Update `.env.local`:
   ```env
   PAYFAST_MERCHANT_ID=your_live_merchant_id
   PAYFAST_MERCHANT_KEY=your_live_merchant_key
   PAYFAST_ENV=live
   ```

### 6.3 Configure the ITN webhook

The ITN (Instant Transaction Notification) is PayFast's webhook — it notifies you when a payment is completed.

1. In PayFast → **My Account** → **Settings** → **Developer Settings**
2. Set **Notify URL** to: `https://umuhle.co.za/api/payfast/notify`
3. The code in `app/api/payfast/notify/route.ts` handles this automatically — it validates the ITN, updates the booking to `confirmed`, and sends WhatsApp notifications.

### 6.4 Return & Cancel URLs

These are configured automatically in `lib/payfast.ts` based on `NEXT_PUBLIC_APP_URL`. You can add `/payment/success` and `/payment/cancel` pages for a polished post-payment experience (not included by default but easy to add).

---

## 7. WhatsApp Business API

### 7.1 Set up Meta Business & WhatsApp

1. Go to https://business.facebook.com → create a Business Account if you don't have one
2. Go to https://developers.facebook.com → **Create App** → **Business** → name it `Umuhle Notifications`
3. Add the **WhatsApp** product to the app
4. Go to **WhatsApp** → **API Setup**

### 7.2 Add a phone number

1. You can use the free **test phone number** Meta provides for development
2. For production, click **Add phone number** and follow the verification steps
3. You'll need a real phone number that isn't already on WhatsApp (a new SIM works)

### 7.3 Get credentials

1. In **WhatsApp** → **API Setup**, copy:
   - **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`
2. Go to **System Users** → create a system user → assign your app → generate a token with `whatsapp_business_messaging` permission
3. Copy the token → `WHATSAPP_ACCESS_TOKEN`

> ⚠️ The **temporary token** on the API Setup page expires in 24h. Use a permanent system user token for production.

### 7.4 Message templates (production)

For production (outside the 24h conversation window), you need approved **message templates**:

1. In **WhatsApp Manager** → **Message Templates** → **Create Template**
2. Create these templates (match the names in `lib/whatsapp.ts`):

| Template name | Category | Example body |
|---|---|---|
| `booking_confirmed` | UTILITY | Hi {{1}}, your booking with {{2}} on {{3}} at {{4}} is confirmed! 💜 |
| `booking_reminder` | UTILITY | Reminder: your appointment with {{1}} is tomorrow at {{2}}. |

3. Wait for Meta approval (usually 24–48 hours)
4. Update `lib/whatsapp.ts` to use `sendTemplateMessage()` instead of `sendTextMessage()` once templates are approved.

> **During development**, `sendTextMessage()` works fine within the 24h window.

### 7.5 Webhook (optional for receiving messages)

If you want to receive messages from users, configure the Webhook in the Meta app:
- **Callback URL**: `https://umuhle.co.za/api/whatsapp/webhook`
- **Verify token**: any string you choose (add as env var `WHATSAPP_WEBHOOK_TOKEN`)

---

## 8. Deploy to Vercel

### 8.1 Push to GitHub

```bash
git init
git add .
git commit -m "Initial Umuhle production build"
git remote add origin https://github.com/YOUR_USERNAME/umuhle.git
git push -u origin main
```

### 8.2 Deploy

1. Go to https://vercel.com/new
2. Import your GitHub repository
3. Framework: **Next.js** (auto-detected)
4. Under **Environment Variables**, add ALL variables from `.env.example` with their real values
5. Click **Deploy**

### 8.3 Set production APP URL

After deployment, update your environment variable:
```
NEXT_PUBLIC_APP_URL=https://umuhle.vercel.app
```
(or your custom domain once set up)

Redeploy after updating env vars: **Vercel Dashboard** → **Deployments** → **Redeploy**.

---

## 9. Custom Domain

### 9.1 Add domain in Vercel

1. **Vercel Dashboard** → your project → **Settings** → **Domains**
2. Add `umuhle.co.za` and `www.umuhle.co.za`
3. Copy the DNS records Vercel provides

### 9.2 Update DNS with your registrar

Add these DNS records at your domain registrar:

| Type | Name | Value |
|---|---|---|
| A | @ | 76.76.21.21 |
| CNAME | www | cname.vercel-dns.com |

DNS propagation takes 15 minutes to 48 hours.

### 9.3 Update Supabase redirect URLs

Once your domain is live, add it to Supabase:

1. **Authentication** → **URL Configuration**
2. **Site URL**: `https://umuhle.co.za`
3. **Redirect URLs** (add all):
   ```
   https://umuhle.co.za/auth/callback
   https://www.umuhle.co.za/auth/callback
   http://localhost:3000/auth/callback
   ```

---

## 10. Android APK (Capacitor)

To package Umuhle as an Android app:

```bash
# Install Capacitor
npm install @capacitor/core @capacitor/cli @capacitor/android

# Build Next.js as static export (update next.config.ts: output: 'export')
npm run build

# Init Capacitor
npx cap init Umuhle co.za.umuhle --web-dir=out

# Add Android platform
npx cap add android

# Sync
npx cap sync

# Open in Android Studio
npx cap open android
```

In Android Studio:
1. **Build** → **Generate Signed Bundle / APK**
2. Create a keystore file (keep it safe — you need it for all future updates)
3. Build the APK
4. For Play Store, build an **AAB** (Android App Bundle) instead

> **Note:** For the static export to work with Next.js App Router, you'll need to convert dynamic routes. This is an advanced step — reach out if you need help.

---

## 11. Environment Variables Reference

| Variable | Where to find it | Required |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Your deployment URL | ✅ |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API | ✅ |
| `PAYFAST_MERCHANT_ID` | PayFast → Settings → Developer | ✅ |
| `PAYFAST_MERCHANT_KEY` | PayFast → Settings → Developer | ✅ |
| `PAYFAST_PASSPHRASE` | PayFast → Settings (if enabled) | Optional |
| `PAYFAST_ENV` | `sandbox` or `live` | ✅ |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta → WhatsApp → API Setup | ✅ |
| `WHATSAPP_ACCESS_TOKEN` | Meta → System Users → Token | ✅ |

---

## Checklist: Go-Live

- [ ] Supabase schema applied
- [ ] Google OAuth configured
- [ ] Facebook OAuth configured  
- [ ] PayFast live credentials set
- [ ] PayFast ITN webhook URL pointing to production
- [ ] WhatsApp phone number verified
- [ ] WhatsApp templates approved (or using text messages for now)
- [ ] All env vars set in Vercel
- [ ] Custom domain configured
- [ ] Supabase redirect URLs updated for production domain
- [ ] Test a complete booking flow end-to-end
- [ ] Test WhatsApp notification is received

---

*Need help? The codebase is fully documented. Each API route and utility file has comments explaining what it does.*

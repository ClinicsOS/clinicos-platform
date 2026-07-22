<div align="center">

# 🏥 ClinicOS

### Modern Multi-Tenant SaaS Platform for Clinic Management

**Run your clinic on autopilot — appointments, patient records, and invoices in one smart system.**

[![Next.js](https://img.shields.io/badge/Next.js-14-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20-green?style=flat-square&logo=node.js)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-green?style=flat-square&logo=mongodb)](https://mongodb.com/)
[![License](https://img.shields.io/badge/license-Proprietary-red?style=flat-square)]()

[🌐 Live Demo](https://clinicos-platform.vercel.app) · [📧 Contact](mailto:clinicos.system@gmail.com)

</div>

---

## 📖 About ClinicOS

**ClinicOS** is a modern, multi-tenant SaaS platform designed specifically for private clinics in Jordan and the MENA region. Built from the ground up to solve real-world clinic management challenges — from appointment scheduling to patient records, invoicing, and online booking.

Whether you're running a single practice or managing multiple clinics, ClinicOS provides everything you need to focus on what matters most: **your patients**.

---

## ✨ Key Features

### 👨‍⚕️ For Clinic Owners
- **Multi-tenant architecture** — each clinic operates independently with isolated data
- **Team management** — invite doctors and receptionists with role-based permissions
- **Custom booking page** — every clinic gets its own branded booking URL (`clinicos.jo/book/your-clinic`)
- **Comprehensive reporting** — revenue, appointments, patient demographics (Pro plan)
- **Full data export** — download all your clinic data as JSON at any time
- **Brand customization** — set your clinic's brand color (Pro plan)

### 📅 Appointment Management
- Smart scheduling with conflict detection
- Public booking page for patients
- Booking tracking system (patients get a code to check status)
- Multiple appointment statuses (scheduled, confirmed, completed, cancelled, no-show)
- Working hours configuration per day
- Adjustable slot duration

### 👥 Patient Records
- Complete patient profiles with medical notes
- Appointment history
- Invoice tracking
- Search and filter capabilities

### 💰 Invoicing & Payments
- Create and manage invoices
- Track partial payments
- Payment method tracking (Cash, Card, CliQ, Bank Transfer)
- Overdue payment alerts
- PDF/Excel export (Pro plan)

### 🔐 Security & Authentication
- Secure JWT-based authentication
- Password reset via email
- Email verification
- Auto-logout on session expiry
- Password strength validation
- Change password with strength indicator

### 🎨 User Experience
- **Bilingual** — Full English and Arabic support with RTL
- **Dark/Light mode** — automatic theme switching
- **Toast notifications** — beautiful feedback system
- **Confirmation dialogs** — prevent accidental deletions
- **Skeleton loading** — smooth loading experiences
- **Fully responsive** — works on desktop, tablet, and mobile

### 📊 Subscription System
Three-tier pricing model:

| Feature | Trial | Basic (19 JOD/mo) | Pro (29 JOD/mo) |
|---------|-------|-------------------|-----------------|
| Doctors | 1 | 5 | Unlimited |
| Receptionists | 1 | 2 | Unlimited |
| Appointments | 20 total | Unlimited | Unlimited |
| Invoices | 2 total | 30/month | Unlimited |
| Reports | ❌ | ❌ | ✅ |
| PDF/Excel Export | ❌ | ❌ | ✅ |
| Custom Brand Color | ❌ | ❌ | ✅ |

---

## 🛠️ Tech Stack

### Backend
- **Runtime:** Node.js 20
- **Framework:** Express.js 4.19
- **Language:** TypeScript 5.5
- **Database:** MongoDB Atlas (via Mongoose 8.5)
- **Authentication:** JWT + bcrypt
- **Validation:** Zod
- **Email:** Nodemailer + Brevo SMTP
- **Deployment:** Render

### Frontend
- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript 5.5
- **Styling:** Tailwind CSS
- **State Management:** Zustand
- **Data Fetching:** TanStack Query (React Query)
- **HTTP Client:** Axios
- **Icons:** Tabler Icons
- **Deployment:** Vercel

### Infrastructure
- **Version Control:** Git + GitHub
- **CI/CD:** Automatic deployment via Vercel & Render
- **Email Service:** Brevo (300 emails/day free tier)
- **Database Hosting:** MongoDB Atlas (Free tier)

---

## 🚀 Getting Started

### Prerequisites
- Node.js 20 or higher
- MongoDB Atlas account
- Brevo account (for email sending)

### Installation

**1. Clone the repository**
```bash
git clone https://github.com/ClinicsOS/clinicos-platform.git
cd clinicos-platform
```

**2. Backend Setup**
```bash
cd backEnd
npm install
cp .env.example .env
# Edit .env with your credentials
npm run dev
```

**3. Frontend Setup** (in a new terminal)
```bash
cd frontEnd
npm install
cp .env.example .env
# Edit .env with your API URL
npm run dev
```

**4. Open the app**
```
Frontend: http://localhost:3000
Backend:  http://localhost:5000
```

### Environment Variables

**Backend (`backEnd/.env`):**
```env
PORT=5000
JWT_SECRET=your-secret-key
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/clinicos
APP_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3000

# Email (Brevo SMTP)
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your-brevo-login
SMTP_PASS=your-brevo-key
MAIL_FROM=ClinicOS <your@email.com>
```

**Frontend (`frontEnd/.env`):**
```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api
```

---

## 📁 Project Structure

```
clinicos-platform/
├── backEnd/                 # Node.js + Express API
│   ├── src/
│   │   ├── config/          # Database & plans config
│   │   ├── controllers/     # Route handlers
│   │   ├── middleware/      # Auth, error handling
│   │   ├── models/          # Mongoose schemas
│   │   ├── routes/          # API routes
│   │   ├── services/        # Email service
│   │   ├── types/           # TypeScript definitions
│   │   └── index.ts         # Entry point
│   ├── .env.example
│   └── package.json
│
├── frontEnd/                # Next.js 14 App
│   ├── src/
│   │   ├── app/             # App Router pages
│   │   │   ├── (dashboard)/ # Protected dashboard routes
│   │   │   ├── book/        # Public booking pages
│   │   │   ├── signin/      # Authentication
│   │   │   ├── signup/
│   │   │   ├── forgot-password/
│   │   │   ├── reset-password/
│   │   │   └── verify-email/
│   │   ├── components/      # Reusable components
│   │   ├── lib/             # Utilities (api, i18n, theme)
│   │   └── store/           # Zustand stores
│   ├── .env.example
│   └── package.json
│
└── README.md
```

---

## 🌍 Deployment

The platform is deployed on:

- **Frontend:** [Vercel](https://vercel.com) → `https://clinicos-platform.vercel.app`
- **Backend:** [Render](https://render.com) → `https://clinicos-api-72ff.onrender.com`
- **Database:** [MongoDB Atlas](https://mongodb.com/atlas)
- **Email:** [Brevo SMTP](https://brevo.com)

Both frontend and backend automatically redeploy on every push to `main`.

---

## 🎯 Roadmap

### ✅ Completed
- [x] Multi-tenant architecture
- [x] Full authentication system with email verification
- [x] Appointment management with public booking
- [x] Patient records
- [x] Invoicing system
- [x] Subscription plans (Trial, Basic, Pro)
- [x] Bilingual UI (EN/AR) with RTL
- [x] Dark/Light theme
- [x] Password reset flow
- [x] Data export
- [x] Toast notifications & confirm dialogs
- [x] Production deployment

### 🚧 In Progress
- [ ] Promotional video and marketing content
- [ ] First customer onboarding

### 📅 Planned
- [ ] Subscription lifecycle automation (grace period, expiry handling)
- [ ] Admin dashboard for platform management
- [ ] Automated payment gateway (Stripe/HyperPay)
- [ ] SMS notifications
- [ ] Custom domain support for clinics
- [ ] Mobile app (React Native)
- [ ] Analytics dashboard for clinic owners
- [ ] Prescription management
- [ ] Lab results integration

---

## 🌐 Live Demo

Try ClinicOS live: **[clinicos-platform.vercel.app](https://clinicos-platform.vercel.app)**

Sign up for a 7-day free trial — no credit card required.

---

## 📧 Contact & Support

- **Email:** [clinicos.system@gmail.com](mailto:clinicos.system@gmail.com)
- **Location:** Amman, Jordan 🇯🇴

For clinic owners interested in subscribing or requesting a demo, please reach out via email.

---

## 👨‍💻 Author

**Amjad Aboshawer**
Software Engineering Student at The Hashemite University
Building modern SaaS solutions for the MENA region.

---

## ⚖️ License

**Proprietary — All Rights Reserved © 2026 ClinicOS**

This project is proprietary software. Unauthorized copying, distribution, or modification is strictly prohibited without written permission from the owner.

---

<div align="center">

**Built with Amjad Abo Shawar in Jordan**

*Making clinic management smarter, one appointment at a time.*

</div>

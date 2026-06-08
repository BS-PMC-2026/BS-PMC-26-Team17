# ToSafePlace

A mobile app that helps people in Israel find and navigate to the nearest safe shelter during emergencies (rocket sirens, civil-defense alerts). Users get real-time notifications, turn-by-turn navigation, and a community-reporting system so the shelter database stays accurate.

> **Status:** Coursework / hackathon project — BS-PMC-26-Team17.

---

## Features

### For users
- **Live map of shelters** — every public shelter, school, parking, and other safe space pinned on the map, color-coded by status (open / closed / locked / full).
- **Navigate to a shelter** — pick any shelter or anywhere on the map and get turn-by-turn directions tailored to your transport mode (walking / cycling / driving).
- **Home address with "Do Not Notify" radius** — set your home location either by typing it (Nominatim autocomplete, Israel-restricted) or tapping the map. A circle is drawn on the map showing the radius within which the app won't alert you.
- **Reports** — tap any shelter to file a report (access issue, capacity, cleanliness, damage, other). Reports include the reporter's location so managers can verify the report was made within 50 m of the shelter.
- **Forgot password / OTP reset** — full email-based 3-step recovery flow (request code → verify → reset).
- **Login / Register** with email & password.
- **Early warning navigation** — when a civil-defense early warning is active, the app filters nearby shelters by estimated arrival time, accessibility, pet policy, and available capacity using demographic balancing.
- **Emergency numbers page** — dedicated screen with emergency organization contact numbers.
- **Number of people** — select how many people are navigating to reserve capacity at the shelter.
- **Location simulator (joystick)** — joystick overlay for testing navigation without physically moving.

### For managers (admin role)
- **Shelter Dashboard** — searchable, filterable table view of every shelter with cleanliness, accessibility, and last-report info.
- **Add Shelter** — register new safe spaces.
- **Verified reports** — reports automatically tagged `isVerified: true` when the reporter was physically near the shelter, helping triage real issues vs. false alarms.
- **Broadcast messages** — admin can send important messages to all users.
- **Real-time push notifications** — managers receive push notifications when shelter reports are filed.
- **Building committee registration** — users can register as building committee representatives with supporting documents.
- **Admin buildings dashboard** — admin can approve or reject building registrations and view the committee declaration certificate.
- **Entrance code display** — approved building entrance codes are shown during active siren alerts.
- **Alternative navigation** — when a shelter cannot be reached in time during a siren, users are navigated to the nearest approved building with its entrance code.
- **Cancel registration** — committee representatives can cancel their building registration.

### Psychology chatbot
- **AI-powered support** — chatbot providing psychological support and guidance during emergencies.

### Polish & accessibility
- Drawer (side) navigation
- Hebrew RTL support on data-heavy screens
- Accessibility mode (prefer step-free shelters)
- Works on Android, iOS, and Web (with a web-only map fallback)

---

## Tech Stack

| Layer | Tech |
|---|---|
| **Mobile** | React Native 0.81 + Expo SDK 54, Expo Router (file-based), React Context for auth |
| **Maps** | `react-native-maps` (Google Maps on Android, Apple Maps on iOS), `react-native-webview` (Leaflet on web) |
| **Backend** | Python 3.11+ FastAPI, Uvicorn |
| **Database** | MongoDB Atlas (async via `motor`) |
| **Email** | Gmail SMTP (for OTP password reset) |
| **Auth** | Custom email/password, role-based (`user` / `admin`) |
| **Testing** | pytest + pytest-asyncio (backend), Jest + React Native Testing Library (frontend) |
| **CI** | GitHub Actions (lint + type-check + tests on every push/PR to `main`, `dev`, `hackton-2026`) |

---

## Repository Layout

```
BS-PMC-26-Team17/
├── Backend/
│   ├── app/
│   │   ├── main.py              FastAPI entry point
│   │   ├── core/
│   │   │   ├── database.py      MongoDB connection (motor)
│   │   │   └── mailer.py        Gmail SMTP helper
│   │   ├── routes/              auth, shelters, reports, settings, admin, health
│   │   └── models.py            Pydantic request/response models
│   ├── tests/                   pytest suite (unit + integration)
│   ├── scraper/                 Demographic scraper (daily shelter-capacity sync)
│   ├── sync/                    Scheduled shelter sync
│   ├── requirements.txt
│   └── .env                     ← not in git; you create this locally
├── frontend/
│   ├── app/                     Expo Router screens
│   │   ├── (tabs)/              Authenticated drawer screens (Home, Map, Settings, ShelterDashboard, AddShelter)
│   │   ├── login.tsx
│   │   ├── register.tsx
│   │   ├── forgot-password.tsx
│   │   ├── report.tsx
│   │   └── navigate.tsx
│   ├── components/              Themed UI building blocks
│   ├── context/                 Auth context provider
│   ├── tests/                   Jest unit tests
│   ├── __tests__/               Jest integration tests
│   └── package.json
└── .github/workflows/ci.yml     CI pipeline
```

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | **20.x** |
| npm | 10.x (ships with Node 20) |
| Python | **3.11+** |
| MongoDB | Atlas account (free tier is enough) |
| Expo Go app | Latest, on your phone — for testing on real devices |
| Gmail account | With 2FA + an [App Password](https://myaccount.google.com/apppasswords) for SMTP |
| Google Maps API key | For Android maps — already configured in `frontend/app.json` |

---

## Installation

Clone the repo:

```bash
git clone https://github.com/BS-PMC-2026/BS-PMC-26-Team17.git
cd BS-PMC-26-Team17
```

### 1. Backend

```bash
cd Backend
python -m venv .venv
.venv\Scripts\activate            # Windows
# source .venv/bin/activate       # macOS / Linux
pip install -r requirements.txt
pip install pytest pytest-asyncio httpx     # test deps (not in requirements.txt)
```

Create `Backend/.env` (gitignored — never commit this):

```env
APP_NAME=ToSafePlace
DEBUG=True

# MongoDB Atlas
MONGODB_URL=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?appName=Cluster0
DATABASE_NAME=tosafe_place

# External APIs (optional — used by scraper / map)
OPENCAGE_API_KEY=
GOOGLE_MAPS_API_KEY=

# Gmail SMTP (required for the forgot-password OTP flow)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your.bot.address@gmail.com
SMTP_PASS=your-16-character-app-password
SMTP_FROM_NAME=ToSafePlace
```

> **Gmail SMTP setup:** Enable 2-Step Verification on the Gmail account, then generate an [App Password](https://myaccount.google.com/apppasswords). Paste the 16-character password into `SMTP_PASS` **without spaces**.

### 2. Frontend

```bash
cd ../frontend
npm install
```

Optional — if you want to point the app at a different backend URL (e.g., your machine's LAN IP so a real phone can reach it), create `frontend/.env.local`:

```env
EXPO_PUBLIC_API_URL=http://192.168.1.42:8000
```

---

## Running the App

### Start the backend

```bash
cd Backend
.venv\Scripts\activate            # Windows
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

The API is now at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

### Start the frontend

In a separate terminal:

```bash
cd frontend
npm start
```

This opens Expo. From there:
- **Phone:** scan the QR code with the Expo Go app
- **Android emulator:** press `a`
- **iOS simulator:** press `i` (macOS only)
- **Web:** press `w`

> If running on a real device, make sure `EXPO_PUBLIC_API_URL` points to your machine's LAN IP (not `localhost`) so the phone can reach the backend.

---

## Running the Tests

### Backend
```bash
cd Backend
pytest --tb=short -v
```

### Frontend
```bash
cd frontend
npm run lint                     # ESLint
npx tsc --noEmit                 # TypeScript type check
npm test -- --watchAll=false     # Jest unit + integration tests
```

All three run in CI on every push/PR.

---

## Backend Dependencies

From `Backend/requirements.txt`:

| Package | Purpose |
|---|---|
| `fastapi` | Async web framework |
| `uvicorn[standard]` | ASGI server |
| `motor` | Async MongoDB driver |
| `pydantic` | Request/response validation |
| `python-dotenv` | `.env` loading |
| `certifi` | TLS certs for Mongo Atlas |
| `mongoengine` | (legacy — not currently in active use) |
| `requests` | Used by scraper |

Test-only (install separately): `pytest`, `pytest-asyncio`, `httpx`.

---

## Frontend Dependencies

Key packages from `frontend/package.json`:

| Package | Purpose |
|---|---|
| `expo` ~54 | Expo SDK |
| `expo-router` | File-based routing |
| `react-native` 0.81 / `react` 19 | Mobile runtime |
| `react-native-maps` | Native maps (Android/iOS) |
| `react-native-webview` | Web fallback for the map |
| `expo-location` | GPS + reverse geocoding |
| `@react-navigation/drawer` | Side-drawer navigation |
| `react-native-safe-area-context` | Notch/Dynamic-Island handling |
| `@react-native-async-storage/async-storage` | Local persistence for user settings |
| `@expo/vector-icons` | Ionicons used throughout the UI |
| `axios` | HTTP client (used in a few places) |
| `expo-file-system` | Local file system access |
| `expo-intent-launcher` | Open files with native apps on Android |
| `expo-sharing` | Share and preview files on iOS |

Dev / test: `jest`, `jest-expo`, `@testing-library/react-native`, `typescript`, `eslint`, `eslint-config-expo`.

---

## API Overview

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health`, `/api/ping` | Health checks |
| `POST` | `/auth/register` | Create an account |
| `POST` | `/auth/login` | Authenticate |
| `POST` | `/auth/forgot-password` | Email an OTP code |
| `POST` | `/auth/verify-reset-code` | Validate OTP (no consumption) |
| `POST` | `/auth/reset-password` | Set a new password using OTP |
| `GET` | `/shelters` | List shelters (filters: city, area, place_type, status, search) |
| `POST` | `/shelters` | Add a shelter (admin only) |
| `DELETE`| `/shelters/{id}` | Remove a shelter (admin only) |
| `POST` | `/reports` | File a shelter report (computes `isVerified` against reporter coords) |
| `GET` | `/reports` | List all reports (admin) |
| `POST` | `/api/settings` | Save user settings to MongoDB |
| `GET` | `/api/settings/{user_id}` | Fetch user settings |
| `GET` | `/buildings` | List all buildings (admin) |
| `POST` | `/buildings/register` | Register as committee representative |
| `PATCH` | `/buildings/{id}/approve` | Approve building registration (admin) |
| `PATCH` | `/buildings/{id}/reject` | Reject building registration (admin) |
| `GET` | `/buildings/approved` | List approved buildings with entrance codes |
| `GET` | `/buildings/{id}/permit` | Get committee certificate file |
| `POST` | `/api/broadcasts` | Send broadcast message to all users (admin) |

Auto-generated docs are available at `http://localhost:8000/docs` once the backend is running.

---

## Common Issues

- **"Cannot connect to server"** in the app — make sure your backend is running AND your `EXPO_PUBLIC_API_URL` points to a host the phone can actually reach (not `localhost` from a real device).
- **Map shows blank tiles on Android** — verify `GOOGLE_MAPS_API_KEY` in `frontend/app.json` is valid and Maps SDK for Android is enabled in Google Cloud Console.
- **OTP email never arrives** — check spam folder; verify Gmail App Password is correct and 2FA is on; check backend console — if SMTP isn't configured the code is logged there (dev mode only).
- **`npm ci` fails in CI but `npm install` works locally** — `package-lock.json` is out of sync. Commit it after every dependency change.

---

## Team

BS-PMC-26 — Team 17 (Sami Shamoon, project management course).

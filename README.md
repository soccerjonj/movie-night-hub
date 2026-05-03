# Movie Club Hub

A social club app for groups of friends who watch movies or read books together. Members take turns picking titles each season, guess who picked what, rank everything they've watched, and earn badges based on their taste — all tracked in one place.

---

## Features

### Clubs
- Supports **movie clubs** and **book clubs** — the entire UI adapts labels, flows, and integrations accordingly
- Invite code system for joining existing clubs
- Multiple clubs per account with a home screen showing each club's status at a glance

### Seasons & Phases
Each season moves through a structured set of phases:

| Phase | Description |
|-------|-------------|
| **Picking** | Members submit their title pick for the season |
| **Guessing** | Members guess which pick belongs to whom |
| **Watching** | The club works through the pick list together |
| **Reviewing** | Members rank all the titles they watched |
| **Completed** | Season archived; scores locked in |

### Guessing Game
When guessing is enabled, members anonymously pick a title and others try to figure out who picked it. Accuracy is tracked per member and shown on their profile.

### Rankings & Scoreboard
Members rank each other's picks after watching. Rankings power the scoreboard, badge calculations, and per-member taste breakdowns.

### Badges
Ten badges earned automatically based on TMDB data and group behavior:

| Badge | Criteria |
|-------|----------|
| 🍿 Crowd Pleaser | Picks consistently loved by the group |
| 💎 Hidden Gems | Finds low-popularity films the group ends up loving |
| 🆕 Futurist | Always picks recent releases |
| 🏛️ Time Traveler | Frequently picks classic films |
| ⏳ Epic Picker | Picks long runtimes |
| ⚡ Quick Watch | Picks short films |
| ⭐ Critic's Choice | Picks highly rated films |
| 🎯 Group Favorite | Picks become the group's favorite of the season |
| 💔 Bold Choices | Picks that are polarizing or disliked |
| 🛋️ Casual Viewer | Low engagement with guessing and rankings |

### Member Profiles
Full-screen profile pages showing a member's picks, badges, guessing accuracy, ranking average, and club taste insights.

### Stats
Club-wide breakdowns of genres, languages, countries, decades, directors, actors, and production companies — pulled from TMDB.

### Admin Tools
Season creation and management, member invite/management, phase advancement, meeting scheduler, and a first-time setup walkthrough.

---

## Tech Stack

| Layer | Tools |
|-------|-------|
| Frontend | React 18, TypeScript, Vite |
| Routing | React Router v6 |
| UI | shadcn/ui, Radix UI, Tailwind CSS |
| Animation | Framer Motion |
| Charts | Recharts |
| Icons | Lucide React |
| Backend | Supabase (Postgres + Auth + Storage) |
| External APIs | TMDB, Google Books, Google Maps/Places |
| PWA | vite-plugin-pwa |

---

## Getting Started

### Prerequisites
- Node.js 18+
- A [Supabase](https://supabase.com) project
- A [TMDB](https://www.themoviedb.org/settings/api) API token
- (Optional) Google Books and Google Maps API keys

### Setup

```bash
git clone <repo-url>
cd movie-night-hub
npm install
```

Create a `.env` file in the root:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
VITE_TMDB_API_TOKEN=your_tmdb_bearer_token
VITE_GOOGLE_BOOKS_API_KEY=your_google_books_key
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_key
```

```bash
npm run dev
```

Open [http://localhost:8080](http://localhost:8080).

### Build

```bash
npm run build
```

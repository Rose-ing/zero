# Zero — Outbound Campaign Platform

**Find leads. Launch campaigns. Know your CAC. All in one place.**

Zero is an AI-powered outbound platform that lets you create projects, launch controlled multi-channel campaigns, track every interaction in real time, and know exactly how much each customer costs to acquire.

---

## The Pitch

> Most businesses waste thousands on ads without knowing their real cost per customer. Zero flips the model: you describe who you sell to, we find them across Google Maps, Facebook, Instagram, and LinkedIn — then we reach out through phone calls, emails, SMS, and WhatsApp. Every touchpoint is tracked. Every dollar is accounted for. You see your full acquisition funnel in a single dashboard.

**In 30 seconds:**
1. Create a project and describe your ideal customer
2. Zero searches across Maps, social networks, and public directories
3. AI scores and qualifies every lead automatically
4. Launch a campaign: emails, WhatsApp, SMS, or AI-powered phone calls
5. Watch your funnel update in real time — from universe to closed deal
6. Know your exact CAC (Customer Acquisition Cost) at every stage

---

## What It Does

### Lead Discovery at Scale
Pull potential customers from multiple sources:
- **Google Maps** — local businesses with ratings, reviews, and contact info
- **Facebook & Instagram** — business pages, engagement signals
- **LinkedIn** — company profiles, decision makers
- All enriched with emails, phone numbers, and social handles

### Multi-Channel Outreach
Reach leads through the channel that works best:
- **AI Phone Calls** — voice agents that pitch, qualify, and book meetings
- **Email** — personalized outreach at scale
- **WhatsApp** — direct messaging with templates
- **SMS** — short-form follow-ups

### Real-Time Dashboard
Full visibility into your pipeline:
- **Funnel view**: Universe → Reached → Responded → Interested → Meeting Booked
- **Conversion cards**: see exactly where leads are in the pipeline
- **Channel breakdown**: performance by email, phone, WhatsApp
- **Cost tracking**: know your CAC at every funnel stage
- **Activity feed**: live stream of every interaction as it happens

### Projects & Campaigns
Organize your work:
- Create multiple **projects** (one per product, market, or team)
- Run **N campaigns** per project with different targeting
- Leave campaigns running and come back tomorrow to check results
- Compare campaign performance side by side
- Re-run campaigns to improve response rates

---

## Architecture

```
┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐
│ Google Maps │  │   Facebook   │  │  Instagram   │  │   LinkedIn    │
│   Places    │  │   Pages API  │  │  Graph API   │  │   Search      │
└──────┬──────┘  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘
       └────────────────┴────────┬────────┴───────────────────┘
                                 ▼
                    ┌────────────────────┐
                    │   Lead Discovery   │
                    │   + Enrichment     │
                    │   + AI Scoring     │
                    └─────────┬──────────┘
                              ▼
              ┌───────────────────────────────┐
              │     Campaign Orchestrator     │
              └───┬──────┬──────┬─────────┬──┘
                  ▼      ▼      ▼         ▼
              ┌──────┐┌──────┐┌─────┐┌──────────┐
              │Email ││ SMS  ││ WA  ││AI Calls  │
              └──┬───┘└──┬───┘└──┬──┘└────┬─────┘
                 └───────┴───────┴────────┘
                              ▼
                    ┌──────────────────┐
                    │    Dashboard     │
                    │  Funnel · CAC ·  │
                    │  Reports · Feed  │
                    └──────────────────┘
```

---

## Stack

- **Backend**: Go (stdlib, zero dependencies)
- **AI**: Claude API (Anthropic) — intake agent, lead scoring, call classification
- **Lead Sources**: Google Places API (New), extensible to social APIs
- **Frontend**: Vanilla HTML/CSS/JS — Geist font, light theme
- **Persistence**: localStorage (MVP), designed for Postgres migration
- **Deploy**: Vercel-ready

---

## Getting Started

```bash
git clone https://github.com/Rose-ing/zero.git
cd zero
cp .env.example .env    # add your keys
go run main.go
# open http://localhost:8080
```

### Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...     # Claude API for AI agent + scoring
GOOGLE_PLACES_API_KEY=AIza-...   # Google Maps lead discovery
PORT=8080                         # Server port
```

---

## Roadmap

- [x] Chat-based intake agent (Claude)
- [x] Google Maps lead discovery + enrichment
- [x] AI scoring with Haiku (fit, contact, health, likelihood)
- [x] Campaign builder with budget/reach sliders
- [x] Real-time campaign simulation with funnel tracking
- [x] Project & campaign management with persistence
- [x] Conversion funnel: Universe → Reached → Responded → Interested → Booked
- [ ] Facebook & Instagram lead discovery
- [ ] LinkedIn company search
- [ ] Live email sending (SendGrid/Resend)
- [ ] WhatsApp Business API integration
- [ ] SMS outreach (Twilio)
- [ ] AI voice calls (ElevenLabs + Twilio)
- [ ] Postgres database (Supabase)
- [ ] Email open/click tracking
- [ ] Campaign scheduling & re-runs
- [ ] CAC calculator with real cost data
- [ ] Export reports (CSV, PDF)
- [ ] Team collaboration & permissions

---

## License

Private — All rights reserved.

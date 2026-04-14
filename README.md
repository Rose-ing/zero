# Zero — Café Protein Outbound Engine

Sistema de prospección y venta automatizada para colocar nuestro café con proteína en cafeterías de Palermo (CABA). Scrapea Google Maps, califica leads con scoring automático, y dispara llamadas salientes con un agente de voz (ElevenLabs + Twilio) que pitchea, califica interés y agenda reuniones. Dashboard en tiempo real con el funnel completo.

---

## 🎯 Objetivo

Reemplazar el trabajo manual de: (1) buscar cafeterías, (2) llamar una por una, (3) hacer el pitch, (4) agendar reunión — con un pipeline end-to-end que corre solo y nos deja las reuniones en el calendario.

---

## 🏗️ Arquitectura

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│ Google Places   │─────▶│  Research Worker │─────▶│  Supabase DB    │
│ API (source)    │      │  (Inngest job)   │      │  (leads table)  │
└─────────────────┘      └──────────────────┘      └────────┬────────┘
                                                             │
                         ┌───────────────────────────────────┘
                         ▼
                  ┌──────────────┐     ┌──────────────┐
                  │  Qualifier   │────▶│   Queue      │
                  │ (scoring)    │     │ (ready_to_   │
                  └──────────────┘     │   call)      │
                                       └──────┬───────┘
                                              │
                                              ▼
                                    ┌──────────────────┐
                                    │ Call Dispatcher  │
                                    │ (ElevenLabs +    │
                                    │  Twilio)         │
                                    └────────┬─────────┘
                                             │
                        ┌────────────────────┼────────────────────┐
                        ▼                    ▼                    ▼
                 ┌────────────┐      ┌────────────┐       ┌────────────┐
                 │ Transcript │      │  Outcome   │       │  Follow-up │
                 │  webhook   │      │  classifier│       │   tasks    │
                 └────────────┘      └────────────┘       └────────────┘
                                             │
                                             ▼
                                    ┌────────────────┐
                                    │   Dashboard    │
                                    │  (Next.js UI)  │
                                    └────────────────┘
```

---

## 🧱 Stack

- **Frontend**: Next.js 16 (App Router) + Tailwind v4 + shadcn/ui (New York / zinc) + dark theme + Geist font
- **Backend**: Next.js API Routes + Supabase (Postgres + Auth + Realtime)
- **Background jobs**: Inngest (research, enrichment, call dispatch, webhook processing)
- **State**: Zustand (UI) + TanStack React Query (server state)
- **APIs externas**:
  - Google Places API (New) — discovery + details
  - ElevenLabs Conversational AI — voice agent
  - Twilio Programmable Voice — PSTN telephony (número +54)
  - (opcional) OpenAI / Claude — post-call summarization & outcome classification
- **Deploy**: Vercel (frontend + API) + Supabase (DB) + Inngest Cloud (workers)
- **Colores**: `#FF6300` (primary orange) · `#FF3576` (accent pink) · fondo dark

---

## 🗄️ Schema de base de datos (Supabase)

```sql
-- Leads raw desde Google Places
leads (
  id uuid pk,
  place_id text unique,          -- Google Place ID
  name text,
  address text,
  phone text,
  website text,
  instagram text,                -- enriquecido
  lat numeric, lng numeric,
  rating numeric,
  reviews_count int,
  price_level int,               -- 1..4
  types text[],                  -- ['cafe','bakery',...]
  opening_hours jsonb,
  photos jsonb,
  raw_google jsonb,              -- payload completo por si necesitamos re-procesar
  discovered_at timestamptz,
  source text                    -- 'google_places' | 'manual' | 'instagram'
)

-- Enriquecimiento y scoring
lead_qualifications (
  id uuid pk,
  lead_id uuid fk,
  ig_followers int,
  ig_active bool,
  menu_has_protein bool,         -- scraped del sitio/IG
  owner_name text,
  owner_linkedin text,
  score numeric,                 -- 0..100
  icp_match bool,                -- pass/fail filtros duros
  score_breakdown jsonb,         -- {rating:20, reviews:15, ig:10,...}
  qualified_at timestamptz
)

-- Llamadas
calls (
  id uuid pk,
  lead_id uuid fk,
  elevenlabs_conversation_id text,
  twilio_call_sid text,
  status text,                   -- queued|dialing|in_progress|completed|failed|no_answer|voicemail
  started_at timestamptz,
  ended_at timestamptz,
  duration_sec int,
  recording_url text,
  transcript jsonb,              -- turns [{role, text, ts}]
  cost_usd numeric,
  attempt_number int,
  scheduled_for timestamptz
)

-- Resultado de la llamada (lo clasifica el LLM post-call)
call_outcomes (
  id uuid pk,
  call_id uuid fk,
  outcome text,                  -- interested|meeting_booked|not_interested|callback|gatekeeper|wrong_number|voicemail
  interest_score int,            -- 0..10
  objections text[],
  meeting_at timestamptz,
  contact_name text,
  contact_role text,
  notes text,
  next_action text,              -- send_sample|followup_call|close|drop
  summary text
)

-- Pipeline stage (denormalizado para dashboard)
lead_pipeline (
  lead_id uuid pk fk,
  stage text,                    -- discovered|qualified|queued|called|interested|meeting|won|lost
  updated_at timestamptz
)

-- Configuración del agente / campaña
campaigns (
  id uuid pk,
  name text,
  icp_filters jsonb,             -- {min_rating:4.3, min_reviews:100, ...}
  agent_script_id text,          -- ElevenLabs agent id
  calling_hours jsonb,           -- {tz:'America/Argentina/Buenos_Aires', windows:[...]}
  do_not_call text[],            -- phones blacklist
  active bool
)

-- Audit log
events (
  id uuid pk, lead_id uuid, call_id uuid,
  type text, payload jsonb, created_at timestamptz
)
```

---

## 🔄 Pipeline — estados del lead

```
discovered  →  qualified  →  queued  →  calling  →  called
                  │                                    │
                  └─▶ rejected (no ICP)                ├─▶ interested  →  meeting  →  won
                                                       ├─▶ callback (reintento)
                                                       ├─▶ not_interested  →  lost
                                                       └─▶ unreachable (3 intentos)  →  lost
```

---

## 📋 Plan de trabajo — dividido por persona

### 🅰️ Persona A — Data & Agent (backend / integraciones)

#### Fase 1 — Research Engine
- [ ] Setup Supabase project + aplicar schema
- [ ] Crear API key de Google Places API (New) + restricciones de dominio
- [ ] `lib/google-places.ts` — wrapper con `searchNearby` + `getPlaceDetails`
- [ ] Job Inngest `research.palermo` — barrido por grid de coordenadas (Palermo Soho + Hollywood + Chico), dedupe por `place_id`
- [ ] Paginación + rate limiting + costo tracking (estimar $/run)
- [ ] Guardar raw en `leads` + emitir evento `lead.discovered`

#### Fase 2 — Qualifier
- [ ] Definir ICP en `campaigns.icp_filters` (rating, reviews, price_level, types whitelist/blacklist)
- [ ] `lib/scoring.ts` — scoring 0–100 con breakdown explicable
- [ ] (Opcional) Enrichment: scraping de Instagram handle desde website, detectar si ya tienen productos proteicos en el menú
- [ ] Job `lead.qualify` — corre al recibir `lead.discovered`
- [ ] Marcar `icp_match` + mover a stage `qualified` o `rejected`

#### Fase 3 — Calling Infrastructure
- [ ] Crear cuenta Twilio + número argentino (+54) saliente
- [ ] Crear agente en ElevenLabs Conversational AI (voz rioplatense, script de venta)
- [ ] Configurar Twilio ↔ ElevenLabs (SIP trunk / phone integration)
- [ ] Endpoint `POST /api/calls/dispatch` — toma siguiente lead de la queue y dispara llamada
- [ ] Webhook `POST /api/webhooks/elevenlabs` — recibe `conversation.ended` con transcript
- [ ] Webhook `POST /api/webhooks/twilio` — status callbacks (no-answer, busy, completed)
- [ ] Respetar `calling_hours` + DNC list + máximo 3 intentos con backoff

#### Fase 4 — Outcome Classification
- [ ] LLM prompt (Claude Sonnet) que toma transcript y clasifica: outcome, interest_score, objeciones, contacto, next_action
- [ ] Job `call.classify` — corre al recibir webhook de ElevenLabs
- [ ] Crear tareas follow-up automáticas según `next_action`
- [ ] Si `meeting_booked` → crear evento en Google Calendar (vía Calendar API)

---

### 🅱️ Persona B — Frontend & Dashboard

#### Fase 1 — Setup base
- [ ] `npx create-next-app@latest` (Next 16, App Router, Tailwind v4, TS)
- [ ] Setup shadcn/ui (New York, zinc, dark theme forced)
- [ ] Geist font + design tokens (`#FF6300`, `#FF3576`)
- [ ] Auth con Supabase (magic link) — rutas protegidas
- [ ] Layout base: sidebar + topbar + área principal

#### Fase 2 — Vistas del dashboard

**`/` — Overview**
- [ ] KPIs: leads totales · calificados · llamados · interesados · reuniones · cerrados
- [ ] Funnel chart (discovered → won) con % conversión por stage
- [ ] Chart de llamadas por día + distribución de outcomes
- [ ] Costo acumulado (Places + ElevenLabs + Twilio)

**`/leads` — Lead list**
- [ ] Tabla con filtros (stage, score, rating, barrio, búsqueda)
- [ ] Columnas: nombre, teléfono, rating/reviews, score, stage, última acción
- [ ] Acciones: ver detalle, forzar re-qualify, agregar a queue, blacklist
- [ ] Bulk actions (seleccionar N y enviar a queue)

**`/leads/[id]` — Detalle del lead**
- [ ] Info de Google (fotos, mapa, horarios, website, IG)
- [ ] Breakdown del scoring
- [ ] Historial de llamadas con transcript expandible + audio player
- [ ] Notas + timeline de eventos
- [ ] Botón "llamar ahora"

**`/queue` — Cola de llamadas**
- [ ] Lista ordenada por score · horario permitido · intentos
- [ ] Drag & drop para reordenar prioridad
- [ ] Pausar/reanudar dispatch global

**`/calls` — Llamadas**
- [ ] Live view (realtime Supabase) de llamadas `in_progress`
- [ ] Historial con filtros (outcome, fecha, duración)
- [ ] Modal con transcript completo + recording + resumen IA

**`/campaigns` — Campañas**
- [ ] Editor de ICP (form para `icp_filters`)
- [ ] Horarios de llamado
- [ ] Script del agente (link a ElevenLabs)
- [ ] DNC list

**`/settings` — Configuración**
- [ ] API keys (encriptadas server-side)
- [ ] Miembros del team
- [ ] Billing / uso

#### Fase 3 — Realtime & UX
- [ ] Supabase Realtime para stages de leads y estado de llamadas
- [ ] Toasts cuando una llamada cambia de estado o se agenda reunión
- [ ] Empty states + loading skeletons + error boundaries
- [ ] Mobile responsive (al menos overview + detalle)

---

### 🤝 Compartido (decidir juntos antes de arrancar)

- [ ] **Producto**: marca del café, precio mayorista, MOQ, sample policy
- [ ] **Pitch script** del agente de ElevenLabs (apertura, value props, manejo de objeciones, cierre)
- [ ] **ICP final**: filtros duros + pesos del scoring
- [ ] **Zona exacta** de Palermo (polígono o radio)
- [ ] **Horarios de llamado** y cadencia de reintentos
- [ ] **Criterio de éxito del MVP** (ej: 100 leads calificados, 30 llamadas, 3 reuniones en la primera semana)

---

## 🚀 Milestones

| Milestone | Entregable | Responsable |
|-----------|------------|-------------|
| **M1 — Research** | Botón "correr research Palermo" popula tabla `leads` con 200+ cafeterías | A |
| **M2 — Qualify** | Dashboard muestra leads calificados con score | A + B |
| **M3 — UI base** | `/leads`, `/leads/[id]`, auth funcionando | B |
| **M4 — Primera llamada** | Agente llama a 1 lead de test y deja transcript en DB | A |
| **M5 — Outcome loop** | Llamada → transcript → clasificación → stage actualizado en UI | A + B |
| **M6 — Dashboard completo** | Overview con KPIs + funnel + realtime | B |
| **M7 — Campaña piloto** | 50 llamadas reales, medir conversión | A + B |

---

## 🔐 Variables de entorno

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Google
GOOGLE_PLACES_API_KEY=

# ElevenLabs
ELEVENLABS_API_KEY=
ELEVENLABS_AGENT_ID=
ELEVENLABS_WEBHOOK_SECRET=

# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# Inngest
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# LLM (para clasificación post-call)
ANTHROPIC_API_KEY=
```

---

## 📏 Compliance y cuidados

- Disclaimer de grabación al inicio de cada llamada (requisito legal AR)
- Respetar horarios comerciales (no llamar fuera de 9–19 ni fines de semana)
- DNC list obligatoria — si piden no llamar más, blacklist permanente
- Máximo 3 intentos por lead
- No mencionar "IA" ni "agente automático" salvo que lo pregunten directamente

---

## 💰 Estimación de costos (MVP, 500 leads / 150 llamadas)

| Servicio | Uso | Costo |
|----------|-----|-------|
| Google Places API | ~1000 requests | ~$17 |
| ElevenLabs Conv AI | ~150 llamadas × 3 min | ~$45–90 |
| Twilio | ~450 min salientes AR | ~$6 |
| Supabase | Free tier | $0 |
| Vercel | Hobby | $0 |
| Inngest | Free tier | $0 |
| Claude (clasificación) | ~150 calls | ~$2 |
| **Total MVP** | | **~$70–115** |

---

## 🏁 Cómo arrancar (una vez aprobado el plan)

```bash
git clone https://github.com/Rose-ing/zero.git
cd zero
cp .env.example .env.local   # completar vars
pnpm install
pnpm dev
```

---

**Estado actual**: 📐 Planning — esperando approval para arrancar implementación.

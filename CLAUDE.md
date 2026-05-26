# Instagram Content Pipeline — CLAUDE.md

## Project Overview

| Field | Detail |
|---|---|
| Owner | Santu Koley |
| Brand | Personal Brand → EdTech Platform |
| Target Audience | Indian students aged 16–22, beginners in tech |
| Posting Goal | 3–4 carousel posts per week |
| Content Types | Carousel Post (1080×1080) + Carousel Story (1080×1920) |
| Media | Static only — no videos, no reels |

---

## Infrastructure

| Layer | Where It Runs |
|---|---|
| Claude Desktop | Mac (local) |
| MCP Server | Mac (local) — communicates with Node app via HTTP |
| Node.js App | Docker container on Mac (local) |
| Database | SQLite — bind-mounted volume `./data` persists across container restarts |
| Static Assets | DigitalOcean Spaces (S3-compatible) |
| Preview Server | Docker container on Mac (http://localhost:3000) |
| Instagram Graph API | Called from Docker container |

> **Future:** Move Docker container to DigitalOcean Droplet for 24/7 scheduling without keeping Mac on.

### Infrastructure Decisions

**MCP runs locally on Mac** so Claude Desktop connects without tunneling.
MCP server makes HTTP API calls to the Node app at `http://localhost:3000`.

**Docker on Mac** containerises the Node app with Puppeteer + Chromium.
SQLite data persists via `./data:/app/data` volume mount in docker-compose.yml.

**SQLite** for all operational data — scheduled posts, published posts, stats.
File-based, zero separate server needed, full SQL queries, perfect for
3–4 posts per week scale.

**DigitalOcean Spaces** for static assets only — generated PNGs that need
public URLs for Instagram. Not used for operational data.
Spaces is object storage, not a database — not suitable for
read/modify/write operational records.

### What Lives Where

| Asset | Location | Reason |
|---|---|---|
| Generated PNGs | DO Spaces | Static files, need public URLs for Instagram |
| Preview HTML pages | DO Spaces | Static, publicly accessible |
| scheduled_posts | SQLite on Droplet | Operational data, fast read/write |
| published_posts + stats | SQLite on Droplet | Queried for analytics |
| HTML templates | Droplet filesystem | Server-side, not public |
| Output folder | Droplet temp | Cleared after Spaces upload |

---

## Core Workflow

### Sunday Batch Session — Weekly Content OS

| Step | Action |
|---|---|
| RESEARCH | Ask Claude Desktop to research trending beginner tech topics |
| GENERATE | Ask Claude to generate carousel JSON for each topic |
| REVIEW | Open preview URL in browser, review all slides |
| SCHEDULE | Ask Claude to schedule approved posts — Droplet server publishes at scheduled time |
| ANALYSE | End of week — ask Claude for performance summary and recommendations |

### Zero Intervention Publishing

Once scheduled on Sunday, the Docker container publishes automatically
at the set times throughout the week. Two-part scheduler in preview-server.js:
- **Startup sweep**: publishes any overdue posts immediately when the container starts
- **Background interval**: checks every 60s and publishes posts as their time arrives

The Docker container must be running. The Mac does not need to be awake.
Not using Instagram native scheduling (requires Facebook App in Live mode).

---

## Architecture

### Full System Flow

```
Claude Desktop (Mac)
       ↓ ↑ MCP Protocol (local)
MCP Server (Mac — localhost)
       ↓ ↑ HTTP API calls to localhost:3000
Node.js App (Docker — Mac)
       ↓                      ↓
Puppeteer                Instagram
Renderer                 Graph API
       ↓                      ↓
DigitalOcean             Publish Now /
Spaces (S3)              Schedule Post
Public PNG URLs
       ↓
SQLite Database
(./data volume)
scheduled_posts
published_posts
```

### MCP Config Location (Mac)

```
~/Library/Application Support/Claude/claude_desktop_config.json
```

### Important

No Claude API key required anywhere in this project.
Claude runs via Claude Desktop subscription through MCP protocol.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Template Engine | Handlebars — {{variable}} syntax |
| PNG Renderer | Puppeteer |
| Database | SQLite via better-sqlite3 |
| Preview Server | Express.js |
| MCP Server | @modelcontextprotocol/sdk |
| Storage | DigitalOcean Spaces via AWS SDK (S3-compatible) |
| Scheduler | Custom setInterval (60s) + startup sweep in preview-server.js |
| Publishing | Instagram Graph API |
| Containerisation | Docker + docker-compose |
| AI Brain | Claude Desktop for Mac via MCP |

---

## Project Structure

```
instagram-content-pipeline/
├── CLAUDE.md
├── BRAND.md
├── DESIGN.md
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── package.json
├── .env
├── .gitignore
├── /templates
│   ├── /educator
│   │   ├── cover.html
│   │   ├── content.html
│   │   └── cta.html
│   ├── /challenger
│   │   ├── cover.html
│   │   ├── content.html
│   │   └── cta.html
│   └── /quicklist
│       ├── cover.html
│       ├── content.html
│       └── cta.html
├── /scripts
│   ├── render.js
│   ├── upload.js
│   ├── generate.js
│   ├── preview-server.js
│   ├── publish.js
│   └── init-db.js
├── /mcp
│   ├── server.js
│   └── /tools
│       ├── generate.js
│       ├── preview.js
│       ├── publish.js
│       ├── stats.js
│       └── queue.js
├── /preview-ui
│   ├── index.html      ← post preview + approve form
│   ├── list.html       ← posts dashboard
│   ├── calendar.html   ← month-view content calendar
│   └── styles.css
├── /data
│   └── instagram-pipeline.db
├── /output
│   ├── /posts          ← cleared automatically after Spaces upload
│   └── /stories
└── /sample-content
    ├── educator.json
    ├── challenger.json
    └── quicklist.json
```

---

## Database Schema

```sql
-- Scheduled posts waiting to publish
CREATE TABLE scheduled_posts (
  id TEXT PRIMARY KEY,
  topic TEXT,
  template TEXT,
  instagram_container_id TEXT,
  scheduled_time DATETIME,
  status TEXT,
  caption TEXT,
  spaces_folder TEXT,
  created_at DATETIME
);

-- Published posts with performance stats
CREATE TABLE published_posts (
  id TEXT PRIMARY KEY,
  topic TEXT,
  template TEXT,
  instagram_post_id TEXT,
  instagram_permalink TEXT,
  published_at DATETIME,
  likes INTEGER,
  comments INTEGER,
  saves INTEGER,
  reach INTEGER,
  impressions INTEGER,
  stats_fetched_at DATETIME
);
```

---

## MCP Tools

| Tool | Input | Returns |
|---|---|---|
| generate_carousel | carousel_json | id, status, preview_url |
| draft_carousel | carousel_json | id, status, preview_url |
| preview_carousel | id | preview_url, slide_count, template |
| schedule_post | id, iso_datetime | publish_time, status |
| list_scheduled_posts | — | array of scheduled posts |
| cancel_scheduled_post | id | id, status |
| get_post_stats | post_id | likes, comments, saves, reach, impressions |
| get_weekly_summary | — | posts, total_reach, top_post, engagement_rate |

### draft_carousel vs generate_carousel

- **`draft_carousel`** — use when the user wants to review or edit the JSON before PNG rendering. Opens a portal with a JSON editor + live slide preview. User clicks **Render PNG** when satisfied. No images created until then.
- **`generate_carousel`** — use when the user wants to go straight to review the rendered images without editing JSON first. Renders PNGs immediately and uploads to Spaces.

### schedule_post Note

Uses custom server-side scheduling. preview-server.js checks every 60s
for posts whose scheduled_time has arrived and calls publishNow().
On container start, overdue posts are published immediately (startup sweep).
The Docker container must be running — the Mac does not need to be awake.
Not using Instagram native scheduling (requires Facebook App Live mode).

### Schedule Suggestion

`GET /api/suggest-schedule` returns the next optimal IST publish time
based on engagement research. Only auto-fills for posts with status `uploaded`.

Optimal slots (IST / Asia/Kolkata):
- Mon–Thu: 08:00, 20:00
- Wed: 20:00 first (peak day)
- Fri: 12:30, 19:00
- Sat–Sun: 21:00
- Conflict check: no other scheduled post within ±2 hours

---

## Post Status Lifecycle

| Status | Meaning | User Actions Available |
|---|---|---|
| `draft` | JSON saved by `draft_carousel` tool. No images rendered yet. User edits JSON + clicks Render PNG to advance. | Edit JSON in portal, Render PNG |
| `uploaded` | Post just created by Claude (or rendered from draft). Images in Spaces, nothing decided yet. | Approve, Reject |
| `approved` | Content approved but **no schedule time set**. Will not publish until scheduled via MCP. | Reject |
| `scheduled` | Approved **with a schedule time**. Server auto-publishes at that time (60s check loop). | Reject, Cancel Schedule |
| `published` | Successfully posted to Instagram. Terminal state. | None |
| `rejected` | Content rejected permanently. Will never publish. Terminal state. | None |
| `cancelled` | Schedule was cancelled (timing issue, not content). Can be re-approved. | Approve, Reject |

### Status Flow

```
draft → uploaded → approved → scheduled → published
           ↓           ↓          ↓
        rejected    rejected    cancelled → (back to approved/scheduled)
                                rejected
```

### Key Distinctions

- **`approved`** vs **`scheduled`**: Clicking Approve with a schedule time filled in → status becomes `scheduled` immediately. Approve with no time → status stays `approved` (must schedule later via MCP tool).
- **`cancelled`** = wrong time, good content. Re-approvable — set a new schedule time and approve again.
- **`rejected`** = wrong content. Terminal — post is permanently done and will never publish.

### Preview Page Button Visibility

| Status | Approve | Reject | Cancel Schedule |
|---|---|---|---|
| `uploaded` | enabled | enabled | hidden |
| `approved` | disabled | enabled | hidden |
| `scheduled` | disabled | enabled | **visible** |
| `published` | disabled | disabled | hidden |
| `rejected` | disabled | disabled | hidden |
| `cancelled` | enabled | enabled | hidden |

---

## JSON Schema

```json
{
  "id": "post-uuid-here",
  "template": "educator",
  "topic": "What is an API?",
  "tag": "Beginner Guide",
  "format": "post",
  "slides": [
    {
      "type": "cover",
      "headline": "What is an API?",
      "subtext": "Explained in plain English"
    },
    {
      "type": "content",
      "number": "01",
      "headline": "Think of it like a waiter",
      "body": [
        { "text": "You order food. The waiter takes your request to the kitchen and brings back what you asked for." }
      ]
    },
    {
      "type": "content",
      "number": "02",
      "headline": "Your app does the same",
      "body": [
        { "text": "Your app sends a request." },
        { "kind": "block", "lines": ["REQUEST  → app asks for data", "RESPONSE ← API sends result back"] },
        { "text": "The API handles everything in between." }
      ]
    },
    {
      "type": "content",
      "number": "03",
      "headline": "Real example: Weather app",
      "body": [
        { "kind": "code", "lines": ["GET /weather?city=Mumbai", "", "{ \"temp\": 32, \"humidity\": 78 }"] }
      ]
    },
    {
      "type": "cta",
      "headline": "Save this for your next interview prep",
      "subline": "More beginner guides every week"
    }
  ]
}
```

### body — Composed Array

`body` is an **array of elements** that compose the slide content in order. Mix text and blocks freely.

| Element | Shape | Renders as |
|---|---|---|
| Text | `{ "text": "..." }` | Prose paragraph — DM Sans, light weight |
| Content block | `{ "kind": "block", "lines": [...] }` | Monospace block, light bg, saffron left border |
| Code block | `{ "kind": "code", "lines": [...] }` | Monospace block, dark terminal bg, saffron left border |

Future elements (extensible): `{ "kind": "icon", ... }`, `{ "kind": "image", ... }`

### Field Rules

| Field | Rule |
|---|---|
| template | educator, challenger, or quicklist |
| format | post or story |
| type | cover, content, or cta |
| number | "01" to "09" as string not integer |
| headline | max 8 words on cover, max 6 words on content |
| body | array of `{ text }` or `{ kind, lines }` elements |
| lines | string array — each element is one line; empty lines are `""` |
| subtext | max 12 words |
| subline | max 8 words |

Indentation in `lines` uses regular spaces. Elements render top-to-bottom in the order given.

---

## Build Phases

### Phase 1 — Templates + Renderer

- [x] Project scaffold and package.json
- [x] educator template — cover, content, cta
- [x] challenger template — cover, content, cta
- [x] quicklist template — cover, content, cta
- [x] render.js — JSON to HTML to PNG via Puppeteer
- [x] Story format variants 1080×1920
- [x] Test all templates with sample JSON

### Phase 2 — Storage + Preview Server

- [x] DigitalOcean Spaces bucket setup
- [x] SQLite database initialisation and schema migration
- [x] upload.js — upload PNGs to Spaces after rendering
- [x] Express preview server on DigitalOcean Droplet
- [x] Preview page UI showing all slides in sequence
- [x] Approve button
- [x] Edit metadata for caption and hashtags

### Phase 3 — MCP Server

- [x] MCP server scaffold on Mac
- [x] generate_carousel tool
- [x] preview_carousel tool
- [x] Register in claude_desktop_config.json
- [x] Test end to end from Claude Desktop

### Phase 4 — Instagram Integration

- [x] Facebook Page linked to Instagram Creator account
- [x] Instagram Graph API credentials setup
- [x] publish_now tool using Spaces public URLs
- [x] schedule_post tool using custom server-side scheduler (setInterval 60s in preview-server.js)
- [x] Scheduler publishes due posts automatically on the Droplet
- [x] list_scheduled_posts tool
- [x] cancel_scheduled_post tool

### Phase 5 — Docker + UI Enhancements

- [x] Dockerfile (node:20-slim + Chromium for Puppeteer)
- [x] docker-compose.yml with SQLite volume mount (./data:/app/data)
- [x] .dockerignore
- [x] Puppeteer --no-sandbox args for Docker
- [x] Output folder auto-cleanup after Spaces upload
- [x] Back button on preview page
- [x] Smart schedule suggestion (IST optimal slots, auto-fills on page load)
- [x] Content calendar — month view at /calendar
- [x] Scheduler query fix: datetime(scheduled_time) for ISO timezone strings
- [x] Reject button — marks post as rejected (terminal), clears scheduled_time
- [x] Cancel Schedule button — visible only for scheduled posts, reverts to cancelled (re-approvable)

### Phase 6 — Analytics

- [ ] get_post_stats tool
- [ ] get_weekly_summary tool
- [ ] Performance display on preview UI

---

## Environment Variables

```
# .env (shared — used by both Docker container and MCP server on Mac)
INSTAGRAM_ACCESS_TOKEN=
INSTAGRAM_BUSINESS_ACCOUNT_ID=
FACEBOOK_PAGE_ID=
DO_SPACES_KEY=
DO_SPACES_SECRET=
DO_SPACES_ENDPOINT=https://{region}.digitaloceanspaces.com
DO_SPACES_BUCKET=
DO_SPACES_CDN_URL=
DB_PATH=./data/instagram-pipeline.db
PORT=3000
NODE_APP_BASE_URL=http://localhost:3000
```

---

## Key Conventions

- Claude never generates HTML — Claude generates JSON only
- JSON schema must match the schema defined above exactly
- All templates use Handlebars {{variable}} syntax only
- No hardcoded content inside any HTML template file
- Output files named as template-type-number.png
- All PNGs uploaded to DigitalOcean Spaces after rendering
- Spaces URLs passed to Instagram Graph API for publishing
- Operational data stored in SQLite — never in Spaces
- Slide content must respect max word limits defined above
- Saffron #D4860A is used as accent only — never as background
- Story format is built only after post format is fully tested
- No Claude API key is used anywhere in this project

## What Claude Should Never Do

- Do not hardcode any slide content into HTML templates
- Do not change brand colors without explicit instruction
- Do not add gradients, drop shadows, or decorative elements
- Do not install packages outside the approved tech stack
- Do not skip the review checkpoint between phases
- Do not move to next phase until current phase PNGs are approved
- Do not use Claude API — this project uses Claude Desktop via MCP
- Do not store operational data in DigitalOcean Spaces

---

## How to Run

```bash
# Build Docker image (once, or after code changes)
docker compose build

# Start the app (publishes any overdue posts on startup)
docker compose up

# Stop
docker compose down

# Initialise SQLite database (first time only)
docker compose exec app node scripts/init-db.js

# Start MCP server on Mac (separate terminal)
node mcp/server.js
```

### Direct (no Docker)

```bash
# Start preview server directly
node scripts/preview-server.js

# Render slides from JSON (CLI)
node scripts/render.js --template educator --input sample-content/educator.json
```

---

## Reference Files

- Brand colors, fonts, and identity rules → see BRAND.md
- Slide dimensions, spacing, and typography → see DESIGN.md
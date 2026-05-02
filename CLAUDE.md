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
| MCP Server | Mac (local) — communicates with remote Node app via HTTP |
| Node.js App | DigitalOcean Droplet (remote server) |
| Database | SQLite on DigitalOcean Droplet |
| Static Assets | DigitalOcean Spaces (S3-compatible) |
| Preview Server | DigitalOcean Droplet (remote) |
| Instagram Graph API | Called from DigitalOcean Droplet |

### Infrastructure Decisions

**MCP runs locally on Mac** so Claude Desktop connects without tunneling.
MCP server makes HTTP API calls to the Node.js app on the Droplet.

**SQLite on Droplet** for all operational data — scheduled posts,
published posts, stats. File-based, zero separate server needed,
full SQL queries, perfect for 3–4 posts per week scale.

**DigitalOcean Spaces** for static assets only — generated PNGs and
preview pages that need public URLs. Not used for operational data.
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
| SCHEDULE | Ask Claude to schedule approved posts via Instagram native scheduling |
| ANALYSE | End of week — ask Claude for performance summary and recommendations |

### Zero Intervention Publishing

Once scheduled on Sunday, Instagram publishes automatically at set
times throughout the week. Uses Instagram Graph API native scheduling.
The Node app and Mac do not need to be running for scheduled posts
to publish. Instagram handles this entirely.

---

## Architecture

### Full System Flow

```
Claude Desktop (Mac)
       ↓ ↑ MCP Protocol (local)
MCP Server (Mac — localhost)
       ↓ ↑ HTTP API calls
Node.js App (DigitalOcean Droplet)
       ↓                      ↓
Puppeteer                Instagram
Renderer                 Graph API
       ↓                      ↓
DigitalOcean             Publish Now /
Spaces (S3)              Schedule Post /
Public PNG URLs          Get Stats
       ↓                      ↓
SQLite Database          Express Preview
(Droplet)                Server (Droplet)
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
| Scheduler | Instagram Graph API native scheduling |
| Publishing | Instagram Graph API |
| AI Brain | Claude Desktop for Mac via MCP |

---

## Project Structure

```
instagram-content-pipeline/
├── CLAUDE.md
├── BRAND.md
├── DESIGN.md
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
│   ├── preview-server.js
│   └── publish.js
├── /mcp
│   ├── server.js
│   └── /tools
│       ├── generate.js
│       ├── preview.js
│       ├── publish.js
│       ├── stats.js
│       └── queue.js
├── /preview-ui
│   ├── index.html
│   └── styles.css
├── /data
│   └── instagram-pipeline.db
├── /output
│   ├── /posts
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
| generate_carousel | topic, template, slides_count | id, json, preview_url |
| preview_carousel | id | preview_url, slide_count, template |
| publish_now | id | instagram_post_id, url, status |
| schedule_post | id, iso_datetime | scheduled_id, publish_time, status |
| list_scheduled_posts | — | array of scheduled posts |
| cancel_scheduled_post | id | id, status |
| get_post_stats | post_id | likes, comments, saves, reach, impressions |
| get_weekly_summary | — | posts, total_reach, top_post, engagement_rate |

### schedule_post Note

Uses Instagram Graph API native scheduling.
Instagram publishes automatically — Mac and server do not need
to be running at publish time.

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
      "body": "You order food. The waiter takes your request to the kitchen and brings back exactly what you asked for."
    },
    {
      "type": "content",
      "number": "02",
      "headline": "Your app does the same",
      "body": "Your app sends a request. The API fetches data from a server and returns exactly what your app asked for."
    },
    {
      "type": "cta",
      "headline": "Save this for your next interview prep",
      "subline": "More beginner guides every week"
    }
  ]
}
```

### Field Rules

| Field | Rule |
|---|---|
| template | educator, challenger, or quicklist |
| format | post or story |
| type | cover, content, or cta |
| number | "01" to "09" as string not integer |
| headline | max 8 words on cover, max 6 words on content |
| body | max 30 words |
| subtext | max 12 words |
| subline | max 8 words |

---

## Build Phases

### Phase 1 — Templates + Renderer

- [ ] Project scaffold and package.json
- [ ] educator template — cover, content, cta
- [ ] challenger template — cover, content, cta
- [ ] quicklist template — cover, content, cta
- [ ] render.js — JSON to HTML to PNG via Puppeteer
- [ ] Story format variants 1080×1920
- [ ] Test all templates with sample JSON

### Phase 2 — Storage + Preview Server

- [ ] DigitalOcean Spaces bucket setup
- [ ] SQLite database initialisation and schema migration
- [ ] upload.js — upload PNGs to Spaces after rendering
- [ ] Express preview server on DigitalOcean Droplet
- [ ] Preview page UI showing all slides in sequence
- [ ] Approve button
- [ ] Edit metadata for caption and hashtags

### Phase 3 — MCP Server

- [ ] MCP server scaffold on Mac
- [ ] generate_carousel tool
- [ ] preview_carousel tool
- [ ] Register in claude_desktop_config.json
- [ ] Test end to end from Claude Desktop

### Phase 4 — Instagram Integration

- [ ] Facebook Page linked to Instagram Creator account
- [ ] Instagram Graph API credentials setup
- [ ] publish_now tool using Spaces public URLs
- [ ] schedule_post tool using Instagram native scheduling
- [ ] Verify native scheduling works on Creator account
- [ ] list_scheduled_posts tool
- [ ] cancel_scheduled_post tool

### Phase 5 — Analytics

- [ ] get_post_stats tool
- [ ] get_weekly_summary tool
- [ ] Performance display on preview UI

---

## Environment Variables

```
# DigitalOcean Droplet .env
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

# MCP Server Mac .env
NODE_APP_BASE_URL=https://your-droplet-ip-or-domain
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
# Render slides from JSON
node scripts/render.js --template educator --input sample-content/educator.json

# Upload rendered PNGs to Spaces
node scripts/upload.js --input output/posts/post-uuid/

# Start preview server on Droplet
node scripts/preview-server.js

# Start MCP server on Mac
node mcp/server.js
```

---

## Reference Files

- Brand colors, fonts, and identity rules → see BRAND.md
- Slide dimensions, spacing, and typography → see DESIGN.md
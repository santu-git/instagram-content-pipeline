'use strict';

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const { igGet } = require('./ig-api');

const DB_PATH = process.env.DB_PATH || './data/instagram-pipeline.db';
const INSTAGRAM_ACCESS_TOKEN = () => {
  const t = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!t) throw new Error('Missing required env var: INSTAGRAM_ACCESS_TOKEN');
  return t;
};

function deriveSlideInfo(slidesJson) {
  try {
    const carousel = JSON.parse(slidesJson || '{}');
    const slides = carousel.slides || [];
    const slide_count = slides.length;
    const has_code_blocks = slides.some(s =>
      Array.isArray(s.body) && s.body.some(b => b.kind === 'code')
    );
    return { slide_count, has_code_blocks };
  } catch {
    return { slide_count: null, has_code_blocks: false };
  }
}

function computeRates(likes, comments, saves, reach) {
  if (!reach || reach === 0) return { save_rate: null, engagement_rate: null };
  const save_rate = parseFloat(((saves || 0) / reach * 100).toFixed(2));
  const engagement_rate = parseFloat(((((likes || 0) + (comments || 0) + (saves || 0)) / reach) * 100).toFixed(2));
  return { save_rate, engagement_rate };
}

async function fetchAndStoreStats(postId) {
  const token = INSTAGRAM_ACCESS_TOKEN();

  const db = new Database(path.resolve(DB_PATH));
  const row = db.prepare(`
    SELECT pp.*, sp.slides_json, sp.topic, sp.template, sp.category
    FROM published_posts pp
    LEFT JOIN scheduled_posts sp ON sp.id = pp.id
    WHERE pp.id = ?
  `).get(postId);
  db.close();

  if (!row) throw new Error(`Post "${postId}" not found in published_posts`);
  if (!row.instagram_post_id) throw new Error(`Post "${postId}" has no instagram_post_id — cannot fetch stats`);

  const mediaId = row.instagram_post_id;

  // Fetch all metrics from insights in one call (API v22+ — impressions replaced by views)
  let likes = null, comments = null, saves = null, reach = null, views = null, shares = null;
  try {
    const insights = await igGet(`/${mediaId}/insights`, {
      metric: 'reach,saved,shares,likes,comments,views',
    }, token);
    for (const item of (insights.data || [])) {
      const val = item.values?.[0]?.value ?? null;
      if (item.name === 'reach')    reach    = val;
      if (item.name === 'saved')    saves    = val;
      if (item.name === 'shares')   shares   = val;
      if (item.name === 'likes')    likes    = val;
      if (item.name === 'comments') comments = val;
      if (item.name === 'views')    views    = val;
    }
  } catch (err) {
    console.warn(`  ⚠ Insights not yet available for ${postId}: ${err.message}`);
  }

  const db2 = new Database(path.resolve(DB_PATH));
  db2.prepare(`
    UPDATE published_posts
    SET likes = ?, comments = ?, saves = ?, reach = ?, impressions = ?, shares = ?, stats_fetched_at = datetime('now')
    WHERE id = ?
  `).run(likes, comments, saves, reach, views, shares, postId);
  db2.close();

  const { slide_count, has_code_blocks } = deriveSlideInfo(row.slides_json);
  const { save_rate, engagement_rate } = computeRates(likes, comments, saves, reach);

  return {
    id: postId,
    topic: row.topic,
    template: row.template,
    category: row.category,
    slide_count,
    has_code_blocks,
    published_at: row.published_at,
    likes,
    comments,
    saves,
    reach,
    views,
    shares,
    save_rate,
    engagement_rate,
    stats_fetched_at: new Date().toISOString(),
    insights_available: reach !== null,
  };
}

async function getWeeklySummary(daysBack = 7) {
  const db = new Database(path.resolve(DB_PATH));
  const rows = db.prepare(`
    SELECT pp.*, sp.slides_json, sp.topic, sp.template, sp.category
    FROM published_posts pp
    LEFT JOIN scheduled_posts sp ON sp.id = pp.id
    WHERE pp.published_at >= datetime('now', '-' || ? || ' days')
    ORDER BY pp.published_at DESC
  `).all(daysBack);
  db.close();

  const posts = rows.map(row => {
    const { slide_count, has_code_blocks } = deriveSlideInfo(row.slides_json);
    const { save_rate, engagement_rate } = computeRates(row.likes, row.comments, row.saves, row.reach);
    return {
      id: row.id,
      topic: row.topic,
      template: row.template,
      category: row.category,
      slide_count,
      has_code_blocks,
      published_at: row.published_at,
      likes: row.likes,
      comments: row.comments,
      saves: row.saves,
      shares: row.shares,
      reach: row.reach,
      views: row.impressions,
      save_rate,
      engagement_rate,
      stats_fetched_at: row.stats_fetched_at,
      insights_available: row.reach !== null,
    };
  });

  const postsWithReach = posts.filter(p => p.reach);
  const total_reach = postsWithReach.reduce((s, p) => s + p.reach, 0);
  const total_impressions = posts.reduce((s, p) => s + (p.impressions || 0), 0);
  const total_likes = posts.reduce((s, p) => s + (p.likes || 0), 0);
  const total_comments = posts.reduce((s, p) => s + (p.comments || 0), 0);
  const total_saves = posts.reduce((s, p) => s + (p.saves || 0), 0);

  const avg_engagement_rate = postsWithReach.length
    ? parseFloat((postsWithReach.reduce((s, p) => s + (p.engagement_rate || 0), 0) / postsWithReach.length).toFixed(2))
    : null;
  const avg_save_rate = postsWithReach.length
    ? parseFloat((postsWithReach.reduce((s, p) => s + (p.save_rate || 0), 0) / postsWithReach.length).toFixed(2))
    : null;

  const top_post = postsWithReach.length
    ? postsWithReach.reduce((best, p) => (p.reach > best.reach ? p : best))
    : null;

  return {
    period_days: daysBack,
    posts_count: posts.length,
    total_reach,
    total_impressions,
    total_likes,
    total_comments,
    total_saves,
    avg_engagement_rate,
    avg_save_rate,
    top_post: top_post ? {
      id: top_post.id,
      topic: top_post.topic,
      template: top_post.template,
      category: top_post.category,
      reach: top_post.reach,
      save_rate: top_post.save_rate,
      engagement_rate: top_post.engagement_rate,
    } : null,
    posts,
  };
}

// Returns Monday date string (YYYY-MM-DD) for a given Date — used to bin
// Instagram's daily account-insight values into the same weeks as SQLite.
function getMondayOfWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? 6 : day - 1;
  return new Date(d.getTime() - diff * 86400000).toISOString().slice(0, 10);
}

async function getWeeklyTrends(weeksBack = 8) {
  const token = INSTAGRAM_ACCESS_TOKEN();
  const accountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  if (!accountId) throw new Error('Missing INSTAGRAM_BUSINESS_ACCOUNT_ID');

  const daysBack = weeksBack * 7;

  // 1. Per-week post aggregates from our DB
  // SQLite expression: date - (weekday offset) = Monday of that week
  const db = new Database(path.resolve(DB_PATH));
  const rows = db.prepare(`
    SELECT
      date(datetime(published_at),
        '-' || ((cast(strftime('%w', datetime(published_at)) as integer) + 6) % 7) || ' days'
      ) as week_start,
      COUNT(*) as posts_count,
      SUM(COALESCE(reach, 0))  as total_reach,
      SUM(COALESCE(likes, 0))  as total_likes,
      SUM(COALESCE(saves, 0))  as total_saves,
      SUM(COALESCE(shares, 0)) as total_shares,
      ROUND(AVG(CASE WHEN reach > 0
        THEN CAST((COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(saves,0)) AS FLOAT) / reach * 100
        ELSE NULL END), 2) as avg_engagement_rate,
      ROUND(AVG(CASE WHEN reach > 0
        THEN CAST(COALESCE(saves,0) AS FLOAT) / reach * 100
        ELSE NULL END), 2) as avg_save_rate
    FROM published_posts
    WHERE published_at >= datetime('now', '-' || ? || ' days')
    GROUP BY week_start
    ORDER BY week_start ASC
  `).all(daysBack);
  db.close();

  // 2. Instagram account-level totals for the period (profile views, website clicks)
  // API v22+ only supports metric_type=total_value (no daily breakdown) and max 30-day window.
  // We fetch a single total and attach it to the most recent week as context.
  const windowDays = Math.min(daysBack, 28); // API hard limit: 30 days
  const since = Math.floor((Date.now() - windowDays * 24 * 3600 * 1000) / 1000);
  const until = Math.floor(Date.now() / 1000);
  let accountTotals = { profile_views: null, website_clicks: null };

  try {
    const insights = await igGet(`/${accountId}/insights`, {
      metric: 'profile_views,website_clicks',
      period: 'day',
      metric_type: 'total_value',
      since,
      until,
    }, token);
    for (const m of (insights.data || [])) {
      if (m.name === 'profile_views')  accountTotals.profile_views  = m.total_value?.value ?? null;
      if (m.name === 'website_clicks') accountTotals.website_clicks = m.total_value?.value ?? null;
    }
  } catch (err) {
    console.warn(`[trends] Account insights unavailable: ${err.message}`);
  }

  // 3. Return weekly rows (post-level) + account totals as metadata
  return {
    weeks: rows.map(row => ({
      week_start: row.week_start,
      posts_count: row.posts_count,
      total_reach: row.total_reach || 0,
      total_likes: row.total_likes || 0,
      total_saves: row.total_saves || 0,
      total_shares: row.total_shares || 0,
      avg_engagement_rate: row.avg_engagement_rate,
      avg_save_rate: row.avg_save_rate,
    })),
    account_period_days: windowDays,
    profile_views: accountTotals.profile_views,
    website_clicks: accountTotals.website_clicks,
  };
}

// Fetch paid (ad) stats for a boosted post from the Facebook Ads API.
// Marks the post as is_boosted=1 and stores paid_reach/impressions/clicks/spend.
// Note: reach is summed across ads — approximate when multiple ads target the same audience.
async function fetchPaidStats(postId) {
  const token = INSTAGRAM_ACCESS_TOKEN();
  const adAccountId = process.env.FB_AD_ACCOUNT_ID;
  if (!adAccountId) throw new Error('FB_AD_ACCOUNT_ID not configured in environment');

  const db = new Database(path.resolve(DB_PATH));
  const row = db.prepare('SELECT instagram_post_id FROM published_posts WHERE id = ?').get(postId);
  db.close();

  if (!row) throw new Error(`Post "${postId}" not found in published_posts`);
  if (!row.instagram_post_id) throw new Error(`Post "${postId}" has no instagram_post_id`);

  const mediaId = row.instagram_post_id;

  const result = await igGet(`/${adAccountId}/insights`, {
    filtering: JSON.stringify([{
      field: 'effective_instagram_media_id',
      operator: 'EQUAL',
      value: mediaId,
    }]),
    fields: 'reach,impressions,clicks,spend',
    date_preset: 'lifetime',
    level: 'ad',
  }, token);

  const ads = result.data || [];
  if (!ads.length) throw new Error(`No ads found for this post (media ID: ${mediaId}). Make sure the post was boosted via Ads Manager.`);

  let paid_reach = 0, paid_impressions = 0, paid_clicks = 0, paid_spend = 0;
  for (const ad of ads) {
    paid_reach       += parseInt(ad.reach       || 0);
    paid_impressions += parseInt(ad.impressions || 0);
    paid_clicks      += parseInt(ad.clicks      || 0);
    paid_spend       += parseFloat(ad.spend     || 0);
  }

  paid_reach       = paid_reach       || null;
  paid_impressions = paid_impressions || null;
  paid_clicks      = paid_clicks      || null;
  paid_spend       = paid_spend ? parseFloat(paid_spend.toFixed(2)) : null;

  const db2 = new Database(path.resolve(DB_PATH));
  db2.prepare(`
    UPDATE published_posts
    SET is_boosted = 1,
        paid_reach = ?,
        paid_impressions = ?,
        paid_clicks = ?,
        paid_spend = ?,
        paid_stats_fetched_at = datetime('now')
    WHERE id = ?
  `).run(paid_reach, paid_impressions, paid_clicks, paid_spend, postId);
  db2.close();

  return { id: postId, is_boosted: true, paid_reach, paid_impressions, paid_clicks, paid_spend, paid_stats_fetched_at: new Date().toISOString() };
}

module.exports = { fetchAndStoreStats, getWeeklySummary, getWeeklyTrends, fetchPaidStats };

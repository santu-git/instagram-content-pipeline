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

module.exports = { fetchAndStoreStats, getWeeklySummary };

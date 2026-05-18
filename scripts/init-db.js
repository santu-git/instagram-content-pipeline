'use strict';

require('dotenv').config();
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || './data/instagram-pipeline.db';
const dataDir = path.dirname(path.resolve(DB_PATH));

fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.resolve(DB_PATH));

db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_posts (
    id TEXT PRIMARY KEY,
    topic TEXT,
    template TEXT,
    instagram_container_id TEXT,
    scheduled_time DATETIME,
    status TEXT,
    caption TEXT,
    hashtags TEXT,
    spaces_folder TEXT,
    created_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS published_posts (
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
`);

db.close();

console.log('Database ready:', path.resolve(DB_PATH));
console.log('Tables: scheduled_posts, published_posts');

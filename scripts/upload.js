'use strict';

require('dotenv').config();
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { program } = require('commander');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

program
  .requiredOption('--id <post-id>', 'Post ID (must match output/posts/{id}/ directory)')
  .parse(process.argv);

const { id } = program.opts();

async function main() {
  const {
    DO_SPACES_KEY,
    DO_SPACES_SECRET,
    DO_SPACES_ENDPOINT,
    DO_SPACES_BUCKET,
    DO_SPACES_CDN_URL,
    DB_PATH = './data/instagram-pipeline.db',
  } = process.env;

  for (const key of ['DO_SPACES_KEY', 'DO_SPACES_SECRET', 'DO_SPACES_ENDPOINT', 'DO_SPACES_BUCKET', 'DO_SPACES_CDN_URL']) {
    if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
  }

  const localDir = path.resolve('output', 'posts', id);
  if (!fs.existsSync(localDir)) {
    throw new Error(`Output directory not found: ${localDir}`);
  }

  const pngFiles = fs.readdirSync(localDir)
    .filter(f => f.endsWith('.png'))
    .sort();

  if (pngFiles.length === 0) {
    throw new Error(`No PNG files found in ${localDir}`);
  }

  const s3 = new S3Client({
    endpoint: DO_SPACES_ENDPOINT,
    region: 'us-east-1',
    credentials: {
      accessKeyId: DO_SPACES_KEY,
      secretAccessKey: DO_SPACES_SECRET,
    },
    forcePathStyle: false,
  });

  const cdnBase = DO_SPACES_CDN_URL.replace(/\/$/, '');
  const spacesFolder = `posts/${id}`;
  const urls = [];

  console.log(`Uploading ${pngFiles.length} PNGs → ${DO_SPACES_BUCKET}/${spacesFolder}/\n`);

  for (const filename of pngFiles) {
    const filePath = path.join(localDir, filename);
    const key = `${spacesFolder}/${filename}`;
    const body = fs.readFileSync(filePath);

    await s3.send(new PutObjectCommand({
      Bucket: DO_SPACES_BUCKET,
      Key: key,
      Body: body,
      ContentType: 'image/png',
      ACL: 'public-read',
    }));

    const url = `${cdnBase}/${key}`;
    urls.push(url);
    console.log(`  ✓  ${filename}`);
    console.log(`     ${url}`);
  }

  // Derive template from filename pattern: {template}-{type}-{num}.png
  const template = pngFiles[0].split('-')[0];

  // Find topic by scanning sample-content for matching id
  let topic = null;
  const sampleDir = path.resolve('sample-content');
  if (fs.existsSync(sampleDir)) {
    for (const file of fs.readdirSync(sampleDir).filter(f => f.endsWith('.json'))) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(sampleDir, file), 'utf8'));
        if (data.id === id) { topic = data.topic; break; }
      } catch {}
    }
  }

  const db = new Database(path.resolve(DB_PATH));
  db.prepare(`
    INSERT OR REPLACE INTO scheduled_posts (id, topic, template, status, spaces_folder, created_at)
    VALUES (?, ?, ?, 'uploaded', ?, datetime('now'))
  `).run(id, topic, template, spacesFolder);
  db.close();

  console.log(`\nDatabase: id=${id}, template=${template}, topic="${topic}", status=uploaded`);
  console.log(`Spaces folder: ${spacesFolder}`);
  console.log(`\n${urls.length} files uploaded successfully.`);

  return urls;
}

main().catch(err => {
  console.error('\nUpload failed:', err.message);
  process.exit(1);
});

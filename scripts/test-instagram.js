'use strict';

require('dotenv').config();

const {
  INSTAGRAM_ACCESS_TOKEN,
  INSTAGRAM_BUSINESS_ACCOUNT_ID,
  FACEBOOK_PAGE_ID,
} = process.env;

console.log('Checking env vars...');
console.log('  INSTAGRAM_BUSINESS_ACCOUNT_ID:', INSTAGRAM_BUSINESS_ACCOUNT_ID ? '✓ set' : '✗ MISSING');
console.log('  INSTAGRAM_ACCESS_TOKEN:        ', INSTAGRAM_ACCESS_TOKEN ? '✓ set' : '✗ MISSING');
console.log('  FACEBOOK_PAGE_ID:              ', FACEBOOK_PAGE_ID ? '✓ set' : '✗ MISSING');

if (!INSTAGRAM_ACCESS_TOKEN || !INSTAGRAM_BUSINESS_ACCOUNT_ID) {
  console.error('\nAbort: missing required credentials in .env');
  process.exit(1);
}

async function main() {
  const url = `https://graph.facebook.com/v25.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}` +
    `?fields=id,username,followers_count,media_count` +
    `&access_token=${INSTAGRAM_ACCESS_TOKEN}`;

  console.log('\nCalling Instagram Graph API v25.0...');

  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    console.error('\nAPI Error:');
    console.error('  code:    ', data.error.code);
    console.error('  type:    ', data.error.type);
    console.error('  message: ', data.error.message);
    process.exit(1);
  }

  console.log('\n✓ Credentials valid. Account details:');
  console.log('  id:             ', data.id);
  console.log('  username:       ', data.username);
  console.log('  followers_count:', data.followers_count);
  console.log('  media_count:    ', data.media_count);
}

main().catch(err => {
  console.error('\nFetch failed:', err.message);
  process.exit(1);
});

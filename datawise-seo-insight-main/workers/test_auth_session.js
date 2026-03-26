// Generate a test session token and hash for testing /auth/me endpoint
const crypto = require('crypto');

// Generate test token (same pattern as workers/src/auth/google.ts)
function generateToken() {
  const bytes = crypto.randomBytes(32);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Hash token using SHA-256 (same pattern as workers/src/auth/google.ts)
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const testToken = generateToken();
const tokenHash = hashToken(testToken);
const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const userId = crypto.randomUUID().replace(/-/g, '');

console.log('Test Session Data:');
console.log('=================');
console.log('Test Token (for Authorization header):');
console.log(testToken);
console.log('\nToken Hash (for DB storage):');
console.log(tokenHash);
console.log('\nUser ID:');
console.log(userId);
console.log('\nExpires At:');
console.log(expiresAt);
console.log('\nSQL Insert Commands:');
console.log('===================');
console.log(`INSERT INTO users (id, google_id, email, name, avatar_url, subscription_tier, is_community_member, credits_used, is_admin) VALUES ('${userId}', 'test_google_id_001', 'test@example.com', 'Test User', 'https://example.com/avatar.jpg', 'free', 0, 0, 0);`);
console.log(`\nINSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ('${crypto.randomUUID().replace(/-/g, '')}', '${userId}', '${tokenHash}', '${expiresAt}');`);
console.log(`\nKV Cache Command (via wrangler KV):`)
console.log(`wrangler kv:key put --binding KV "session:${tokenHash}" "${userId}" --ttl $((30 * 24 * 60 * 60))`);

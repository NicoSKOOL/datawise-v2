const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (mod, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  mod._compile(output.outputText, filename);
};

const { handleUploadMembers } = require('../src/routes/admin.ts');

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async run() {
    const sql = this.sql.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('DELETE FROM community_members')) {
      this.db.communityMembers.clear();
      return { meta: { changes: 1 } };
    }

    if (sql.startsWith('INSERT OR REPLACE INTO community_members')) {
      const [email, firstName, lastName, tier, ltv, joinedDate] = this.params;
      this.db.communityMembers.set(email.toLowerCase(), { email, firstName, lastName, tier, ltv, joinedDate });
      return { meta: { changes: 1 } };
    }

    if (sql.startsWith('INSERT INTO tier_changes')) {
      const [userId, fromTier, toTier, source] = this.params;
      this.db.tierChanges.push({ userId, fromTier, toTier, source });
      return { meta: { changes: 1 } };
    }

    if (sql.startsWith('UPDATE email_sequences SET cancelled = 1')) {
      this.db.cancelledCreditSequences.push(this.params[0]);
      return { meta: { changes: 1 } };
    }

    if (sql.startsWith('INSERT OR IGNORE INTO email_sequences')) {
      const [userId] = this.params;
      const sequenceType = sql.includes("'winback'") ? 'winback' : 'credits_exhausted';
      this.db.emailSequences.push({ userId, sequenceType });
      return { meta: { changes: 1 } };
    }

    if (sql.includes("SET is_community_member = 1, subscription_tier = 'community'")) {
      this.db.updateUser(this.params[0], { is_community_member: 1, subscription_tier: 'community' });
      return { meta: { changes: 1 } };
    }

    if (sql.includes("SET subscription_tier = 'community', is_community_member = 1")) {
      this.db.updateMany(this.params, { is_community_member: 1, subscription_tier: 'community' });
      return { meta: { changes: this.params.length } };
    }

    if (sql.includes('SET is_community_member = 1')) {
      this.db.updateUser(this.params[0], { is_community_member: 1 });
      return { meta: { changes: 1 } };
    }

    if (sql.includes("SET subscription_tier = 'free', is_community_member = 0")) {
      this.db.updateUser(this.params[0], { is_community_member: 0, subscription_tier: 'free' });
      return { meta: { changes: 1 } };
    }

    if (sql.includes('SET is_community_member = 0')) {
      this.db.updateUser(this.params[0], { is_community_member: 0 });
      return { meta: { changes: 1 } };
    }

    throw new Error(`Unhandled run SQL: ${sql}`);
  }

  async all() {
    const sql = this.sql.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('SELECT id, email, name, subscription_tier, is_community_member, is_admin FROM users')) {
      return { results: this.db.users.map((u) => ({ ...u })) };
    }
    throw new Error(`Unhandled all SQL: ${sql}`);
  }

  async first() {
    const sql = this.sql.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('SELECT is_community_member FROM users WHERE id = ?')) {
      const user = this.db.users.find((u) => u.id === this.params[0]);
      return user ? { is_community_member: user.is_community_member } : null;
    }
    throw new Error(`Unhandled first SQL: ${sql}`);
  }
}

class FakeD1Database {
  constructor(users) {
    this.users = users;
    this.communityMembers = new Map();
    this.tierChanges = [];
    this.emailSequences = [];
    this.cancelledCreditSequences = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    for (const statement of statements) await statement.run();
    return [];
  }

  updateUser(id, changes) {
    const user = this.users.find((u) => u.id === id);
    if (!user) throw new Error(`Missing user ${id}`);
    Object.assign(user, changes);
  }

  updateMany(ids, changes) {
    for (const id of ids) this.updateUser(id, changes);
  }
}

const admin = {
  id: 'admin',
  google_id: 'admin-google',
  email: 'staging-admin@example.com',
  name: 'Staging Admin',
  avatar_url: '',
  subscription_tier: 'community',
  is_community_member: true,
  is_admin: true,
  credits_used: 0,
};

const db = new FakeD1Database([
  { id: 'csv-free', email: 'csv-free@example.com', name: 'CSV Free', subscription_tier: 'free', is_community_member: 0, is_admin: 0 },
  { id: 'csv-pro', email: 'csv-pro@example.com', name: 'CSV Pro', subscription_tier: 'pro', is_community_member: 0, is_admin: 0 },
  { id: 'csv-existing', email: 'csv-existing@example.com', name: 'CSV Existing', subscription_tier: 'community', is_community_member: 1, is_admin: 0 },
  { id: 'old-community', email: 'old-community@example.com', name: 'Old Community', subscription_tier: 'community', is_community_member: 1, is_admin: 0 },
  { id: 'old-pro', email: 'old-pro@example.com', name: 'Old Pro', subscription_tier: 'pro', is_community_member: 1, is_admin: 0 },
  { id: 'admin-user', email: 'nico@airankingskool.com', name: 'Admin', subscription_tier: 'community', is_community_member: 1, is_admin: 1 },
]);

const csv = [
  'Email,First Name,Last Name,Tier,LTV,Joined',
  'csv-free@example.com,Free,User,Member,27,2026-05-01',
  'CSV-PRO@example.com,Pro,User,Member,27,2026-05-01',
  'csv-existing@example.com,Existing,User,Member,27,2026-05-01',
].join('\n');

(async () => {
  const response = await handleUploadMembers(
    new Request('https://datawise-api.nico-510.workers.dev/api/admin/upload-members', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    }),
    { DB: db },
    admin,
  );

  const result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(result, {
    success: true,
    imported: 3,
    granted: 2,
    revoked: 1,
    preserved_pro: 1,
    winback_started: 1,
  });

  assert.deepEqual(db.users.find((u) => u.id === 'csv-free'), {
    id: 'csv-free',
    email: 'csv-free@example.com',
    name: 'CSV Free',
    subscription_tier: 'community',
    is_community_member: 1,
    is_admin: 0,
  });
  assert.equal(db.users.find((u) => u.id === 'csv-pro').subscription_tier, 'pro');
  assert.equal(db.users.find((u) => u.id === 'csv-pro').is_community_member, 1);
  assert.equal(db.users.find((u) => u.id === 'old-community').subscription_tier, 'free');
  assert.equal(db.users.find((u) => u.id === 'old-community').is_community_member, 0);
  assert.equal(db.users.find((u) => u.id === 'old-pro').subscription_tier, 'pro');
  assert.equal(db.users.find((u) => u.id === 'old-pro').is_community_member, 0);
  assert.equal(db.users.find((u) => u.id === 'admin-user').subscription_tier, 'community');
  assert.equal(db.users.find((u) => u.id === 'admin-user').is_community_member, 1);
  assert.deepEqual(db.emailSequences, [{ userId: 'old-community', sequenceType: 'winback' }]);
  assert.deepEqual(db.tierChanges, [
    { userId: 'csv-free', fromTier: 'free', toTier: 'community', source: 'csv_upload' },
    { userId: 'old-community', fromTier: 'community', toTier: 'free', source: 'csv_upload' },
  ]);

  console.log('community CSV upload reconciliation test passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

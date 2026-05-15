import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function loadTs(file, mocks, cache = new Map()) {
  const abs = path.resolve(root, file);
  if (cache.has(abs)) return cache.get(abs).exports;

  const source = fs.readFileSync(abs, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      isolatedModules: false,
    },
    fileName: abs,
  });

  const mod = { exports: {} };
  cache.set(abs, mod);
  const dirname = path.dirname(abs);
  const localRequire = (specifier) => {
    if (mocks[specifier]) return mocks[specifier];
    if (specifier.startsWith('.')) {
      const target = path.resolve(dirname, specifier) + '.ts';
      return loadTs(path.relative(root, target), mocks, cache);
    }
    return require(specifier);
  };

  const wrapped = new vm.Script(
    `(function(require, module, exports, __dirname, __filename) { ${outputText}\n })`,
    { filename: abs }
  ).runInThisContext();
  wrapped(localRequire, mod, mod.exports, dirname, abs);
  return mod.exports;
}

class FakeStatement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new FakeStatement(this.db, this.sql, params);
  }

  async first() {
    if (this.sql.includes('FROM users WHERE id = ?')) {
      return this.db.users.get(this.params[0]) || null;
    }
    if (this.sql.includes('FROM promo_redemptions')) {
      return this.db.activePromoUserIds.has(this.params[0]) ? { active: 1 } : null;
    }
    return null;
  }

  async run() {
    if (this.sql.includes('SET credits_used = credits_used + ?')) {
      const user = this.db.users.get(this.params[1]);
      if (user) user.credits_used += this.params[0];
      this.db.creditUpdates += 1;
      return { meta: { changes: user ? 1 : 0 } };
    }
    if (this.sql.includes('SET credits_exhausted_email_sent = 1')) {
      const user = this.db.users.get(this.params[0]);
      if (user) user.credits_exhausted_email_sent = 1;
      return { meta: { changes: user ? 1 : 0 } };
    }
    return { meta: { changes: 0 } };
  }
}

class FakeD1 {
  constructor(users, activePromoUserIds = []) {
    this.users = new Map(users.map((user) => [user.id, { ...user }]));
    this.activePromoUserIds = new Set(activePromoUserIds);
    this.creditUpdates = 0;
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

function makeEnv(users, activePromoUserIds = []) {
  return { DB: new FakeD1(users, activePromoUserIds) };
}

const { checkAndDeductCredit } = loadTs('src/middleware/credits.ts', {
  '../email/resend': {
    sendCreditsExhaustedEmail: async () => undefined,
  },
});

const adminEnv = makeEnv([
  {
    id: 'admin',
    email: 'nico@airankingskool.com',
    name: 'Nico',
    subscription_tier: 'free',
    is_community_member: 0,
    is_admin: 1,
    credits_used: 5,
    credits_exhausted_email_sent: 1,
  },
]);
const adminResult = await checkAndDeductCredit(adminEnv, 'admin', 2);
assert.equal(adminResult.allowed, true);
assert.equal(adminResult.unlimited, true);
assert.equal(adminEnv.DB.users.get('admin').credits_used, 5);
assert.equal(adminEnv.DB.creditUpdates, 0);

const freeEnv = makeEnv([
  {
    id: 'free',
    email: 'free@example.com',
    name: 'Free',
    subscription_tier: 'free',
    is_community_member: 0,
    is_admin: 0,
    credits_used: 5,
    credits_exhausted_email_sent: 1,
  },
]);
const freeResult = await checkAndDeductCredit(freeEnv, 'free', 1);
assert.equal(freeResult.allowed, false);
assert.equal(freeResult.unlimited, false);
assert.equal(freeEnv.DB.creditUpdates, 0);

const communityEnv = makeEnv([
  {
    id: 'community',
    email: 'member@example.com',
    name: 'Member',
    subscription_tier: 'community',
    is_community_member: 1,
    is_admin: 0,
    credits_used: 99,
    credits_exhausted_email_sent: 1,
  },
]);
const communityResult = await checkAndDeductCredit(communityEnv, 'community', 2);
assert.equal(communityResult.allowed, true);
assert.equal(communityResult.unlimited, true);
assert.equal(communityEnv.DB.users.get('community').credits_used, 99);
assert.equal(communityEnv.DB.creditUpdates, 0);

const promoEnv = makeEnv([
  {
    id: 'promo',
    email: 'promo@example.com',
    name: 'Promo',
    subscription_tier: 'free',
    is_community_member: 0,
    is_admin: 0,
    credits_used: 5,
    credits_exhausted_email_sent: 1,
  },
], ['promo']);
const promoResult = await checkAndDeductCredit(promoEnv, 'promo', 1);
assert.equal(promoResult.allowed, true);
assert.equal(promoResult.unlimited, true);
assert.equal(promoEnv.DB.users.get('promo').credits_used, 5);
assert.equal(promoEnv.DB.creditUpdates, 0);

console.log('credits middleware tests passed');

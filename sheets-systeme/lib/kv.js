import { Redis } from "@upstash/redis";

let _client = null;
function client() {
  if (!_client) {
    _client = new Redis({
      // Accept either the Upstash names or the Vercel-injected KV_* names.
      url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
    });
  }
  return _client;
}

// Thin proxy so importing this module never throws when env is missing.
export const kv = {
  get: (...a) => client().get(...a),
  set: (...a) => client().set(...a),
  del: (...a) => client().del(...a),
  sadd: (...a) => client().sadd(...a),
  srem: (...a) => client().srem(...a),
  smembers: (...a) => client().smembers(...a),
};

export const keys = {
  session: (sid) => `sess:${sid}`,
  connection: (token) => `conn:${token}`,
  userConns: (sub) => `user:${sub}:conns`,
};

import { Router } from 'express';
import { Redis } from 'ioredis';
import { pingDb } from '../db/index.js';
import { env } from '../env.js';

const router = Router();
let redisProbe = null;

router.get('/', async (req, res) => {
  if (!redisProbe) redisProbe = new Redis(env.redisUrl, { lazyConnect: true });

  const [db, redis] = await Promise.all([
    pingDb(),
    (async () => {
      const t0 = Date.now();
      try {
        if (redisProbe.status !== 'ready') await redisProbe.connect();
        await redisProbe.ping();
        return { ok: true, latencyMs: Date.now() - t0 };
      } catch (e) { return { ok: false, error: e.message }; }
    })(),
  ]);

  res.json({
    ok: db.ok && redis.ok,
    db, redis,
    uptimeSec: Math.round(process.uptime()),
    nodeEnv:   env.nodeEnv,
  });
});

export default router;

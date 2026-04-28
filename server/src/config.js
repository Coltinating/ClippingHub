import { z } from 'zod';

const Schema = z.object({
  PORT: z.coerce.number().int().positive().default(3535),
  DATA_DIR: z.string().default('./data'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  MAX_LOBBIES: z.coerce.number().int().positive().default(200),
  LOBBY_TTL_HOURS: z.coerce.number().int().positive().default(24)
});

export function loadConfig(env = process.env) {
  const parsed = Schema.parse(env);
  return {
    port: parsed.PORT,
    dataDir: parsed.DATA_DIR,
    logLevel: parsed.LOG_LEVEL,
    maxLobbies: parsed.MAX_LOBBIES,
    lobbyTtlHours: parsed.LOBBY_TTL_HOURS
  };
}

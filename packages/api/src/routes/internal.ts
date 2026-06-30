import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../db';
import { env } from '../env';

const participantSchema = z.object({
  userId:   z.string().uuid().nullable().optional(),
  color:    z.enum(['red', 'blue']),
  name:     z.string().min(1).max(50),
  isBot:    z.boolean().default(false),
  isWinner: z.boolean().default(false),
});

const createGameBody = z.object({
  sessionId:   z.string().min(1),
  mode:        z.enum(['pvp', 'solo']),
  isRated:     z.boolean().default(false),
  startedAt:   z.string().datetime(),
  endedAt:     z.string().datetime(),
  durationMs:  z.number().int().nonnegative(),
  turnsPlayed: z.number().int().nonnegative().default(0),
  winnerColor: z.enum(['red', 'blue']).nullable().optional(),
  winReason:   z.string().min(1),
  logPath:     z.string().nullable().optional(),
  participants: z.array(participantSchema).min(1).max(2),
});

export async function internalRoutes(app: FastifyInstance): Promise<void> {
  // POST /internal/games — record a completed game
  // Requires X-Internal-Key header
  app.post('/games', async (request, reply) => {
    const key = request.headers['x-internal-key'];
    if (!key || key !== env.INTERNAL_API_KEY) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid internal API key' });
    }

    const parse = createGameBody.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parse.error.flatten() });
    }

    const {
      sessionId, mode, isRated, startedAt, endedAt, durationMs,
      turnsPlayed, winnerColor, winReason, logPath, participants,
    } = parse.data;

    // Idempotency: skip if sessionId already recorded
    const existing = await prisma.game.findUnique({ where: { sessionId } });
    if (existing) {
      return reply.status(200).send({ gameId: existing.id, duplicate: true });
    }

    // Create game + participants in a transaction, then update stats
    const game = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const g = await tx.game.create({
        data: {
          sessionId,
          mode,
          isRated,
          startedAt:   new Date(startedAt),
          endedAt:     new Date(endedAt),
          durationMs,
          turnsPlayed,
          winnerColor: winnerColor ?? null,
          winReason,
          logPath:     logPath ?? null,
          participants: {
            create: participants.map((p) => ({
              userId:   p.userId ?? null,
              color:    p.color,
              name:     p.name,
              isBot:    p.isBot,
              isWinner: p.isWinner,
            })),
          },
        },
      });

      // Update UserProfile stats for each authenticated participant
      for (const p of participants) {
        if (!p.userId) continue;

        await tx.userProfile.upsert({
          where:  { userId: p.userId },
          create: {
            userId:          p.userId,
            gamesPlayed:     1,
            wins:            p.isWinner ? 1 : 0,
            ratedGamesPlayed: isRated ? 1 : 0,
            ratedWins:        isRated && p.isWinner ? 1 : 0,
          },
          update: {
            gamesPlayed:      { increment: 1 },
            wins:             p.isWinner ? { increment: 1 } : undefined,
            ratedGamesPlayed: isRated ? { increment: 1 } : undefined,
            ratedWins:        isRated && p.isWinner ? { increment: 1 } : undefined,
          },
        });
      }

      return g;
    });

    return reply.status(201).send({ gameId: game.id });
  });
}

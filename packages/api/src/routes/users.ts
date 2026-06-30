import type { FastifyInstance } from 'fastify';
import '@fastify/multipart'; // augments FastifyRequest with .file()
import type { MultipartFile } from '@fastify/multipart';
import path from 'path';
import fs from 'fs';
import prisma from '../db';
import { env } from '../env';
import { verifyToken } from '../services/authService';
import { z } from 'zod';

// ─── Auth helper ─────────────────────────────────────────────────────────────

function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const updateProfileBody = z.object({
  bio:       z.string().max(300).nullable().optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
});

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_AVATAR_BYTES = env.MAX_AVATAR_SIZE_MB * 1024 * 1024;

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function usersRoutes(app: FastifyInstance): Promise<void> {

  // ── GET /users/me — private, requires JWT ─────────────────────────────────
  app.get('/me', async (request, reply) => {
    const token = extractToken(request.headers.authorization);
    if (!token) return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Требуется авторизация' });

    let payload;
    try { payload = verifyToken(token); }
    catch { return reply.status(401).send({ error: 'INVALID_TOKEN', message: 'Токен недействителен или истёк' }); }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id:            true,
        login:         true,
        email:         true,
        createdAt:     true,
        emailVerified: true,
        verifiedAt:    true,
        profile: {
          select: {
            avatarUrl:        true,
            bio:              true,
            rating:           true,
            gamesPlayed:      true,
            wins:             true,
            ratedGamesPlayed: true,
            ratedWins:        true,
          },
        },
      },
    });

    if (!user) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Пользователь не найден' });
    return reply.send({ user });
  });

  // ── GET /users/:login — public profile ────────────────────────────────────
  app.get('/:login', async (request, reply) => {
    const { login } = request.params as { login: string };

    // Check if this is the authenticated user (to expose email)
    const token = extractToken(request.headers.authorization);
    let callerId: string | null = null;
    if (token) {
      try { callerId = verifyToken(token).sub; } catch { /* ok */ }
    }

    const user = await prisma.user.findUnique({
      where: { login },
      select: {
        id:            true,
        login:         true,
        email:         true,
        createdAt:     true,
        emailVerified: true,
        profile: {
          select: {
            avatarUrl:        true,
            bio:              true,
            rating:           true,
            gamesPlayed:      true,
            wins:             true,
            ratedGamesPlayed: true,
            ratedWins:        true,
            tournamentsPlayed: true,
            tournamentWins:    true,
          },
        },
      },
    });

    if (!user) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Пользователь не найден' });

    const isMe = callerId === user.id;
    return reply.send({
      user: {
        id:            user.id,
        login:         user.login,
        // Only expose email if caller is the profile owner
        email:         isMe ? user.email : undefined,
        createdAt:     user.createdAt,
        emailVerified: isMe ? user.emailVerified : undefined,
        profile:       user.profile,
      },
    });
  });

  // ── GET /users/:login/games — public game history ─────────────────────────
  app.get('/:login/games', async (request, reply) => {
    const { login } = request.params as { login: string };
    const query = request.query as Record<string, string>;
    const page  = Math.max(1, parseInt(query.page  ?? '1',  10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(query.limit ?? '25', 10) || 25));
    const skip  = (page - 1) * limit;

    const user = await prisma.user.findUnique({ where: { login }, select: { id: true } });
    if (!user) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Пользователь не найден' });

    const [total, games] = await prisma.$transaction([
      prisma.game.count({
        where: { participants: { some: { userId: user.id } } },
      }),
      prisma.game.findMany({
        where:   { participants: { some: { userId: user.id } } },
        orderBy: { startedAt: 'desc' },
        skip,
        take:    limit,
        select: {
          id:          true,
          sessionId:   true,
          mode:        true,
          isRated:     true,
          startedAt:   true,
          endedAt:     true,
          durationMs:  true,
          turnsPlayed: true,
          winnerColor: true,
          winReason:   true,
          participants: {
            select: {
              id:       true,
              userId:   true,
              color:    true,
              name:     true,
              isBot:    true,
              isWinner: true,
            },
          },
        },
      }),
    ]);

    return reply.send({ games, total, page, limit, totalPages: Math.ceil(total / limit) });
  });

  // ── GET /users/:login/activity — activity heatmap (last 365 days) ─────────
  app.get('/:login/activity', async (request, reply) => {
    const { login } = request.params as { login: string };
    const user = await prisma.user.findUnique({ where: { login }, select: { id: true } });
    if (!user) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Пользователь не найден' });

    // Fetch all games in the last 366 days, grouped by date (UTC)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 365);

    type ActivityRow = { date: string; count: bigint };
    const rows = await prisma.$queryRaw<ActivityRow[]>`
      SELECT
        TO_CHAR("startedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
        COUNT(*)::bigint AS count
      FROM "Game" g
      JOIN "GameParticipant" gp ON gp."gameId" = g.id
      WHERE gp."userId" = ${user.id}
        AND g."startedAt" >= ${cutoff}
      GROUP BY date
      ORDER BY date
    `;

    const activity = rows.map((r: ActivityRow) => ({
      date:  r.date,
      count: Number(r.count),
    }));

    return reply.send({ activity });
  });

  // ── PATCH /users/me/profile — update bio / avatarUrl ──────────────────────
  app.patch('/me/profile', async (request, reply) => {
    const token = extractToken(request.headers.authorization);
    if (!token) return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Требуется авторизация' });

    let payload;
    try { payload = verifyToken(token); }
    catch { return reply.status(401).send({ error: 'INVALID_TOKEN', message: 'Токен недействителен или истёк' }); }

    const parse = updateProfileBody.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parse.error.flatten() });
    }

    const { bio, avatarUrl } = parse.data;

    const profile = await prisma.userProfile.upsert({
      where:  { userId: payload.sub },
      create: { userId: payload.sub, bio: bio ?? null, avatarUrl: avatarUrl ?? null },
      update: {
        ...(bio       !== undefined ? { bio }       : {}),
        ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      },
      select: {
        avatarUrl:        true,
        bio:              true,
        rating:           true,
        gamesPlayed:      true,
        wins:             true,
        ratedGamesPlayed: true,
        ratedWins:        true,
      },
    });

    return reply.send({ profile });
  });

  // ── DELETE /users/me/avatar — remove avatar ───────────────────────────────
  app.delete('/me/avatar', async (request, reply) => {
    const token = extractToken(request.headers.authorization);
    if (!token) return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Требуется авторизация' });

    let payload;
    try { payload = verifyToken(token); }
    catch { return reply.status(401).send({ error: 'INVALID_TOKEN', message: 'Токен недействителен или истёк' }); }

    // Get current avatar path to delete the file
    const current = await prisma.userProfile.findUnique({
      where:  { userId: payload.sub },
      select: { avatarUrl: true },
    });

    if (current?.avatarUrl) {
      // avatarUrl looks like /uploads/avatars/userId.jpg
      const rel = current.avatarUrl.replace(/^\/uploads\//, '');
      const localPath = path.join(env.UPLOADS_DIR, rel);
      try { fs.unlinkSync(localPath); } catch { /* file may already be gone */ }
    }

    const profile = await prisma.userProfile.upsert({
      where:  { userId: payload.sub },
      create: { userId: payload.sub, avatarUrl: null },
      update: { avatarUrl: null },
      select: {
        avatarUrl:        true,
        bio:              true,
        rating:           true,
        gamesPlayed:      true,
        wins:             true,
        ratedGamesPlayed: true,
        ratedWins:        true,
      },
    });

    return reply.send({ profile });
  });

  // ── DELETE /users/me — permanently delete own account ────────────────────
  app.delete('/me', async (request, reply) => {
    const token = extractToken(request.headers.authorization);
    if (!token) return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Требуется авторизация' });

    let payload;
    try { payload = verifyToken(token); }
    catch { return reply.status(401).send({ error: 'INVALID_TOKEN', message: 'Токен недействителен или истёк' }); }

    // Delete avatar file if present
    const profile = await prisma.userProfile.findUnique({
      where:  { userId: payload.sub },
      select: { avatarUrl: true },
    });
    if (profile?.avatarUrl) {
      const rel = profile.avatarUrl.replace(/^\/uploads\//, '');
      const localPath = path.join(env.UPLOADS_DIR, rel);
      try { fs.unlinkSync(localPath); } catch { /* file may already be gone */ }
    }

    // Cascade deletes UserProfile + EmailVerification; sets GameParticipant.userId = null
    await prisma.user.delete({ where: { id: payload.sub } });

    return reply.send({ ok: true });
  });

  // ── POST /users/me/claim-game — link a guest game to authenticated account ─
  app.post('/me/claim-game', async (request, reply) => {
    const token = extractToken(request.headers.authorization);
    if (!token) return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Требуется авторизация' });

    let payload;
    try { payload = verifyToken(token); }
    catch { return reply.status(401).send({ error: 'INVALID_TOKEN', message: 'Токен недействителен или истёк' }); }

    const body = request.body as { sessionId?: string; color?: string };
    if (!body.sessionId || !body.color || !['red', 'blue'].includes(body.color)) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: 'Укажите sessionId и color (red/blue)' });
    }
    const { sessionId, color } = body as { sessionId: string; color: 'red' | 'blue' };

    // Find the game and the participant slot
    const game = await prisma.game.findUnique({
      where: { sessionId },
      select: { id: true, isRated: true, participants: { select: { id: true, userId: true, color: true, isWinner: true } } },
    });
    if (!game) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Игра не найдена' });

    const participant = game.participants.find((p: { id: string; userId: string | null; color: string; isWinner: boolean }) => p.color === color);
    if (!participant) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Участник не найден' });
    if (participant.userId !== null) {
      // Already claimed — idempotent OK if claimed by same user
      if (participant.userId === payload.sub) return reply.send({ ok: true });
      return reply.status(409).send({ error: 'ALREADY_CLAIMED', message: 'Игра уже привязана к другому аккаунту' });
    }

    // Link participant and update stats in a transaction
    await prisma.$transaction(async (tx: import('@prisma/client').Prisma.TransactionClient) => {
      await tx.gameParticipant.update({
        where: { id: participant.id },
        data:  { userId: payload.sub },
      });
      await tx.userProfile.upsert({
        where:  { userId: payload.sub },
        create: {
          userId:          payload.sub,
          gamesPlayed:     1,
          wins:            participant.isWinner ? 1 : 0,
          ratedGamesPlayed: game.isRated ? 1 : 0,
          ratedWins:        game.isRated && participant.isWinner ? 1 : 0,
        },
        update: {
          gamesPlayed:      { increment: 1 },
          wins:             participant.isWinner ? { increment: 1 } : undefined,
          ratedGamesPlayed: game.isRated ? { increment: 1 } : undefined,
          ratedWins:        game.isRated && participant.isWinner ? { increment: 1 } : undefined,
        },
      });
    });

    return reply.send({ ok: true });
  });

  // ── POST /users/me/avatar — upload avatar file ────────────────────────────
  app.post('/me/avatar', async (request, reply) => {
    const token = extractToken(request.headers.authorization);
    if (!token) return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Требуется авторизация' });

    let payload;
    try { payload = verifyToken(token); }
    catch { return reply.status(401).send({ error: 'INVALID_TOKEN', message: 'Токен недействителен или истёк' }); }

    let file: MultipartFile | undefined;
    try {
      file = await request.file({ limits: { fileSize: MAX_AVATAR_BYTES } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Request file too large') || msg.toLowerCase().includes('limit')) {
        return reply.status(413).send({ error: 'FILE_TOO_LARGE', message: `Максимальный размер файла: ${env.MAX_AVATAR_SIZE_MB} МБ` });
      }
      throw err;
    }

    if (!file) return reply.status(400).send({ error: 'NO_FILE', message: 'Файл не передан' });
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return reply.status(415).send({ error: 'UNSUPPORTED_MEDIA_TYPE', message: 'Поддерживаются: JPEG, PNG, WEBP, GIF' });
    }

    const ext = file.mimetype.split('/')[1].replace('jpeg', 'jpg');
    const filename = `${payload.sub}.${ext}`;
    const avatarsDir = path.join(env.UPLOADS_DIR, 'avatars');
    fs.mkdirSync(avatarsDir, { recursive: true });

    const filePath = path.join(avatarsDir, filename);
    const writeStream = fs.createWriteStream(filePath);

    await new Promise<void>((resolve, reject) => {
      file!.file.pipe(writeStream);
      file!.file.on('end', resolve);
      file!.file.on('error', reject);
      writeStream.on('error', reject);
    });

    const avatarUrl = `/uploads/avatars/${filename}`;

    await prisma.userProfile.upsert({
      where:  { userId: payload.sub },
      create: { userId: payload.sub, avatarUrl },
      update: { avatarUrl },
    });

    return reply.send({ avatarUrl });
  });
}

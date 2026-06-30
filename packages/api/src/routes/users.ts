import type { FastifyInstance } from 'fastify';
import prisma from '../db';
import { verifyToken } from '../services/authService';

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  // GET /users/me — requires Authorization: Bearer <token>
  app.get('/me', async (request, reply) => {
    const auth = request.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Требуется авторизация' });
    }
    const token = auth.slice(7);
    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return reply.status(401).send({ error: 'INVALID_TOKEN', message: 'Токен недействителен или истёк' });
    }

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
            avatarUrl:   true,
            rating:      true,
            gamesPlayed: true,
            wins:        true,
          },
        },
      },
    });

    if (!user) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Пользователь не найден' });
    }

    return reply.send({ user });
  });
}

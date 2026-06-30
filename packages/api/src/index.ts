import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import path from 'path';
import fs from 'fs';
import { env } from './env';
import { authRoutes } from './routes/auth';
import { usersRoutes } from './routes/users';
import { internalRoutes } from './routes/internal';

const app = Fastify({
  logger: env.NODE_ENV !== 'test',
});

async function start(): Promise<void> {
  // CORS
  await app.register(cors, {
    origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Multipart (for avatar uploads)
  await app.register(multipart);

  // Static files — serve uploaded avatars
  const uploadsDir = env.UPLOADS_DIR;
  fs.mkdirSync(uploadsDir, { recursive: true });
  await app.register(staticFiles, {
    root:   uploadsDir,
    prefix: '/uploads/',
    decorateReply: false,
  });

  // OpenAPI / Swagger
  await app.register(swagger, {
    openapi: {
      info: {
        title:       'Minesweeper PvP API',
        version:     '1.0.0',
        description: 'REST API for user authentication and profiles',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type:         'http',
            scheme:       'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig:    { deepLinking: true },
  });

  // Routes
  await app.register(authRoutes,     { prefix: '/auth' });
  await app.register(usersRoutes,    { prefix: '/users' });
  await app.register(internalRoutes, { prefix: '/internal' });

  // Health check
  app.get('/health', async () => ({ ok: true }));

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`API server listening on port ${env.PORT}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});

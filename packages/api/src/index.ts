import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { env } from './env';
import { authRoutes } from './routes/auth';
import { usersRoutes } from './routes/users';

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

  // OpenAPI / Swagger
  await app.register(swagger, {
    openapi: {
      info: {
        title:   'Minesweeper PvP API',
        version: '1.0.0',
        description: 'REST API for user authentication and profiles',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { deepLinking: true },
  });

  // Routes
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(usersRoutes, { prefix: '/users' });

  // Health check
  app.get('/health', async () => ({ ok: true }));

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`API server listening on port ${env.PORT}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});

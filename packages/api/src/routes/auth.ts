import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as authService from '../services/authService';

const registerBody = z.object({
  email:           z.string().email('Некорректный email'),
  login:           z.string().min(3, 'Логин: минимум 3 символа').max(20, 'Логин: максимум 20 символов')
                              .regex(/^[a-zA-Z0-9_-]+$/, 'Логин: только латиница, цифры, _ и -'),
  password:        z.string().min(8, 'Пароль: минимум 8 символов'),
  passwordConfirm: z.string(),
}).refine((d) => d.password === d.passwordConfirm, {
  message: 'Пароли не совпадают',
  path: ['passwordConfirm'],
});

const verifyEmailBody = z.object({
  email: z.string().email(),
  code:  z.string().length(6, 'Код должен содержать 6 цифр').regex(/^\d{6}$/, 'Код должен состоять из цифр'),
});

const loginBody = z.object({
  emailOrLogin: z.string().min(1, 'Введите email или логин'),
  password:     z.string().min(1, 'Введите пароль'),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /auth/register
  app.post('/register', async (request, reply) => {
    const parse = registerBody.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parse.error.flatten() });
    }
    const { email, login, password } = parse.data;
    const result = await authService.register(email, login, password);
    if ('error' in result) {
      const msg = result.error === 'EMAIL_TAKEN' ? 'Email уже используется' : 'Логин уже занят';
      return reply.status(409).send({ error: result.error, message: msg });
    }
    return reply.status(201).send({ message: 'Код подтверждения отправлен на email' });
  });

  // POST /auth/verify-email
  app.post('/verify-email', async (request, reply) => {
    const parse = verifyEmailBody.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parse.error.flatten() });
    }
    const { email, code } = parse.data;
    const result = await authService.verifyEmail(email, code);
    if ('error' in result) {
      const status = result.error === 'CODE_INVALID' ? 400 : 422;
      const messages: Record<string, string> = {
        USER_NOT_FOUND:    'Пользователь не найден',
        ALREADY_VERIFIED:  'Email уже подтверждён',
        CODE_INVALID:      'Неверный или истёкший код',
      };
      return reply.status(status).send({ error: result.error, message: messages[result.error] });
    }
    return reply.send({ token: result.token, user: result.user });
  });

  // POST /auth/login
  app.post('/login', async (request, reply) => {
    const parse = loginBody.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parse.error.flatten() });
    }
    const { emailOrLogin, password } = parse.data;
    const result = await authService.login(emailOrLogin, password);
    if ('error' in result) {
      const status = result.error === 'EMAIL_NOT_VERIFIED' ? 403 : 401;
      const messages: Record<string, string> = {
        NOT_FOUND:           'Неверный логин/email или пароль',
        WRONG_PASSWORD:      'Неверный логин/email или пароль',
        EMAIL_NOT_VERIFIED:  'Email не подтверждён. Проверьте почту.',
      };
      return reply.status(status).send({ error: result.error, message: messages[result.error] });
    }
    return reply.send({ token: result.token, user: result.user });
  });
}

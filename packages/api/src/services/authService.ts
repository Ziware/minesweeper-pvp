import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../db';
import { env } from '../env';
import { sendVerificationCode } from './mailService';

const BCRYPT_ROUNDS = 12;
const CODE_TTL_MS   = 15 * 60 * 1000; // 15 minutes

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export interface JwtPayload {
  sub:           string;
  login:         string;
  email:         string;
  emailVerified: boolean;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

// ─── Register ──────────────────────────────────────────────────────────────

export type RegisterError =
  | 'EMAIL_TAKEN'
  | 'LOGIN_TAKEN';

export async function register(
  email: string,
  login: string,
  password: string,
): Promise<{ error: RegisterError } | { userId: string }> {
  // Check uniqueness
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { login }] },
    select: { email: true, login: true },
  });
  if (existing) {
    if (existing.email === email) return { error: 'EMAIL_TAKEN' };
    return { error: 'LOGIN_TAKEN' };
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email,
      login,
      passwordHash,
      profile: { create: {} },
    },
  });

  // Create verification code
  const code = generateCode();
  await prisma.emailVerification.create({
    data: {
      userId:    user.id,
      code,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });

  // Send verification email — non-fatal: user is already created even if email fails
  try {
    await sendVerificationCode(email, code);
  } catch (err) {
    console.error('[authService] Failed to send verification email:', err);
  }

  return { userId: user.id };
}

// ─── Verify email ─────────────────────────────────────────────────────────

export type VerifyError =
  | 'USER_NOT_FOUND'
  | 'ALREADY_VERIFIED'
  | 'CODE_INVALID';

export async function verifyEmail(
  email: string,
  code: string,
): Promise<{ error: VerifyError } | { token: string; user: { id: string; login: string; email: string; emailVerified: boolean } }> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return { error: 'USER_NOT_FOUND' };
  if (user.emailVerified) return { error: 'ALREADY_VERIFIED' };

  const verification = await prisma.emailVerification.findFirst({
    where: {
      userId:    user.id,
      code,
      used:      false,
      expiresAt: { gte: new Date() },
    },
  });
  if (!verification) return { error: 'CODE_INVALID' };

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data:  { emailVerified: true, verifiedAt: new Date() },
    }),
    prisma.emailVerification.update({
      where: { id: verification.id },
      data:  { used: true },
    }),
  ]);

  const token = signToken({ sub: user.id, login: user.login, email: user.email, emailVerified: true });
  return { token, user: { id: user.id, login: user.login, email: user.email, emailVerified: true } };
}

// ─── Login ────────────────────────────────────────────────────────────────

export type LoginError =
  | 'NOT_FOUND'
  | 'WRONG_PASSWORD';

export async function login(
  emailOrLogin: string,
  password: string,
): Promise<{ error: LoginError } | { token: string; user: { id: string; login: string; email: string; emailVerified: boolean } }> {
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: emailOrLogin }, { login: emailOrLogin }],
    },
  });
  if (!user) return { error: 'NOT_FOUND' };

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return { error: 'WRONG_PASSWORD' };

  // Allow login even if email is not verified — emailVerified flag is in JWT/response
  const token = signToken({ sub: user.id, login: user.login, email: user.email, emailVerified: user.emailVerified });
  return { token, user: { id: user.id, login: user.login, email: user.email, emailVerified: user.emailVerified } };
}

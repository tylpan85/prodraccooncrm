import { createHash, randomUUID } from 'node:crypto';
import { type AuthSession, ERROR_CODES } from '@openclaw/shared';
import argon2 from 'argon2';
import { prisma } from '@openclaw/db';
import { ApiError } from '../../lib/error-envelope.js';
import {
  type AccessTokenPayload,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from './jwt.js';

interface IssueContext {
  userAgent?: string | null;
  ip?: string | null;
}

function hashRefresh(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function issueTokens(
  userId: string,
  orgId: string,
  ctx: IssueContext,
): Promise<{ accessToken: string; refreshToken: string }> {
  const jti = randomUUID();
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({ sub: userId, orgId }),
    signRefreshToken({ sub: userId, jti }),
  ]);

  const expiresAt = new Date();
  const ttlDays = Number.parseInt(process.env.JWT_REFRESH_TTL_DAYS ?? '30', 10);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + ttlDays);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashRefresh(refreshToken),
      userAgent: ctx.userAgent ?? null,
      ip: ctx.ip ?? null,
      expiresAt,
    },
  });

  return { accessToken, refreshToken };
}

function toSession(user: {
  id: string;
  email: string;
  role: string;
  mustResetPassword: boolean;
  organization: { id: string; name: string; timezone: string };
}): AuthSession {
  return {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      mustResetPassword: user.mustResetPassword,
    },
    organization: {
      id: user.organization.id,
      name: user.organization.name,
      timezone: user.organization.timezone,
    },
  };
}

export async function login(
  email: string,
  password: string,
  ctx: IssueContext,
): Promise<{ session: AuthSession; accessToken: string; refreshToken: string }> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { organization: true },
  });
  if (!user) {
    throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Invalid credentials');
  }
  const ok = await argon2.verify(user.passwordHash, password);
  if (!ok) {
    throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Invalid credentials');
  }
  const tokens = await issueTokens(user.id, user.organizationId, ctx);
  return { session: toSession(user), ...tokens };
}

export async function refresh(
  rawRefreshToken: string,
  ctx: IssueContext,
): Promise<{ accessToken: string; refreshToken: string }> {
  let payload;
  try {
    payload = await verifyRefreshToken(rawRefreshToken);
  } catch {
    throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Invalid refresh token');
  }

  const tokenHash = hashRefresh(rawRefreshToken);
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!row || row.revokedAt || row.expiresAt < new Date() || row.userId !== payload.sub) {
    throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Invalid refresh token');
  }

  await prisma.refreshToken.update({
    where: { tokenHash },
    data: { revokedAt: new Date() },
  });

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) {
    throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'User no longer exists');
  }

  return issueTokens(user.id, user.organizationId, ctx);
}

export async function logout(rawRefreshToken: string | undefined): Promise<void> {
  if (!rawRefreshToken) return;
  const tokenHash = hashRefresh(rawRefreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getSession(access: AccessTokenPayload): Promise<AuthSession> {
  const user = await prisma.user.findUnique({
    where: { id: access.sub },
    include: { organization: true },
  });
  if (!user) {
    throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Session invalid');
  }
  return toSession(user);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Session invalid');
  }
  const ok = await argon2.verify(user.passwordHash, currentPassword);
  if (!ok) {
    throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, 'Current password incorrect');
  }
  const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustResetPassword: false },
  });
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

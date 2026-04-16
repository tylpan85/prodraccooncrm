import { SignJWT, jwtVerify } from 'jose';
import { loadEnv } from '../../lib/env.js';

const env = loadEnv();

const accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const refreshKey = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

export interface AccessTokenPayload {
  sub: string;
  orgId: string;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
}

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({ orgId: payload.orgId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.JWT_ACCESS_TTL_MINUTES}m`)
    .sign(accessKey);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, accessKey);
  if (typeof payload.sub !== 'string' || typeof payload.orgId !== 'string') {
    throw new Error('malformed access token');
  }
  return { sub: payload.sub, orgId: payload.orgId };
}

export async function signRefreshToken(payload: RefreshTokenPayload): Promise<string> {
  return new SignJWT({ jti: payload.jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setJti(payload.jti)
    .setIssuedAt()
    .setExpirationTime(`${env.JWT_REFRESH_TTL_DAYS}d`)
    .sign(refreshKey);
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  const { payload } = await jwtVerify(token, refreshKey);
  if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
    throw new Error('malformed refresh token');
  }
  return { sub: payload.sub, jti: payload.jti };
}

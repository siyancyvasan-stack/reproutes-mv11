import type { Request, Response } from 'express';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  login: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  requestRegistrationOtp: vi.fn(),
  verifyRegistrationOtp: vi.fn(),
}));

vi.mock('../src/modules/auth/auth.service.js', () => authMocks);

type Controller = typeof import('../src/modules/auth/auth.controller.js');
let controller: Controller;

const session = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  user: { id: 'user-1', name: 'Test User' },
};

const requestDouble = ({
  platform,
  origin,
  fetchSite,
  cookie,
  bodyToken,
}: {
  platform?: string;
  origin?: string;
  fetchSite?: string;
  cookie?: string;
  bodyToken?: string;
} = {}) => {
  const headers: Record<string, string | undefined> = {
    'x-client-platform': platform,
    origin,
    'sec-fetch-site': fetchSite,
    'user-agent': 'vitest',
  };
  return {
    body: bodyToken ? { refreshToken: bodyToken } : {},
    cookies: cookie ? { tf_refresh: cookie } : {},
    headers,
    ip: '127.0.0.1',
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
};

const responseDouble = () => {
  const json = vi.fn();
  const cookie = vi.fn();
  const clearCookie = vi.fn();
  const setHeader = vi.fn();
  const send = vi.fn();
  const status = vi.fn(() => ({ json, send }));
  return {
    response: { json, cookie, clearCookie, setHeader, status } as unknown as Response,
    json,
    cookie,
    clearCookie,
    setHeader,
    send,
    status,
  };
};

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters';
  controller = await import('../src/modules/auth/auth.controller.js');
});

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.login.mockResolvedValue(session);
  authMocks.refresh.mockResolvedValue(session);
  authMocks.logout.mockResolvedValue(undefined);
});

describe('auth controller web and mobile sessions', () => {
  it('stores the web refresh token only in the configured HttpOnly cookie', async () => {
    const req = requestDouble();
    req.body = { email: 'person@example.com', password: 'password', tenant: 'tenant' };
    const res = responseDouble();

    await controller.login(req, res.response);

    expect(authMocks.login).toHaveBeenCalledWith(req.body, expect.objectContaining({ clientType: 'WEB' }));
    expect(res.cookie).toHaveBeenCalledWith('tf_refresh', session.refreshToken, expect.objectContaining({
      httpOnly: true,
      sameSite: 'lax',
      domain: undefined,
      path: '/api/v1/auth',
    }));
    expect(res.json).toHaveBeenCalledWith({ accessToken: session.accessToken, refreshToken: undefined, user: session.user });
  });

  it('returns the mobile refresh token in JSON without setting a cookie', async () => {
    const req = requestDouble({ platform: 'mobile' });
    req.body = { email: 'person@example.com', password: 'password', tenant: 'tenant' };
    const res = responseDouble();

    await controller.login(req, res.response);

    expect(authMocks.login).toHaveBeenCalledWith(req.body, expect.objectContaining({ clientType: 'MOBILE' }));
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ accessToken: session.accessToken, refreshToken: session.refreshToken, user: session.user });
  });

  it('rejects an untrusted origin before rotating a web cookie token', async () => {
    const req = requestDouble({ cookie: 'cookie-token', origin: 'https://evil.example' });
    const res = responseDouble();

    await expect(controller.refresh(req, res.response)).rejects.toMatchObject({
      status: 403,
      code: 'UNTRUSTED_ORIGIN',
    });
    expect(authMocks.refresh).not.toHaveBeenCalled();
  });

  it('rejects cross-site browser refresh requests', async () => {
    const req = requestDouble({ cookie: 'cookie-token', fetchSite: 'cross-site' });
    const res = responseDouble();

    await expect(controller.refresh(req, res.response)).rejects.toMatchObject({
      status: 403,
      code: 'CSRF_REJECTED',
    });
    expect(authMocks.refresh).not.toHaveBeenCalled();
  });

  it('uses the mobile body token and never a browser cookie', async () => {
    const req = requestDouble({ platform: 'mobile', cookie: 'cookie-token', bodyToken: 'mobile-token' });
    const res = responseDouble();

    await controller.refresh(req, res.response);

    expect(authMocks.refresh).toHaveBeenCalledWith('mobile-token', expect.objectContaining({ clientType: 'MOBILE' }));
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ accessToken: session.accessToken, refreshToken: session.refreshToken, user: session.user });
  });

  it('validates cookie origin before web logout and clears only web cookies', async () => {
    const trustedReq = requestDouble({ cookie: 'cookie-token', origin: 'http://localhost:4002' });
    const trustedRes = responseDouble();

    await controller.logout(trustedReq, trustedRes.response);

    expect(authMocks.logout).toHaveBeenCalledWith('cookie-token');
    expect(trustedRes.clearCookie).toHaveBeenCalledWith('tf_refresh', expect.objectContaining({ sameSite: 'lax' }));
    expect(trustedRes.status).toHaveBeenCalledWith(204);
    expect(trustedRes.send).toHaveBeenCalled();
  });
});

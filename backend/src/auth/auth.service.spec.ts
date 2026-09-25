// jest.fn() properties on cast mock objects trip unbound-method false positives.
/* eslint-disable @typescript-eslint/unbound-method */
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { AccessRequestsService } from '../access-requests/access-requests.service';
import { AuditService } from '../audit/audit.service';
import { User } from '../users/user.entity';

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'a@divami.com',
    name: null,
    role: 'member',
    status: 'active',
    currentRefreshTokenId: null,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('AuthService.handleGoogleLogin', () => {
  const jwtService = {
    sign: jest.fn().mockReturnValue('signed-token'),
  } as unknown as JwtService;
  const configService = {
    getOrThrow: jest.fn().mockReturnValue('secret'),
  } as unknown as ConfigService;
  const auditService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  it('issues tokens for an active whitelisted user', async () => {
    const usersService = {
      findByEmail: jest.fn().mockResolvedValue(buildUser()),
      setCurrentRefreshTokenId: jest.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const accessRequestsService = {
      upsertPending: jest.fn(),
    } as unknown as AccessRequestsService;

    const service = new AuthService(
      usersService,
      accessRequestsService,
      jwtService,
      configService,
      auditService,
    );
    const result = await service.handleGoogleLogin('a@divami.com');

    expect(result.status).toBe('active');
    expect(accessRequestsService.upsertPending).not.toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith({
      userId: 'user-1',
      action: 'login',
    });
  });

  it('creates a pending access request for a non-whitelisted email', async () => {
    const usersService = {
      findByEmail: jest.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const accessRequestsService = {
      upsertPending: jest.fn().mockResolvedValue(undefined),
    } as unknown as AccessRequestsService;

    const service = new AuthService(
      usersService,
      accessRequestsService,
      jwtService,
      configService,
      auditService,
    );
    const result = await service.handleGoogleLogin('nobody@divami.com');

    expect(result.status).toBe('pending');
    expect(accessRequestsService.upsertPending).toHaveBeenCalledWith(
      'nobody@divami.com',
    );
  });

  it('refuses a deactivated user without issuing tokens', async () => {
    const usersService = {
      findByEmail: jest
        .fn()
        .mockResolvedValue(buildUser({ status: 'deactivated' })),
      setCurrentRefreshTokenId: jest.fn(),
    } as unknown as UsersService;
    const accessRequestsService = {
      upsertPending: jest.fn(),
    } as unknown as AccessRequestsService;

    const service = new AuthService(
      usersService,
      accessRequestsService,
      jwtService,
      configService,
      auditService,
    );
    const result = await service.handleGoogleLogin('a@divami.com');

    expect(result.status).toBe('deactivated');
    expect(usersService.setCurrentRefreshTokenId).not.toHaveBeenCalled();
  });
});

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { UsersService } from '../users/users.service';
import { AccessRequestsService } from '../access-requests/access-requests.service';
import { AuditService } from '../audit/audit.service';
import { User } from '../users/user.entity';
import {
  AccessTokenPayload,
  RefreshTokenPayload,
} from './jwt-payload.interface';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 24 * 60 * 60;

export type GoogleLoginResult =
  | { status: 'active'; accessToken: string; refreshToken: string }
  | { status: 'pending' }
  | { status: 'deactivated' };

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly accessRequestsService: AccessRequestsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async handleGoogleLogin(email: string): Promise<GoogleLoginResult> {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      await this.accessRequestsService.upsertPending(email);
      return { status: 'pending' };
    }

    if (user.status === 'deactivated') {
      return { status: 'deactivated' };
    }

    const { accessToken, refreshToken } = await this.issueTokens(user);
    await this.audit.record({ userId: user.id, action: 'login' });
    return { status: 'active', accessToken, refreshToken };
  }

  async refreshAccessToken(refreshToken: string): Promise<string> {
    let payload: RefreshTokenPayload;
    try {
      payload = this.jwtService.verify<RefreshTokenPayload>(refreshToken, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException();
    }

    const user = await this.usersService.findById(payload.sub);
    if (
      !user ||
      user.status !== 'active' ||
      user.currentRefreshTokenId !== payload.sid
    ) {
      // Mismatch means a newer login elsewhere invalidated this session (single-session
      // enforcement, CLAUDE.md #9), the user was deactivated, or the token was forged.
      throw new UnauthorizedException();
    }

    await this.audit.record({ userId: user.id, action: 'refresh' });
    return this.signAccessToken(user);
  }

  async logout(userId: string): Promise<void> {
    await this.usersService.setCurrentRefreshTokenId(userId, null);
    await this.audit.record({ userId, action: 'logout' });
  }

  private async issueTokens(
    user: User,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const sessionId = randomUUID();
    await this.usersService.setCurrentRefreshTokenId(user.id, sessionId);

    const accessToken = this.signAccessToken(user);
    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      sid: sessionId,
    };
    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: REFRESH_TOKEN_TTL_SECONDS,
    });

    return { accessToken, refreshToken };
  }

  private signAccessToken(user: User): string {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
  }
}

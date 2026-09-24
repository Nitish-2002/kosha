import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { primaryFrontendUrl } from '../config/frontend-url';
import { AuthService } from './auth.service';
import { setAccessCookie, setAuthCookies, clearAuthCookies } from './cookies';
import { GoogleProfile } from './strategies/google.strategy';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(AuthGuard('google'))
  @Get('google')
  googleLogin(): void {
    // Passport's GoogleStrategy intercepts this and redirects to Google's
    // consent screen — no handler body needed.
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(AuthGuard('google'))
  @Get('google/callback')
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const frontendUrl = primaryFrontendUrl(this.configService);
    const profile = req.user as unknown as GoogleProfile;

    const result = await this.authService.handleGoogleLogin(profile.email);

    if (result.status === 'active') {
      setAuthCookies(res, result.accessToken, result.refreshToken);
      res.redirect(frontendUrl);
      return;
    }

    if (result.status === 'pending') {
      res.redirect(`${frontendUrl}/pending-approval`);
      return;
    }

    res.redirect(`${frontendUrl}/login?error=1`);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('refresh')
  async refresh(@Req() req: Request, @Res() res: Response): Promise<void> {
    const refreshToken = req.cookies?.refresh_token as string | undefined;
    if (!refreshToken) {
      throw new UnauthorizedException();
    }
    const accessToken = await this.authService.refreshAccessToken(refreshToken);
    setAccessCookie(res, accessToken);
    res.status(204).send();
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (req.user) {
      await this.authService.logout(req.user.id);
    }
    clearAuthCookies(res);
    res.status(204).send();
  }

  @Get('me')
  me(@Req() req: Request) {
    return req.user;
  }
}

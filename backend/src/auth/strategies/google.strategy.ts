import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import {
  Strategy,
  StrategyOptions,
  VerifyCallback,
  Profile,
} from 'passport-google-oauth20';

export interface GoogleProfile {
  email: string;
  name: string | null;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    const options: StrategyOptions = {
      clientID: config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      clientSecret: config.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: config.getOrThrow<string>('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
    };
    super(options);
  }

  // Without this, Google skips the account chooser and silently reuses
  // whichever Google account is already active in the browser — so a user
  // with multiple Google accounts can never pick a different one to sign
  // into Kosha with. Forcing 'select_account' shows the picker every time.
  authorizationParams(): { prompt: string } {
    return { prompt: 'select_account' };
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      done(new Error('Google profile has no email'), undefined);
      return;
    }
    const profileResult: GoogleProfile = {
      email,
      name: profile.displayName ?? null,
    };
    // Not a real Express.User yet — id/role only exist once AuthService looks up
    // or creates the account. The controller reads this back as GoogleProfile.
    done(null, profileResult as unknown as Express.User);
  }
}

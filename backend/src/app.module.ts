import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { buildDatabaseConfig } from './config/database.config';
import { validateEnv } from './config/validate-env';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AccessRequestsModule } from './access-requests/access-requests.module';
import { AuditModule } from './audit/audit.module';
import { CredentialsModule } from './credentials/credentials.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ProjectsModule } from './projects/projects.module';
import { EnvironmentsModule } from './environments/environments.module';
import { VariablesModule } from './variables/variables.module';
import { ProjectAssignmentsModule } from './project-assignments/project-assignments.module';
import { RequestsModule } from './requests/requests.module';
import { RequestReviewsModule } from './request-reviews/request-reviews.module';
import { DiffModule } from './diff/diff.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Applies to every route, including @Public() ones (it doesn't know about
    // that decorator — nor should it: rate limiting must cover unauthenticated
    // traffic too). Per-route overrides via @Throttle() on the sensitive auth
    // endpoints carry the real brute-force protection; this is a generous
    // backstop for everything else, tracked per source IP (see
    // JwtAuthGuard's ordering below for why it can't be keyed per-user
    // instead). At 100/60s a single internal user's SPA session — several
    // list calls per page, multiple pages a minute — could trip it on its
    // own, and hundreds of employees behind one corporate NAT gateway would
    // all share that one IP's budget. 1000/60s still catches a single
    // runaway/abusive client while giving real concurrent usage headroom;
    // configurable since the right number depends on traffic Kosha hasn't
    // seen in production yet.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        { ttl: 60_000, limit: config.get<number>('THROTTLE_LIMIT') ?? 1000 },
      ],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: buildDatabaseConfig,
    }),
    JwtModule.register({}),
    AuthModule,
    UsersModule,
    AccessRequestsModule,
    AuditModule,
    CredentialsModule,
    NotificationsModule,
    ProjectsModule,
    EnvironmentsModule,
    VariablesModule,
    ProjectAssignmentsModule,
    RequestsModule,
    RequestReviewsModule,
    DiffModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Express 5 / path-to-regexp v7 dropped bare '*' wildcards in favour of named ones.
    consumer.apply(RequestLoggerMiddleware).forRoutes('*path');
  }
}

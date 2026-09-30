import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.use(cookieParser());
  // Express's 100 kB default is too small for a long DB script's SQL
  // (PRD Feature 12; MAX_SQL_LENGTH in create-db-script.dto.ts).
  app.useBodyParser('json', { limit: '2mb' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Comma-separated so more than one dev port works at once (Vite falls
  // back to 5174/5175/etc. whenever 5173 is already taken by something else).
  app.enableCors({
    origin: config.getOrThrow<string>('FRONTEND_URL').split(','),
    credentials: true,
  });

  await app.listen(config.get<string>('PORT') ?? 3000);
}
void bootstrap();

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { AccessRequest } from './access-request.entity';
import { AccessRequestsController } from './access-requests.controller';
import { AccessRequestsService } from './access-requests.service';
import { AccessRequestsRepository } from './access-requests.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([AccessRequest]),
    UsersModule,
    NotificationsModule,
    AuditModule,
  ],
  controllers: [AccessRequestsController],
  providers: [AccessRequestsService, AccessRequestsRepository],
  exports: [AccessRequestsService],
})
export class AccessRequestsModule {}

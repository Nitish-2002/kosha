import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { GoogleChatService } from './google-chat.service';
import { NotificationsRepository } from './notifications.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Notification])],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsRepository, GoogleChatService],
  exports: [NotificationsService, GoogleChatService],
})
export class NotificationsModule {}

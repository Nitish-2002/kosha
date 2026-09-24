import { Injectable } from '@nestjs/common';
import { Notification, NotificationType } from './notification.entity';
import { NotificationsRepository } from './notifications.repository';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly notificationsRepository: NotificationsRepository,
  ) {}

  async createForUsers(
    recipientIds: string[],
    type: NotificationType,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    if (recipientIds.length === 0) {
      return;
    }
    await this.notificationsRepository.saveForRecipients(
      recipientIds,
      type,
      payload ?? null,
    );
  }

  listForUser(userId: string): Promise<Notification[]> {
    return this.notificationsRepository.findForUser(userId);
  }

  markRead(id: string, userId: string): Promise<void> {
    return this.notificationsRepository.markRead(id, userId);
  }

  markAllRead(userId: string): Promise<void> {
    return this.notificationsRepository.markAllReadForUser(userId);
  }
}

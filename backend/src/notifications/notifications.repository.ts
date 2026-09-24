import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Notification, NotificationType } from './notification.entity';

@Injectable()
export class NotificationsRepository {
  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
  ) {}

  saveForRecipients(
    recipientIds: string[],
    type: NotificationType,
    payload: Record<string, unknown> | null,
  ): Promise<Notification[]> {
    return this.repo.save(
      recipientIds.map((recipientId) =>
        this.repo.create({ recipientId, type, payload }),
      ),
    );
  }

  findForUser(userId: string): Promise<Notification[]> {
    return this.repo.find({
      where: { recipientId: userId },
      order: { createdAt: 'DESC' },
    });
  }

  markRead(id: string, userId: string): Promise<void> {
    return this.repo
      .update({ id, recipientId: userId }, { readAt: new Date() })
      .then(() => undefined);
  }

  markAllReadForUser(userId: string): Promise<void> {
    return this.repo
      .update({ recipientId: userId, readAt: IsNull() }, { readAt: new Date() })
      .then(() => undefined);
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GoogleChatService } from '../notifications/google-chat.service';
import { primaryFrontendUrl } from '../config/frontend-url';
import { UsersService } from '../users/users.service';
import type { UserRole } from '../users/user.entity';
import { AccessRequest } from './access-request.entity';
import { AccessRequestsRepository } from './access-requests.repository';

@Injectable()
export class AccessRequestsService {
  constructor(
    private readonly accessRequestsRepository: AccessRequestsRepository,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
    private readonly chat: GoogleChatService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async upsertPending(email: string): Promise<AccessRequest> {
    const existing = await this.accessRequestsRepository.findByEmail(email);
    // Only notify on an actual transition into 'pending' — otherwise someone
    // retrying a sign-in while already pending re-spams the Admin every time.
    const alreadyPending = existing?.status === 'pending';

    const saved = existing
      ? await this.accessRequestsRepository.save({
          ...existing,
          status: 'pending',
        })
      : await this.accessRequestsRepository.save(
          this.accessRequestsRepository.create(email),
        );

    if (!alreadyPending) {
      // No users row exists yet, so userId is null; the Google-verified
      // email is the only identity there is.
      await this.audit.record({
        userId: null,
        action: 'request',
        metadata: { accessRequestId: saved.id, requestedEmail: email },
      });
      const admins = await this.users.findAdmins();
      await this.notifications.createForUsers(
        admins.map((admin) => admin.id),
        'access_request_created',
        { email, accessRequestId: saved.id },
      );
      const url = `${primaryFrontendUrl(this.config)}/access-requests`;
      await this.chat.notify(
        `New Kosha access request from ${email}. Review: ${url}`,
      );
    }

    return saved;
  }

  listPending(): Promise<AccessRequest[]> {
    return this.accessRequestsRepository.findPending();
  }

  async approve(id: string, role: UserRole, reviewerId: string): Promise<void> {
    const request = await this.findOrFail(id);
    const user = await this.users.create({ email: request.email, role });

    request.status = 'approved';
    request.reviewedBy = reviewerId;
    request.reviewedAt = new Date();
    await this.accessRequestsRepository.save(request);

    await this.audit.record({
      userId: reviewerId,
      action: 'create',
      metadata: {
        accessRequestId: id,
        approvedEmail: request.email,
        role,
        userId: user.id,
      },
    });
  }

  async reject(id: string, reviewerId: string): Promise<void> {
    const request = await this.findOrFail(id);

    request.status = 'rejected';
    request.reviewedBy = reviewerId;
    request.reviewedAt = new Date();
    await this.accessRequestsRepository.save(request);

    await this.audit.record({
      userId: reviewerId,
      action: 'update',
      metadata: { accessRequestId: id, rejectedEmail: request.email },
    });
  }

  private async findOrFail(id: string): Promise<AccessRequest> {
    const found = await this.accessRequestsRepository.findById(id);
    if (!found) {
      throw new NotFoundException();
    }
    return found;
  }
}

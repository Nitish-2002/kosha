import { Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@Req() req: Request) {
    return this.notificationsService.listForUser(req.user!.id);
  }

  @Post(':id/read')
  read(@Param('id') id: string, @Req() req: Request) {
    return this.notificationsService.markRead(id, req.user!.id);
  }

  @Post('read-all')
  readAll(@Req() req: Request) {
    return this.notificationsService.markAllRead(req.user!.id);
  }
}

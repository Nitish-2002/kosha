import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { RolesGuard } from '../common/guards/roles.guard';
import { RequestsService } from './requests.service';

// Any signed-in user — a Member sees their own request history/status
// (PRD — Members/users management), an Admin sees theirs the same way. The
// separate, admin-only pending queue and approve/reject live in
// RequestReviewsController.
@Controller('requests')
@UseGuards(RolesGuard)
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Get('mine')
  mine(@Req() req: Request) {
    return this.requestsService.listMine(req.user!.id);
  }
}

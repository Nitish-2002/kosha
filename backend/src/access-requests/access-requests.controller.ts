import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AccessRequestsService } from './access-requests.service';
import { ApproveAccessRequestDto } from './dto/approve-access-request.dto';

@Controller('access-requests')
@Roles('admin')
@UseGuards(RolesGuard)
export class AccessRequestsController {
  constructor(private readonly accessRequestsService: AccessRequestsService) {}

  @Get()
  listPending() {
    return this.accessRequestsService.listPending();
  }

  @Post(':id/approve')
  approve(
    @Param('id') id: string,
    @Body() dto: ApproveAccessRequestDto,
    @Req() req: Request,
  ) {
    return this.accessRequestsService.approve(id, dto.role, req.user!.id);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Req() req: Request) {
    return this.accessRequestsService.reject(id, req.user!.id);
  }
}

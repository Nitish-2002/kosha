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
import { RequestReviewsService } from './request-reviews.service';
import { ReviewRequestDto } from './dto/review-request.dto';

@Controller('requests')
@Roles('admin')
@UseGuards(RolesGuard)
export class RequestReviewsController {
  constructor(private readonly requestReviewsService: RequestReviewsService) {}

  @Get()
  listPending() {
    return this.requestReviewsService.listPending();
  }

  @Post(':id/approve')
  approve(
    @Param('id') id: string,
    @Body() dto: ReviewRequestDto,
    @Req() req: Request,
  ) {
    return this.requestReviewsService.approve(id, req.user!.id, dto.note);
  }

  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: ReviewRequestDto,
    @Req() req: Request,
  ) {
    return this.requestReviewsService.reject(id, req.user!.id, dto.note);
  }
}

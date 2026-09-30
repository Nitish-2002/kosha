import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { DbScriptsService } from './db-scripts.service';
import { PreviewRefreshDto, RecordRefreshDto } from './dto/refresh.dto';

// "Record DB refresh" is Admin-only (PRD Feature 12): it resets a whole
// environment's script states at once.
@Controller('projects/:projectId/db-refreshes')
@Roles('admin')
@UseGuards(RolesGuard)
export class DbRefreshesController {
  constructor(private readonly dbScriptsService: DbScriptsService) {}

  // A read, sent as POST only to carry the two environment ids.
  @Post('preview')
  @HttpCode(200)
  preview(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: PreviewRefreshDto,
  ) {
    return this.dbScriptsService.previewRefresh(projectId, dto);
  }

  @Post()
  record(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: RecordRefreshDto,
    @Req() req: Request,
  ) {
    return this.dbScriptsService.recordRefresh(projectId, dto, req.user!.id);
  }
}

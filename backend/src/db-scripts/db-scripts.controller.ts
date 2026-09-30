import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DbScriptsService } from './db-scripts.service';
import { CreateDbScriptDto } from './dto/create-db-script.dto';
import { UnapplyDbScriptDto } from './dto/unapply-db-script.dto';
import { UpdateDbScriptDto } from './dto/update-db-script.dto';

// Open to both roles (PRD Feature 12) — DbScriptsService scopes a Member to
// their assigned project and environments.
@Controller('projects/:projectId/db-scripts')
export class DbScriptsController {
  constructor(private readonly dbScriptsService: DbScriptsService) {}

  @Get()
  list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() req: Request,
  ) {
    return this.dbScriptsService.list(projectId, req.user!);
  }

  @Post()
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateDbScriptDto,
    @Req() req: Request,
  ) {
    return this.dbScriptsService.create(projectId, dto, req.user!);
  }

  @Patch(':scriptId')
  update(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('scriptId', ParseUUIDPipe) scriptId: string,
    @Body() dto: UpdateDbScriptDto,
    @Req() req: Request,
  ) {
    return this.dbScriptsService.update(projectId, scriptId, dto, req.user!);
  }

  @Post(':scriptId/environments/:environmentId/apply')
  markApplied(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('scriptId', ParseUUIDPipe) scriptId: string,
    @Param('environmentId', ParseUUIDPipe) environmentId: string,
    @Req() req: Request,
  ) {
    return this.dbScriptsService.markApplied(
      projectId,
      scriptId,
      environmentId,
      req.user!,
    );
  }

  // Admin: 200, set back to pending. Member: 202, an undo request is filed.
  @Post(':scriptId/environments/:environmentId/unapply')
  async unapply(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('scriptId', ParseUUIDPipe) scriptId: string,
    @Param('environmentId', ParseUUIDPipe) environmentId: string,
    @Body() dto: UnapplyDbScriptDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.dbScriptsService.unapplyOrRequest(
      projectId,
      scriptId,
      environmentId,
      dto.reason,
      req.user!,
    );
    res.status(result.status === 'requested' ? 202 : 200);
    return result;
  }
}

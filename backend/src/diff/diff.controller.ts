import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { RolesGuard } from '../common/guards/roles.guard';
import { DiffService } from './diff.service';
import { DiffQueryDto } from './dto/diff-query.dto';
import { AddToEnvironmentDto } from './dto/add-to-environment.dto';

// Open to both roles — DiffService.diff()/addToEnvironment() delegate to
// VariablesService.list()/create(), which already scope to the requester's
// ProjectAssignments and mask Secrets, same as everywhere else in Variables.
@Controller('diff')
@UseGuards(RolesGuard)
export class DiffController {
  constructor(private readonly diffService: DiffService) {}

  @Get()
  diff(@Query() query: DiffQueryDto, @Req() req: Request) {
    return this.diffService.diff(
      query.fromConfigId,
      query.toConfigId,
      req.user!,
    );
  }

  @Post('add-to-environment')
  addToEnvironment(@Body() dto: AddToEnvironmentDto, @Req() req: Request) {
    return this.diffService.addToEnvironment(
      dto.fromConfigId,
      dto.toConfigId,
      dto.key,
      req.user!,
    );
  }
}

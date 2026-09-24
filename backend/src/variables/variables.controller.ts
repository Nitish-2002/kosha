import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { VariablesService } from './variables.service';
import { CreateVariableDto } from './dto/create-variable.dto';
import { UpdateVariableDto } from './dto/update-variable.dto';
import { UpdateSecretFlagDto } from './dto/update-secret-flag.dto';
import { RollbackDto } from './dto/rollback.dto';
import { ImportEnvDto } from './dto/import-env.dto';

// list/create/update/history/import are open to both roles — VariablesService
// scopes a Member to their ProjectAssignments and masks Secret values
// server-side (same pattern as everywhere else). Flagging a key Secret and
// revealing stay Admin-only outright (CLAUDE.md #8, PRD Feature 2). Deleting
// and rolling back are open to both too, but the role check lives inside
// VariablesService.removeOrRequest/rollbackOrRequest (CLAUDE.md #3/TRD — one
// endpoint per destructive action, decision made in the service, not here).
@Controller('environments/:environmentId/components/:configId')
@UseGuards(RolesGuard)
export class VariablesController {
  constructor(private readonly variablesService: VariablesService) {}

  @Get('variables')
  list(
    @Param('environmentId') environmentId: string,
    @Param('configId') configId: string,
    @Req() req: Request,
  ) {
    return this.variablesService.list(environmentId, configId, req.user!);
  }

  @Post('variables')
  create(
    @Param('environmentId') environmentId: string,
    @Param('configId') configId: string,
    @Body() dto: CreateVariableDto,
    @Req() req: Request,
  ) {
    return this.variablesService.create(
      environmentId,
      configId,
      dto,
      req.user!,
    );
  }

  @Patch('variables/:key')
  update(
    @Param('environmentId') environmentId: string,
    @Param('configId') configId: string,
    @Param('key') key: string,
    @Body() dto: UpdateVariableDto,
    @Req() req: Request,
  ) {
    return this.variablesService.update(
      environmentId,
      configId,
      key,
      dto,
      req.user!,
    );
  }

  @Patch('variables/:key/secret-flag')
  @Roles('admin')
  updateSecretFlag(
    @Param('environmentId') environmentId: string,
    @Param('configId') configId: string,
    @Param('key') key: string,
    @Body() dto: UpdateSecretFlagDto,
    @Req() req: Request,
  ) {
    return this.variablesService.updateSecretFlag(
      environmentId,
      configId,
      key,
      dto.isSecret,
      req.user!.id,
    );
  }

  @Delete('variables/:key')
  async remove(
    @Param('environmentId') environmentId: string,
    @Param('configId') configId: string,
    @Param('key') key: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.variablesService.removeOrRequest(
      environmentId,
      configId,
      key,
      req.user!,
    );
    if (result.status === 'requested') res.status(202);
    return result;
  }

  @Get('variables/:key/history')
  history(
    @Param('environmentId') environmentId: string,
    @Param('configId') configId: string,
    @Param('key') key: string,
    @Req() req: Request,
  ) {
    return this.variablesService.history(
      environmentId,
      configId,
      key,
      req.user!,
    );
  }

  @Post('variables/:key/reveal')
  @Roles('admin')
  reveal(
    @Param('environmentId') environmentId: string,
    @Param('configId') configId: string,
    @Param('key') key: string,
    @Req() req: Request,
  ) {
    return this.variablesService
      .reveal(environmentId, configId, key, req.user!.id)
      .then((value) => ({ value }));
  }

  @Post('rollback')
  async rollback(
    @Param('environmentId') environmentId: string,
    @Param('configId') configId: string,
    @Body() dto: RollbackDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.variablesService.rollbackOrRequest(
      environmentId,
      configId,
      dto,
      req.user!,
    );
    if (result.status === 'requested') res.status(202);
    return result;
  }

  @Post('import/preview')
  importPreview(
    @Param('environmentId') environmentId: string,
    @Param('configId') configId: string,
    @Body() dto: ImportEnvDto,
    @Req() req: Request,
  ) {
    return this.variablesService.importPreview(
      environmentId,
      configId,
      dto.envText,
      req.user!,
    );
  }

  @Post('import/commit')
  importCommit(
    @Param('environmentId') environmentId: string,
    @Param('configId') configId: string,
    @Body() dto: ImportEnvDto,
    @Req() req: Request,
  ) {
    return this.variablesService.importCommit(
      environmentId,
      configId,
      dto.envText,
      req.user!,
    );
  }
}

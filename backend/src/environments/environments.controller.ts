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
import { EnvironmentsService } from './environments.service';
import { CreateEnvironmentDto } from './dto/create-environment.dto';
import { CreateComponentConfigDto } from './dto/create-component-config.dto';
import { UpdateComponentConfigDto } from './dto/update-component-config.dto';
import { TestConnectionDto } from './dto/test-connection.dto';
import { GithubBulkPreviewDto } from './dto/github-bulk-preview.dto';

// Read routes are open to both roles — EnvironmentsService scopes a
// Member's result to their ProjectAssignments internally. Creating/editing
// an environment or a component connection stays Admin-only (PRD Feature 1).
// Deleting an environment or a component connection is open to both, but the
// role check lives inside EnvironmentsService.removeOrRequest/
// removeComponentOrRequest (CLAUDE.md #3/TRD — one endpoint per destructive
// action, decision made in the service, not here).
@Controller()
@UseGuards(RolesGuard)
export class EnvironmentsController {
  constructor(private readonly environmentsService: EnvironmentsService) {}

  @Get('projects/:projectId/environments')
  listForProject(@Param('projectId') projectId: string, @Req() req: Request) {
    return this.environmentsService.listByProject(projectId, req.user!);
  }

  @Post('projects/:projectId/environments')
  @Roles('admin')
  create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateEnvironmentDto,
    @Req() req: Request,
  ) {
    return this.environmentsService.create(projectId, dto, req.user!.id);
  }

  @Get('environments/:id')
  get(@Param('id') id: string, @Req() req: Request) {
    return this.environmentsService.findOne(id, req.user!);
  }

  // Not nested under an environment/config id — this never persists
  // anything, it just checks whether the entered credential can reach the
  // given bucket/repo+branch, independent of which environment it'll end
  // up wired to.
  @Post('environments/test-connection')
  @Roles('admin')
  testConnection(@Body() dto: TestConnectionDto) {
    return this.environmentsService.testConnection(dto);
  }

  @Delete('environments/:id')
  async remove(
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.environmentsService.removeOrRequest(
      id,
      req.user!,
    );
    if (result.status === 'requested') res.status(202);
    return result;
  }

  @Get('environments/:id/components')
  listComponents(@Param('id') id: string, @Req() req: Request) {
    return this.environmentsService.listComponentConfigs(id, req.user!);
  }

  @Post('environments/:id/components')
  @Roles('admin')
  addComponent(
    @Param('id') id: string,
    @Body() dto: CreateComponentConfigDto,
    @Req() req: Request,
  ) {
    return this.environmentsService.addComponentConfig(id, dto, req.user!.id);
  }

  @Post('environments/:id/components/github-bulk/preview')
  @Roles('admin')
  previewGithubBulk(
    @Param('id') id: string,
    @Body() dto: GithubBulkPreviewDto,
  ) {
    return this.environmentsService.previewGithubBulk(id, dto);
  }

  @Patch('environments/:id/components/:configId')
  @Roles('admin')
  updateComponent(
    @Param('id') id: string,
    @Param('configId') configId: string,
    @Body() dto: UpdateComponentConfigDto,
    @Req() req: Request,
  ) {
    return this.environmentsService.updateComponentConfig(
      id,
      configId,
      dto,
      req.user!.id,
    );
  }

  @Delete('environments/:id/components/:configId')
  async removeComponent(
    @Param('id') id: string,
    @Param('configId') configId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.environmentsService.removeComponentOrRequest(
      id,
      configId,
      req.user!,
    );
    if (result.status === 'requested') res.status(202);
    return result;
  }
}

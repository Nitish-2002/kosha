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
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { CreateComponentDto } from './dto/create-component.dto';

// Read routes are open to both roles — ProjectsService scopes a Member's
// result to their ProjectAssignments internally, same pattern as
// VariablesService's role-aware masking. Every mutation except delete
// (including the component list, which only an Admin edits — PRD Feature 1)
// stays Admin-only via @Roles. Deleting a project is open to both, but the
// role check lives inside ProjectsService.removeOrRequest (CLAUDE.md #3/TRD
// — one endpoint per destructive action, decision made in the service).
@Controller('projects')
@UseGuards(RolesGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  list(@Req() req: Request) {
    return this.projectsService.findAll(req.user!);
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: Request) {
    return this.projectsService.findOne(id, req.user!);
  }

  @Post()
  @Roles('admin')
  create(@Body() dto: CreateProjectDto, @Req() req: Request) {
    return this.projectsService.create(dto, req.user!.id);
  }

  @Patch(':id')
  @Roles('admin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @Req() req: Request,
  ) {
    return this.projectsService.update(id, dto, req.user!.id);
  }

  @Post(':id/archive')
  @Roles('admin')
  archive(@Param('id') id: string, @Req() req: Request) {
    return this.projectsService.archive(id, req.user!.id);
  }

  @Post(':id/unarchive')
  @Roles('admin')
  unarchive(@Param('id') id: string, @Req() req: Request) {
    return this.projectsService.unarchive(id, req.user!.id);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.projectsService.removeOrRequest(id, req.user!);
    if (result.status === 'requested') res.status(202);
    return result;
  }

  @Post(':id/components')
  @Roles('admin')
  addComponent(
    @Param('id') id: string,
    @Body() dto: CreateComponentDto,
    @Req() req: Request,
  ) {
    return this.projectsService.addComponent(id, dto, req.user!.id);
  }

  @Delete(':id/components/:componentId')
  @Roles('admin')
  removeComponent(
    @Param('id') id: string,
    @Param('componentId') componentId: string,
    @Req() req: Request,
  ) {
    return this.projectsService.removeComponent(id, componentId, req.user!.id);
  }
}

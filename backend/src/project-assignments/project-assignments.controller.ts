import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ProjectAssignmentsService } from './project-assignments.service';
import { CreateAssignmentDto } from './dto/create-assignment.dto';

// Admin-only end to end — assigning a Member their scope is itself an
// Admin action (PRD #10), same as every other Members-tab operation.
@Controller()
@Roles('admin')
@UseGuards(RolesGuard)
export class ProjectAssignmentsController {
  constructor(private readonly assignmentsService: ProjectAssignmentsService) {}

  @Get('users/:userId/assignments')
  listForUser(@Param('userId') userId: string) {
    return this.assignmentsService.listForUser(userId);
  }

  @Get('projects/:projectId/assignments')
  listForProject(@Param('projectId') projectId: string) {
    return this.assignmentsService.listForProject(projectId);
  }

  @Post('users/:userId/assignments')
  create(
    @Param('userId') userId: string,
    @Body() dto: CreateAssignmentDto,
    @Req() req: Request,
  ) {
    return this.assignmentsService.create(userId, dto, req.user!.id);
  }

  @Delete('assignments/:id')
  remove(@Param('id') id: string, @Req() req: Request) {
    return this.assignmentsService.remove(id, req.user!.id);
  }
}

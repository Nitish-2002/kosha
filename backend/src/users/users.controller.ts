import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { User } from './user.entity';
import { UsersService } from './users.service';

export interface UserSummary {
  id: string;
  email: string;
  role: User['role'];
  status: User['status'];
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toSummary(user: User): UserSummary {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

@Controller('users')
@Roles('admin')
@UseGuards(RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async list() {
    return (await this.usersService.findAll()).map(toSummary);
  }

  @Patch(':id/role')
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateUserRoleDto,
    @Req() req: Request,
  ) {
    const updated = await this.usersService.updateRole(
      id,
      dto.role,
      req.user!.id,
    );
    return toSummary(updated);
  }

  @Post(':id/deactivate')
  async deactivate(@Param('id') id: string, @Req() req: Request) {
    const updated = await this.usersService.deactivate(id, req.user!.id);
    return toSummary(updated);
  }

  @Post(':id/reactivate')
  async reactivate(@Param('id') id: string, @Req() req: Request) {
    const updated = await this.usersService.reactivate(id, req.user!.id);
    return toSummary(updated);
  }
}

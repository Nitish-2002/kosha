import {
  Body,
  Controller,
  Delete,
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
import { CredentialsService } from './credentials.service';
import { CreateCredentialDto } from './dto/create-credential.dto';
import { UpdateCredentialDto } from './dto/update-credential.dto';

@Controller('credentials')
@Roles('admin')
@UseGuards(RolesGuard)
export class CredentialsController {
  constructor(private readonly credentialsService: CredentialsService) {}

  @Get()
  list() {
    return this.credentialsService.list();
  }

  @Post()
  create(@Body() dto: CreateCredentialDto, @Req() req: Request) {
    return this.credentialsService.create(dto, req.user!.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCredentialDto,
    @Req() req: Request,
  ) {
    return this.credentialsService.update(id, dto, req.user!.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: Request) {
    return this.credentialsService.remove(id, req.user!.id);
  }
}

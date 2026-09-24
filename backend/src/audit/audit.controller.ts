import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuditService } from './audit.service';
import { ListAuditLogDto } from './dto/list-audit-log.dto';

// PRD Feature 7 — Admin-only, filterable by project/user/action/date range,
// paginated. Read-only: this never writes anything, `record()` still does.
@Controller('audit-log')
@Roles('admin')
@UseGuards(RolesGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  list(@Query() query: ListAuditLogDto) {
    return this.auditService.list(query);
  }
}

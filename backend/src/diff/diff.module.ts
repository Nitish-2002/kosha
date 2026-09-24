import { Module } from '@nestjs/common';
import { EnvironmentsModule } from '../environments/environments.module';
import { VariablesModule } from '../variables/variables.module';
import { DiffController } from './diff.controller';
import { DiffService } from './diff.service';

// A standalone top-level feature — nothing needs to import DiffModule back,
// so it can depend on EnvironmentsModule/VariablesModule directly with no
// cycle risk (unlike RequestsModule, which had to stay a leaf).
@Module({
  imports: [EnvironmentsModule, VariablesModule],
  controllers: [DiffController],
  providers: [DiffService],
})
export class DiffModule {}

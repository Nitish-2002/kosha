import { Module } from '@nestjs/common';
import { RequestsModule } from '../requests/requests.module';
import { ProjectsModule } from '../projects/projects.module';
import { EnvironmentsModule } from '../environments/environments.module';
import { VariablesModule } from '../variables/variables.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RequestReviewsController } from './request-reviews.controller';
import { RequestReviewsService } from './request-reviews.service';

// The "top" of this feature's module graph — imports everything needed to
// actually execute an approved request, which is exactly why this can't be
// the same module as RequestsModule (that one has to stay a leaf so
// Projects/Environments/Variables can import it without a cycle).
@Module({
  imports: [
    RequestsModule,
    ProjectsModule,
    EnvironmentsModule,
    VariablesModule,
    NotificationsModule,
  ],
  controllers: [RequestReviewsController],
  providers: [RequestReviewsService],
})
export class RequestReviewsModule {}

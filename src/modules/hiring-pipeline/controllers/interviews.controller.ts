import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { ValidatedUser } from '../../../types';
import { ApplicationActionDto } from '../dto/application-action.dto';
import {
  AcceptInterviewDto,
  InterviewTimesDto,
  RequestInterviewDto,
} from '../dto/interview.dto';
import { InterviewsService } from '../interviews.service';
import { VideoCallService } from '../video-call.service';

/**
 * Interviews: the request (on an application) and the actions on one interview.
 * Every action answers { message, content: ApplicationDetail } (the detail of the interview's application);
 * `upcoming` answers { message, content: list }.
 * The role guard (@Roles) only lets the right kind of account in; the service then checks the user is
 * this post's owner (or an admin) or this application's applicant, and which side may do the action.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class InterviewsController {
  constructor(
    private readonly interviews: InterviewsService,
    private readonly videoCalls: VideoCallService,
  ) {}

  @Post('applications/:id/interviews')
  @Roles(Role.EMPLOYER, Role.ADMIN)
  request(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RequestInterviewDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.interviews.requestInterview(id, user, dto);
  }

  // Any signed-in user: their own scheduled interviews, as recruiter or candidate.
  @Get('interviews/upcoming')
  upcoming(@CurrentUser() user: ValidatedUser) {
    return this.interviews.upcoming(user);
  }

  @Post('interviews/:id/times')
  @Roles(Role.EMPLOYER, Role.ADMIN)
  proposeTimes(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: InterviewTimesDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.interviews.proposeTimes(id, user, dto.proposedTimes);
  }

  @Post('interviews/:id/accept')
  @Roles(Role.USER)
  accept(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AcceptInterviewDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.interviews.accept(id, user, dto.startsAt);
  }

  @Post('interviews/:id/reschedule')
  @Roles(Role.USER)
  requestReschedule(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApplicationActionDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.interviews.requestReschedule(id, user, dto.note);
  }

  // Either side may cancel; the service finds which side the user is on.
  @Post('interviews/:id/cancel')
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApplicationActionDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.interviews.cancel(id, user, dto.note);
  }

  @Post('interviews/:id/complete')
  @Roles(Role.EMPLOYER, Role.ADMIN)
  complete(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.interviews.complete(id, user);
  }

  // A token to join the video call of a scheduled online interview (only its candidate and recruiter).
  @Post('interviews/:id/call-token')
  callToken(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.videoCalls.callToken(id, user);
  }
}

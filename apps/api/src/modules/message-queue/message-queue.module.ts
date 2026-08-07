import { Global, Module } from '@nestjs/common';
import { MessageQueueService } from './message-queue.service';

@Global()
@Module({
  providers: [MessageQueueService],
  exports: [MessageQueueService],
})
export class MessageQueueModule {}

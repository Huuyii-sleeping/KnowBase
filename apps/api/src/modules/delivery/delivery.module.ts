import { Module } from '@nestjs/common';
import { DeliveryReceiptStore } from './delivery-receipt.store';
import { MessageProcessingService } from './message-processing.service';
import { OutboxStore } from './outbox.store';

@Module({
  providers: [OutboxStore, DeliveryReceiptStore, MessageProcessingService],
  exports: [OutboxStore, MessageProcessingService],
})
export class DeliveryModule {}

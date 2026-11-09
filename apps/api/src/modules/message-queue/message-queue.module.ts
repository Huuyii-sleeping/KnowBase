import { Global, Module } from '@nestjs/common';
import { MessageQueueService } from './message-queue.service';
import { DeliveryModule } from '../delivery/delivery.module';
import { RabbitMqConnectionService } from './rabbitmq-connection.service';
import { RabbitMqTopologyService } from './rabbitmq-topology.service';
import { RabbitMqPublisherService } from './rabbitmq-publisher.service';
import { RabbitMqConsumerService } from './rabbitmq-consumer.service';
import { OutboxRelayService } from './outbox-relay.service';

@Global()
@Module({
  imports: [DeliveryModule],
  providers: [
    MessageQueueService,
    RabbitMqConnectionService,
    RabbitMqTopologyService,
    RabbitMqPublisherService,
    RabbitMqConsumerService,
    OutboxRelayService,
  ],
  exports: [MessageQueueService],
})
export class MessageQueueModule {}

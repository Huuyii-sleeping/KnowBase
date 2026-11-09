export interface OutboxMessage {
  id: string;
  event_id: string;
  routing_key: string;
  body: string;
  attempt: number;
  publish_attempts: number;
  last_error: string | null;
}

export interface DeliveryReceipt {
  status: 'PENDING' | 'COMPLETED' | 'RETRY' | 'DEAD';
  attempt: number;
}

export interface IncomingDelivery {
  eventId: string;
  routingKey: string;
  body: string;
  attempt: number;
}

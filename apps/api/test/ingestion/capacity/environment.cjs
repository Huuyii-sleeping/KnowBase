const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { AcceptanceEnvironment } = require('../acceptance/environment.cjs');
const { httpClient } = require('../acceptance/http.cjs');
class CapacityEnvironment extends AcceptanceEnvironment {
  composeFiles = [
    ...this.composeFiles,
    'docker-compose.ingestion-capacity-test.yml',
  ];
  applicationEntrypoint = path.join(__dirname, 'runtime-app.cjs');
  applicationIpc = true;
  applicationEnvironment = {
    DOCUMENT_PARSER: 'native',
    RABBITMQ_PREFETCH: '1',
    OUTBOX_POLL_INTERVAL_MS: '1000',
    OUTBOX_BATCH_SIZE: '20',
    EMBEDDING_MODEL_REVISION: 'capacity-fixture-v1',
    NODE_OPTIONS: '--max-old-space-size=512',
  };
  pending = new Map();
  async launchApplication() {
    const launching = super.launchApplication();
    this.api.on('message', (message) => {
      this.pending.get(message.requestId)?.(message.result);
    });
    await launching;
  }
  async sample() {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(Error('Capacity IPC timeout'));
      }, 5000);
      this.pending.set(requestId, (result) => {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve(result);
      });
      this.api.send({ command: 'sample', requestId }, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(requestId);
          reject(error);
        }
      });
    });
  }
  async login(role) {
    const auth = await httpClient(this.baseUrl, null, this.events)(
      'POST',
      '/auth/login',
      { username: 'acceptance-' + role, password: this.password },
      201,
    );
    return httpClient(this.baseUrl, auth.accessToken, this.events);
  }
}
module.exports = { CapacityEnvironment };

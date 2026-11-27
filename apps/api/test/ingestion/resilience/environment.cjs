const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  AcceptanceEnvironment,
  eventually,
} = require('../acceptance/environment.cjs');
const { httpClient } = require('../acceptance/http.cjs');
class ResilienceEnvironment extends AcceptanceEnvironment {
  applicationEntrypoint = path.join(__dirname, 'fault-app.cjs');
  applicationIpc = true;
  applicationEnvironment = {
    DOCUMENT_PARSER: 'native',
    INGESTION_TASK_LEASE_MS: '3000',
    PIPELINE_RETRY_DELAY_MS: '200',
    EMBEDDING_MODEL_REVISION: 'resilience-fixture-v1',
  };
  pending = new Map();
  pauses = new Set();
  async launchApplication() {
    const launching = super.launchApplication();
    this.api.on('message', (message) => {
      if (message.event === 'paused') this.pauses.add(message.id);
      if (message.requestId) {
        const request = this.pending.get(message.requestId);
        if (!request) return;
        this.pending.delete(message.requestId);
        message.error
          ? request.reject(Error(message.error))
          : request.resolve(message.result);
      }
    });
    await launching;
  }
  command(command, fields = {}) {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(Error('IPC test command timed out'));
      }, 10000);
      this.pending.set(requestId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.api.send({ requestId, command, ...fields });
    });
  }
  async arm(id, point, action = 'pause', fields = {}) {
    await this.command('arm', { rule: { id, point, action, ...fields } });
  }
  async paused(id) {
    await eventually(() => this.pauses.has(id), 'fault barrier ' + id, 20000);
  }
  async release(id) {
    await this.command('release', { ruleId: id });
  }
  async login(role = 'owner') {
    const login = httpClient(this.baseUrl, null, this.events);
    const auth = await login(
      'POST',
      '/auth/login',
      { username: 'acceptance-' + role, password: this.password },
      201,
    );
    return httpClient(this.baseUrl, auth.accessToken, this.events);
  }
  async task(id) {
    return (
      await this.source.query(
        'SELECT * FROM kh_document_parse_task WHERE document_id=$1 ORDER BY created_at DESC LIMIT 1',
        [id],
      )
    )[0];
  }
  async ready(api, id) {
    let doc;
    await eventually(
      async () => {
        doc = await api('GET', '/documents/' + id);
        return doc.parseStatus === 'READY' && Boolean(doc.content);
      },
      'adopted content ready',
      30000,
    );
    return doc;
  }
  async upload(api, label) {
    const data = new FormData();
    data.set('file', new Blob(['Original ' + label]), label + '.txt');
    data.set('title', label);
    return api('POST', '/documents', data, 201);
  }
}
module.exports = { ResilienceEnvironment, eventually };

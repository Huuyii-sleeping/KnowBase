const { AcceptanceEnvironment } = require('../acceptance/environment.cjs');
const { httpClient } = require('../acceptance/http.cjs');
class ReleaseEnvironment extends AcceptanceEnvironment {
  applicationEnvironment = {
    DOCUMENT_PARSER: 'mineru',
    MINERU_BASE_URL: process.env.MINERU_BASE_URL,
    EMBEDDING_MODEL_REVISION: process.env.QUALITY_EMBEDDING_REVISION,
    OLLAMA_KG_MODEL_REVISION: process.env.QUALITY_KG_REVISION,
    RAG_CHUNK_SIZE: '1000',
    RAG_CHUNK_OVERLAP: '20',
    INDEX_GENERATION_GC_ENABLED: 'false',
  };
  async login(role) {
    const auth = await httpClient(this.baseUrl, null, this.events)(
      'POST',
      '/auth/login',
      { username: 'acceptance-' + role, password: this.password },
      201,
    );
    return httpClient(this.baseUrl, auth.accessToken, this.events);
  }
  async restart(entrypoint, settings = {}) {
    await this.stopApplication();
    this.applicationCommand = [entrypoint];
    Object.assign(this.applicationOptions.env, settings);
    await this.launchApplication();
  }
}
module.exports = { ReleaseEnvironment };

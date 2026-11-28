const assert = require('node:assert/strict');
function httpClient(baseUrl, token, events) {
  return async (method, route, data, expected = 200) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const multipart = data instanceof FormData;
    if (data !== undefined && !multipart)
      headers['Content-Type'] = 'application/json';
    const response = await fetch(baseUrl + '/api/v1' + route, {
      method,
      headers,
      body:
        data === undefined
          ? undefined
          : multipart
            ? data
            : JSON.stringify(data),
      signal: AbortSignal.timeout(30000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const body =
      !route.startsWith('/storage/object?') &&
      response.headers.get('content-type')?.includes('application/json') &&
      bytes.length
        ? JSON.parse(bytes)
        : bytes;
    events.push({
      method,
      route: route.split('?')[0],
      status: response.status,
    });
    assert.equal(
      response.status,
      expected,
      `${method} ${route.split('?')[0]}: ${bytes.toString().slice(0, 500)}`,
    );
    return body;
  };
}
module.exports = { httpClient };

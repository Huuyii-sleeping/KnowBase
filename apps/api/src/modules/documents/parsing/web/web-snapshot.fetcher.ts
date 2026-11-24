import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createHash } from 'node:crypto';
import { publicAddress, webUrl } from './web-url-policy';
export interface WebSnapshot {
  schema: 'web-snapshot-v1';
  requestedUrl: string;
  finalUrl: string;
  capturedAt: string;
  html: string;
  sha256: string;
}
@Injectable()
export class WebSnapshotFetcher {
  async capture(value: string): Promise<WebSnapshot> {
    const requestedUrl = webUrl(value).href;
    let url = webUrl(value);
    for (let redirect = 0; redirect <= 3; redirect++) {
      const addresses = await lookup(url.hostname, {
        all: true,
        verbatim: true,
      });
      if (
        !addresses.length ||
        addresses.some(({ address }) => !publicAddress(address))
      )
        throw new Error('Web address is not public');
      // Pin a previously validated address while preserving the Host header and TLS SNI.
      const address = addresses[0];
      const response = await this.read(url, address);
      if ('redirect' in response) {
        url = webUrl(new URL(response.redirect, url).href);
        continue;
      }
      const html = new TextDecoder('utf-8', { fatal: true }).decode(
        response.body,
      );
      if (!html.trim()) throw new Error('Empty web snapshot');
      return {
        schema: 'web-snapshot-v1',
        requestedUrl,
        finalUrl: url.href,
        capturedAt: new Date().toISOString(),
        html,
        sha256: createHash('sha256').update(html).digest('hex'),
      };
    }
    throw new Error('Web redirect budget exceeded');
  }
  private read(
    url: URL,
    address: { address: string; family: number },
  ): Promise<{ body: Buffer } | { redirect: string }> {
    return new Promise((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
        url,
        {
          method: 'GET',
          signal: AbortSignal.timeout(30000),
          headers: {
            'User-Agent': 'KnowBase-Snapshot/1',
            Accept: 'text/html',
            'Accept-Encoding': 'identity',
          },
          lookup: (_hostname, options, callback) => {
            const selected = {
              address: address.address,
              family: address.family,
            };
            if ((options as { all?: boolean }).all)
              (
                callback as unknown as (
                  error: null,
                  addresses: (typeof selected)[],
                ) => void
              )(null, [selected]);
            else callback(null, address.address, address.family);
          },
        },
        (response) => {
          if (
            [301, 302, 303, 307, 308].includes(response.statusCode ?? 0) &&
            response.headers.location
          ) {
            resolve({ redirect: response.headers.location });
            response.destroy();
            return;
          }
          const type = response.headers['content-type'] ?? '';
          if (
            response.statusCode !== 200 ||
            !/^text\/html(?:;|$)/i.test(type) ||
            /charset=(?!["']?utf-?8\b)/i.test(type) ||
            (response.headers['content-encoding'] &&
              response.headers['content-encoding'] !== 'identity')
          ) {
            reject(
              new Error(
                'Web response must be uncompressed UTF-8 HTML with HTTP 200',
              ),
            );
            response.destroy();
            return;
          }
          const parts: Buffer[] = [];
          let bytes = 0;
          response.on('data', (part: Buffer) => {
            bytes += part.length;
            if (bytes > 5 * 1024 * 1024) {
              reject(new Error('Web snapshot exceeds byte budget'));
              response.destroy();
            } else parts.push(part);
          });
          response.on('error', reject);
          response.on('end', () => resolve({ body: Buffer.concat(parts) }));
        },
      );
      request.on('error', reject);
      request.end();
    });
  }
}

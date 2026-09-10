import { Injectable, signal } from '@angular/core';
import { apiUrl } from './config';

export interface ServerJobHandle {
  promise: Promise<Blob>;
  abort: () => void;
}

/**
 * Sends a file to the backend, which converts it with native ffmpeg and
 * streams back the MP3. The server deletes the upload immediately after
 * converting (nothing is persisted in the cloud).
 */
@Injectable({ providedIn: 'root' })
export class ServerConvertService {
  /** null = unknown/checking, true/false = result of the health probe. */
  readonly available = signal<boolean | null>(null);

  async checkAvailability(): Promise<boolean> {
    try {
      const res = await fetch(apiUrl('api/health'), {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      // Must be our API responding with JSON {ok:true}. On static-only hosting
      // (e.g. Firebase) a SPA rewrite answers /api/health with index.html and
      // HTTP 200 — res.json() then throws and we correctly report no server.
      const data = res.ok ? await res.json() : null;
      const ok = data?.ok === true;
      this.available.set(ok);
      return ok;
    } catch {
      this.available.set(false);
      return false;
    }
  }

  /** Upload progress maps to 0..0.95; the final 0.95..1 covers server-side encoding. */
  convert(file: File, onProgress: (ratio: number) => void): ServerJobHandle {
    const xhr = new XMLHttpRequest();
    const promise = new Promise<Blob>((resolve, reject) => {
      xhr.open('POST', apiUrl('api/convert'));
      xhr.responseType = 'blob';

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress((e.loaded / e.total) * 0.95);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(1);
          resolve(xhr.response as Blob);
        } else {
          reject(new Error(`El servidor respondió ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('No se pudo contactar con el servidor'));
      xhr.onabort = () => reject(new DOMException('Cancelado', 'AbortError'));

      const form = new FormData();
      form.append('file', file, file.name);
      xhr.send(form);
    });

    return { promise, abort: () => xhr.abort() };
  }
}

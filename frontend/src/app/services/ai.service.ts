import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface StatusResponse {
  ollama: boolean;
  stableDiffusion: boolean;
  video: boolean;
  model: string;
}

export interface ImageRequest {
  prompt: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg_scale?: number;
  seed?: number;
}

export interface VideoRequest {
  prompt: string;
  num_frames?: number;
  fps?: number;
  width?: number;
  height?: number;
}

@Injectable({ providedIn: 'root' })
export class AiService {
  // nginx injects window.__API_URL__ via config.js; locally falls back to localhost:3000
  private base: string = (() => {
    const v = (window as any).__API_URL__;
    if (v && v !== '') return v;
    if (window.location.hostname === 'localhost') return 'http://localhost:3000';
    return '';
  })();

  constructor(private http: HttpClient) {}

  getStatus(): Observable<StatusResponse> {
    return this.http.get<StatusResponse>(`${this.base}/api/status`);
  }

  getImageStatus(): Observable<{ state: string; progress: number; message: string }> {
    return this.http.get<any>(`${this.base}/api/image/status`);
  }

  getVideoStatus(): Observable<{ state: string; progress: number; message: string }> {
    return this.http.get<any>(`${this.base}/api/video/status`);
  }

  getModels(): Observable<{ models: { name: string }[] }> {
    return this.http.get<any>(`${this.base}/api/models`);
  }

  // Returns an EventSource for streaming chat responses.
  streamChat(messages: ChatMessage[], model: string): EventSource {
    // We POST via fetch then read SSE — EventSource only supports GET,
    // so we use a small workaround: open an EventSource after a POST.
    // The cleanest approach for POST+SSE is fetch with ReadableStream.
    throw new Error('Use streamChatFetch instead');
  }

  // Fetch-based streaming: returns an async generator of tokens.
  async *streamChatFetch(
    messages: ChatMessage[],
    model: string
  ): AsyncGenerator<{ token?: string; done?: boolean; error?: string }> {
    const resp = await fetch(`${this.base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, model }),
    });

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            yield JSON.parse(line.slice(6));
          } catch { /* skip malformed */ }
        }
      }
    }
  }

  generateImage(req: ImageRequest): Observable<{ success: boolean; url: string; filename: string; error?: string }> {
    return this.http.post<any>(`${this.base}/api/image`, req);
  }

  generateVideo(req: VideoRequest): Observable<{ success: boolean; url: string; filename: string; error?: string }> {
    return this.http.post<any>(`${this.base}/api/video`, req);
  }

  saveChat(messages: ChatMessage[]): Observable<{ success: boolean; filename: string }> {
    return this.http.post<any>(`${this.base}/api/chat/save`, { messages });
  }
}

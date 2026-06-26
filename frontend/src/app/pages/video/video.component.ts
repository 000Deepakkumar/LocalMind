import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AiService } from '../../services/ai.service';
import { ICONS } from '../../shared/icons';
import { SafeHtmlPipe } from '../../shared/safe-html.pipe';

interface GeneratedVideo {
  url: string;
  prompt: string;
  timestamp: string;
}

@Component({
  selector: 'app-video',
  standalone: true,
  imports: [CommonModule, FormsModule, SafeHtmlPipe],
  template: `
    <div class="page-shell">

      <div class="page-header">
        <div>
          <div class="page-title">Video Generation</div>
          <div class="text-dim text-sm">Generate short videos using ModelScope locally</div>
        </div>
      </div>

      <div class="page-body">

        <div class="controls card">
          <div class="field">
            <label>Prompt</label>
            <textarea class="textarea" [(ngModel)]="prompt" rows="3"
              placeholder="A red balloon floating over a green meadow on a sunny day..."
              [disabled]="modelState !== 'ready'">
            </textarea>
          </div>

          <div class="row-fields">
            <div class="field">
              <label>Frames</label>
              <input class="input" type="number" [(ngModel)]="numFrames" min="8" max="25" />
            </div>
            <div class="field">
              <label>FPS</label>
              <input class="input" type="number" [(ngModel)]="fps" min="4" max="24" />
            </div>
            <div class="field">
              <label>Width</label>
              <select class="input" [(ngModel)]="width">
                <option [value]="512">512</option>
                <option [value]="768">768</option>
              </select>
            </div>
            <div class="field">
              <label>Height</label>
              <select class="input" [(ngModel)]="height">
                <option [value]="512">512</option>
                <option [value]="768">768</option>
              </select>
            </div>
          </div>

          <div class="info-box">
            ⏱ Video generation takes <strong>2–10 minutes</strong> on CPU.
            Make sure your video server is running.
          </div>

          <!-- Model status bar (same style as image page) -->
          @if (modelState !== 'ready' && modelState !== 'unknown') {
            <div class="model-status-box">
              <div class="model-status-top">
                <span class="model-status-label">
                  @if (modelState === 'downloading') { ⬇ Downloading video model }
                  @if (modelState === 'loading')     { ⚙ Loading model into memory }
                  @if (modelState === 'idle')        { ⏳ Waiting to load }
                </span>
                <span class="model-status-pct">{{ modelProgress }}%</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill" [style.width.%]="modelProgress"></div>
              </div>
              <div class="model-status-msg">{{ modelMessage }}</div>
            </div>
          }
          @if (modelState === 'ready') {
            <div class="model-ready-box">✓ Model ready</div>
          }
          @if (modelState === 'unknown') {
            <div class="model-unknown-box">⚠ Video server not running</div>
          }

          <button class="btn btn-primary generate-btn"
            (click)="generate()"
            [disabled]="!prompt.trim() || loading || modelState !== 'ready'">
            @if (loading) {
              <div class="spinner"></div>
              <span>Generating… (this takes a while)</span>
            } @else if (modelState !== 'ready') {
              <span>⏳ Waiting for model…</span>
            } @else {
              <span [innerHTML]="icons.video | safeHtml"></span>
              <span>Generate Video</span>
            }
          </button>

          @if (error) {
            <div class="error-box">⚠ {{ error }}</div>
          }
        </div>

        <!-- Video gallery -->
        @if (videos.length > 0) {
          <div class="video-gallery">
            @for (vid of videos; track vid.url) {
              <div class="video-card fade-in card">
                <video [src]="vidSrc(vid.url)" controls autoplay muted loop
                       style="width:100%; border-radius: 8px; display:block;"></video>
                <div class="video-meta">
                  <div class="truncate">{{ vid.prompt }}</div>
                  <div class="text-dim text-sm">{{ vid.timestamp }}</div>
                </div>
              </div>
            }
          </div>
        }

      </div>
    </div>
  `,
  styles: [`
    .controls { display: flex; flex-direction: column; gap: 14px; }
    .field       { display: flex; flex-direction: column; gap: 6px; }
    label        { font-size: 12px; font-weight: 500; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }
    .row-fields  { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .generate-btn { align-self: flex-start; padding: 10px 24px; gap: 8px; }

    @media (max-width: 600px) {
      .row-fields { grid-template-columns: repeat(2, 1fr); }
      .generate-btn { width: 100%; justify-content: center; }
    }

    .info-box {
      background: rgba(251,191,36,0.08);
      border: 1px solid rgba(251,191,36,0.3);
      border-radius: var(--radius-sm);
      padding: 10px 14px;
      color: var(--yellow, #fbbf24);
      font-size: 12px;
    }

    .model-status-box {
      background: var(--page-glow);
      border: 1px solid var(--page-border);
      border-radius: var(--radius-sm);
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .model-status-top { display: flex; justify-content: space-between; align-items: center; }
    .model-status-label { font-size: 12px; color: var(--page-accent2); font-weight: 500; }
    .model-status-pct   { font-size: 12px; color: var(--page-accent2); font-weight: 600; }
    .model-status-msg   { font-size: 11px; color: var(--text-dim); }

    .progress-track {
      height: 6px;
      background: var(--border);
      border-radius: 3px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: var(--page-accent);
      border-radius: 3px;
      transition: width 0.4s ease;
    }

    .model-ready-box {
      background: rgba(52,211,153,0.1);
      border: 1px solid rgba(52,211,153,0.3);
      border-radius: var(--radius-sm);
      padding: 8px 14px;
      color: var(--green);
      font-size: 12px;
      font-weight: 500;
    }
    .model-unknown-box {
      background: rgba(251,191,36,0.08);
      border: 1px solid rgba(251,191,36,0.3);
      border-radius: var(--radius-sm);
      padding: 8px 14px;
      color: var(--yellow);
      font-size: 12px;
    }

    .error-box {
      background: rgba(248,113,113,0.1);
      border: 1px solid var(--red);
      border-radius: var(--radius-sm);
      padding: 10px 14px;
      color: var(--red);
      font-size: 13px;
    }

    .video-gallery { display: flex; flex-direction: column; gap: 16px; }
    .video-card { display: flex; flex-direction: column; gap: 10px; }
    .video-meta { display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
  `]
})
export class VideoComponent implements OnInit, OnDestroy {
  prompt    = '';
  numFrames = 14;
  fps       = 7;
  width     = 512;
  height    = 512;

  icons = ICONS;
  loading      = false;
  error        = '';
  videos: GeneratedVideo[] = [];

  modelState    = 'unknown';
  modelProgress = 0;
  modelMessage  = '';

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private ai: AiService) {
    try {
      const saved = sessionStorage.getItem('video_gallery');
      if (saved) this.videos = JSON.parse(saved);
    } catch { /* ignore */ }
  }

  ngOnInit() {
    this.pollStatus();
    this.pollTimer = setInterval(() => this.pollStatus(), 3000);
  }

  ngOnDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  private pollStatus() {
    this.ai.getVideoStatus().subscribe({
      next: data => {
        this.modelState    = data.state    ?? 'unknown';
        this.modelProgress = data.progress ?? 0;
        this.modelMessage  = data.message  ?? '';
        if (this.modelState === 'ready' && this.pollTimer) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
      },
      error: () => { this.modelState = 'unknown'; }
    });
  }

  vidSrc(url: string): string {
    const v = (window as any).__API_URL__;
    const base = (v && v !== '') ? v : (window.location.hostname === 'localhost' ? 'http://localhost:3000' : '');
    return base + url;
  }

  generate() {
    if (!this.prompt.trim() || this.loading || this.modelState !== 'ready') return;
    this.loading = true;
    this.error   = '';

    this.ai.generateVideo({
      prompt:     this.prompt,
      num_frames: this.numFrames,
      fps:        this.fps,
      width:      this.width,
      height:     this.height,
    }).subscribe({
      next: r => {
        if (r.success) {
          this.videos.unshift({
            url:       r.url,
            prompt:    this.prompt,
            timestamp: new Date().toLocaleTimeString()
          });
          sessionStorage.setItem('video_gallery', JSON.stringify(this.videos));
        } else {
          this.error = r.error || 'Generation failed';
        }
        this.loading = false;
      },
      error: e => {
        this.error   = e.error?.error || e.message || 'Video server unreachable';
        this.loading = false;
      }
    });
  }
}

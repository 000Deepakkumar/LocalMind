import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AiService } from '../../services/ai.service';
import { AuthService } from '../../services/auth.service';
import { GenerationService } from '../../services/generation.service';
import { ICONS } from '../../shared/icons';
import { SafeHtmlPipe } from '../../shared/safe-html.pipe';

interface GeneratedImage {
  url: string;
  prompt: string;
  timestamp: string;
}

@Component({
  selector: 'app-image',
  standalone: true,
  imports: [CommonModule, FormsModule, SafeHtmlPipe],
  template: `
    <div class="page-shell">

      <div class="page-header">
        <div>
          <div class="page-title">Image Generation</div>
          <div class="text-dim text-sm">Create images using Stable Diffusion locally</div>
        </div>
        @if (auth.isAuthenticated) {
          <div class="user-chip">
            @if (auth.currentUser?.picture) {
              <img class="chip-avatar" [src]="auth.currentUser!.picture" [alt]="auth.currentUser!.name" referrerpolicy="no-referrer">
            }
            <span class="chip-name">{{ auth.currentUser?.name }}</span>
            <button class="chip-logout" (click)="auth.logout()" title="Sign out">⏻</button>
          </div>
        }
      </div>

      <div class="page-body">

        <!-- Controls -->
        <div class="controls card">
          <div class="field">
            <label>Prompt</label>
            <textarea class="textarea" [(ngModel)]="prompt" rows="3"
              placeholder="A futuristic city at night, neon lights, cyberpunk style, 4k...">
            </textarea>
          </div>

          <div class="field">
            <label>Negative Prompt</label>
            <input class="input" [(ngModel)]="negativePrompt"
              placeholder="ugly, blurry, low quality, watermark" />
          </div>

          <div class="row-fields">
            <div class="field">
              <label>Width</label>
              <select class="input" [(ngModel)]="width">
                <option [value]="512">512</option>
                <option [value]="768">768</option>
                <option [value]="1024">1024</option>
              </select>
            </div>
            <div class="field">
              <label>Height</label>
              <select class="input" [(ngModel)]="height">
                <option [value]="512">512</option>
                <option [value]="768">768</option>
                <option [value]="1024">1024</option>
              </select>
            </div>
            <div class="field">
              <label>Steps</label>
              <input class="input" type="number" [(ngModel)]="steps" min="10" max="50" />
            </div>
            <div class="field">
              <label>CFG Scale</label>
              <input class="input" type="number" [(ngModel)]="cfgScale" min="1" max="20" step="0.5" />
            </div>
          </div>

          <!-- Model status bar -->
          @if (!loading && modelState !== 'ready' && modelState !== 'unknown') {
            <div class="model-status-box">
              <div class="model-status-top">
                <span class="model-status-label">
                  @if (modelState === 'downloading') { ⬇ Downloading SD model }
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
          @if (!loading && modelState === 'ready') {
            <div class="model-ready-box">✓ Model ready</div>
          }
          @if (modelState === 'unknown') {
            <div class="model-unknown-box">⚠ Image server not running</div>
          }

          @if (loading) {
            <div class="gen-progress-box">
              <div class="gen-progress-top">
                <span class="gen-progress-label">{{ genMessage || 'Generating…' }}</span>
                <span class="gen-progress-pct">{{ genProgress }}%</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill" [style.width.%]="genProgress"></div>
              </div>
            </div>
          }

          <button class="btn btn-primary generate-btn"
            (click)="generate()" [disabled]="!prompt.trim() || loading || modelState !== 'ready'">
            @if (loading) {
              <div class="spinner"></div>
              <span>Generating… {{ genProgress }}%</span>
            } @else {
              <span [innerHTML]="icons.sparkles | safeHtml"></span>
              <span>Generate Image</span>
            }
          </button>

          @if (error) {
            <div class="error-box">⚠ {{ error }}</div>
          }
        </div>

        <!-- Gallery -->
        @if (images.length > 0) {
          <div class="gallery-header">
            <span class="section-label">{{ auth.isAuthenticated ? 'Your Images' : 'Generated' }}</span>
            <span class="text-dim text-sm">{{ images.length }} image{{ images.length !== 1 ? 's' : '' }}</span>
          </div>
          <div class="gallery">
            @for (img of images; track img.url) {
              <div class="gallery-item fade-in">
                <img [src]="imgSrc(img.url)" [alt]="img.prompt" (click)="openFull(img.url)" />
                <div class="gallery-caption truncate">{{ img.prompt }}</div>
                <div class="text-dim text-sm">{{ img.timestamp }}</div>
              </div>
            }
          </div>
        }

      </div>
    </div>
  `,
  styles: [`
    .page-header { display: flex; align-items: center; justify-content: space-between; }
    .user-chip { display: flex; align-items: center; gap: 6px; background: var(--page-surface2, rgba(255,255,255,0.06)); border: 1px solid var(--page-card-border, rgba(255,255,255,0.1)); border-radius: 20px; padding: 4px 10px 4px 4px; }
    .chip-avatar { width: 26px; height: 26px; border-radius: 50%; object-fit: cover; }
    .chip-name { font-size: 12px; font-weight: 500; color: var(--text, #e2e8f0); max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chip-logout { background: none; border: none; color: var(--text-dim, #64748b); cursor: pointer; font-size: 13px; padding: 2px; line-height: 1; border-radius: 50%; }
    .chip-logout:hover { color: #f87171; }

    .controls { display: flex; flex-direction: column; gap: 14px; }

    .field { display: flex; flex-direction: column; gap: 6px; }
    label { font-size: 12px; font-weight: 500; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }

    .row-fields { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }

    .generate-btn { align-self: flex-start; padding: 10px 24px; gap: 8px; }

    @media (max-width: 600px) {
      .row-fields { grid-template-columns: repeat(2, 1fr); }
      .generate-btn { width: 100%; justify-content: center; }
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

    .gen-progress-box {
      background: var(--page-glow);
      border: 1px solid var(--page-accent);
      border-radius: var(--radius-sm);
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .gen-progress-top { display: flex; justify-content: space-between; align-items: center; }
    .gen-progress-label { font-size: 12px; color: var(--page-accent2); font-weight: 500; }
    .gen-progress-pct   { font-size: 13px; color: var(--page-accent); font-weight: 700; }

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

    /* Gallery */
    .gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 16px;
    }

    .gallery-item {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      cursor: pointer;
      transition: border-color 0.15s, transform 0.15s;
    }
    .gallery-item:hover { border-color: var(--page-accent); transform: translateY(-2px); }

    .gallery-item img {
      width: 100%;
      aspect-ratio: 1;
      object-fit: cover;
      display: block;
    }

    .gallery-header { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; }
    .section-label  { font-size: 13px; font-weight: 600; color: var(--text); }
    .gallery-caption {
      padding: 8px 10px 2px;
      font-size: 12px;
    }
    .gallery-item .text-dim { padding: 0 10px 10px; }
  `]
})
export class ImageComponent implements OnInit, OnDestroy {
  icons = ICONS;
  prompt       = '';
  negativePrompt = 'ugly, blurry, low quality';
  width        = 512;
  height       = 512;
  steps        = 20;
  cfgScale     = 7;

  loading       = false;
  error         = '';
  images: GeneratedImage[] = [];

  // Model download/load progress
  modelState    = 'unknown';   // idle | downloading | loading | ready | generating | unknown
  modelProgress = 0;
  modelMessage  = '';

  // Generation step progress
  genProgress = 0;
  genMessage  = '';

  private pollTimer: any;
  private genPollTimer: any;

  constructor(private ai: AiService, public auth: AuthService, private gen: GenerationService) {
    try {
      const saved = sessionStorage.getItem('image_gallery');
      if (saved) this.images = JSON.parse(saved);
    } catch { /* ignore */ }
  }

  ngOnInit() {
    this.pollModelStatus();
    this.pollTimer = setInterval(() => {
      if (this.modelState !== 'ready') this.pollModelStatus();
    }, 3000);
    if (this.auth.isAuthenticated) this.loadHistory();
  }

  loadHistory() {
    this.ai.getImages().subscribe({
      next: ({ images }) => {
        const fromDb: GeneratedImage[] = images.map(img => ({
          url: img.url,
          prompt: img.prompt,
          timestamp: new Date(img.createdAt).toLocaleString(),
        }));
        const seen = new Set<string>();
        this.images = [...this.images, ...fromDb].filter(i => {
          const key = i.url.split('/').pop()!;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      },
      error: () => {},
    });
  }

  ngOnDestroy() {
    clearInterval(this.pollTimer);
    clearInterval(this.genPollTimer);
  }

  private startGenPoll() {
    this.genPollTimer = setInterval(() => this.pollModelStatus(), 800);
  }

  private stopGenPoll() {
    if (this.genPollTimer) {
      clearInterval(this.genPollTimer);
      this.genPollTimer = null;
    }
  }

  pollModelStatus() {
    const v = (window as any).__API_URL__;
    const base = (v && v !== '') ? v : (window.location.hostname === 'localhost' ? 'http://localhost:3000' : '');
    fetch(`${base}/api/image/status`)
      .then(r => r.json())
      .then(d => {
        this.modelState    = d.state    || 'unknown';
        this.modelProgress = d.progress || 0;
        this.modelMessage  = d.message  || '';
        if (d.state === 'generating') {
          this.genProgress = d.progress || 0;
          this.genMessage  = d.message  || '';
        }
      })
      .catch(() => {
        this.modelState   = 'unknown';
        this.modelMessage = 'Image server not reachable';
      });
  }

  imgSrc(url: string): string {
    const v = (window as any).__API_URL__;
    const base = (v && v !== '') ? v : (window.location.hostname === 'localhost' ? 'http://localhost:3000' : '');
    return base + url;
  }

  generate() {
    if (!this.prompt.trim() || this.loading) return;
    this.loading     = true;
    this.error       = '';
    this.genProgress = 0;
    this.genMessage  = 'Starting generation…';
    const jobId = this.gen.start('image', this.prompt);
    this.startGenPoll();

    this.ai.generateImage({
      prompt:          this.prompt,
      negative_prompt: this.negativePrompt,
      width:           this.width,
      height:          this.height,
      steps:           this.steps,
      cfg_scale:       this.cfgScale,
    }).subscribe({
      next: r => {
        this.stopGenPoll();
        if (r.success) {
          this.images.unshift({
            url:       r.url,
            prompt:    this.prompt,
            timestamp: new Date().toLocaleTimeString()
          });
          sessionStorage.setItem('image_gallery', JSON.stringify(this.images));
          this.gen.finish(jobId);
        } else {
          this.error = r.error || 'Generation failed';
          this.gen.fail(jobId);
        }
        this.loading = false;
        this.genProgress = 0;
      },
      error: e => {
        this.stopGenPoll();
        this.error       = e.error?.error || e.message || 'Server unreachable';
        this.loading     = false;
        this.genProgress = 0;
        this.gen.fail(jobId);
      }
    });
  }

  openFull(url: string) {
    window.open(this.imgSrc(url), '_blank');
  }
}

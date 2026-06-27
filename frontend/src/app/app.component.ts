import { Component, OnInit } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { filter } from 'rxjs/operators';
import { AiService, StatusResponse } from './services/ai.service';
import { AuthService, AuthUser } from './services/auth.service';
import { GenerationService, GenerationJob } from './services/generation.service';

import { ICONS } from './shared/icons';
import { SafeHtmlPipe } from './shared/safe-html.pipe';

interface ModelStatus {
  state: string;
  progress: number;
  message: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule, SafeHtmlPipe],
  template: `
    <div class="shell">

      <!-- Sidebar (desktop + tablet) -->
      <nav class="sidebar" [class.collapsed]="sidebarCollapsed">

        <div class="logo" (click)="toggleSidebar()" title="Toggle sidebar">
          <span class="logo-icon" [innerHTML]="icons.zap | safeHtml"></span>
          <span class="logo-text">LocalMind</span>
        </div>

        <div class="nav-links">
          <a routerLink="/chat"     routerLinkActive="active" class="nav-item nav-chat"     title="Chat">
            <span class="nav-icon" [innerHTML]="icons.chat | safeHtml"></span>
            <span class="nav-label">Chat</span>
          </a>
          <a routerLink="/image"    routerLinkActive="active" class="nav-item nav-image"    title="Image">
            <span class="nav-icon" [innerHTML]="icons.image | safeHtml"></span>
            <span class="nav-label">Image</span>
          </a>
          <a routerLink="/video"    routerLinkActive="active" class="nav-item nav-video"    title="Video">
            <span class="nav-icon" [innerHTML]="icons.video | safeHtml"></span>
            <span class="nav-label">Video</span>
          </a>
          <a routerLink="/settings" routerLinkActive="active" class="nav-item nav-settings" title="Settings">
            <span class="nav-icon" [innerHTML]="icons.settings | safeHtml"></span>
            <span class="nav-label">Settings</span>
          </a>
        </div>

        <!-- Status + models panel (hidden when collapsed) -->
        <div class="side-panels">
          <div class="status-panel">
            <div class="status-title">Servers</div>
            <div class="status-row">
              <span [class]="'dot ' + (status?.ollama ? 'dot-green' : 'dot-red')"></span>
              <span class="status-label">Ollama</span>
              <span class="text-dim text-sm ml-auto">:11434</span>
            </div>
            <div class="status-row">
              <span [class]="'dot ' + (status?.stableDiffusion ? 'dot-green' : 'dot-red')"></span>
              <span class="status-label">Image</span>
              <span class="text-dim text-sm ml-auto">:7860</span>
            </div>
            <div class="status-row">
              <span [class]="'dot ' + (status?.video ? 'dot-green' : 'dot-red')"></span>
              <span class="status-label">Video</span>
              <span class="text-dim text-sm ml-auto">:8765</span>
            </div>
            @if (status?.model) {
              <div class="model-badge">{{ status!.model }}</div>
            }
          </div>

          <div class="model-progress-panel">
            <div class="status-title">Models</div>
            <div class="model-row">
              <div class="model-row-header">
                <span>🎨 Image</span>
                @if (imageStatus?.state === 'ready') {
                  <span class="badge-ready">✓ Ready</span>
                } @else if (imageStatus?.state === 'downloading' || imageStatus?.state === 'loading') {
                  <span class="badge-loading">{{ imageStatus!.progress }}%</span>
                } @else {
                  <span class="text-dim text-sm">—</span>
                }
              </div>
              @if (imageStatus?.state === 'downloading' || imageStatus?.state === 'loading') {
                <div class="prog-track">
                  <div class="prog-fill prog-blue" [style.width.%]="imageStatus!.progress"></div>
                </div>
              }
            </div>
            <div class="model-row">
              <div class="model-row-header">
                <span>🎬 Video</span>
                @if (videoStatus?.state === 'ready') {
                  <span class="badge-ready">✓ Ready</span>
                } @else if (videoStatus?.state === 'downloading' || videoStatus?.state === 'loading') {
                  <span class="badge-loading">{{ videoStatus!.progress }}%</span>
                } @else {
                  <span class="text-dim text-sm">—</span>
                }
              </div>
              @if (videoStatus?.state === 'downloading' || videoStatus?.state === 'loading') {
                <div class="prog-track">
                  <div class="prog-fill prog-purple" [style.width.%]="videoStatus!.progress"></div>
                </div>
              }
            </div>
          </div>
        </div>

        <!-- Active generation jobs -->
        @for (job of activeJobs; track job.id) {
          <div class="job-card" [class.job-done]="job.status === 'done'" [class.job-error]="job.status === 'error'">
            <div class="job-row">
              <span class="job-icon">
                @if (job.status === 'generating') { <span class="job-spinner"></span> }
                @if (job.status === 'done')       { ✓ }
                @if (job.status === 'error')      { ✗ }
              </span>
              <div class="job-info">
                <div class="job-label">
                  {{ job.status === 'generating' ? 'Generating' : job.status === 'done' ? 'Done' : 'Failed' }} · {{ job.type }}
                </div>
                <div class="job-prompt">{{ job.prompt }}</div>
              </div>
            </div>
          </div>
        }

        <!-- User profile — pinned to bottom -->
        @if (currentUser) {
          <div class="user-panel">
            <div class="user-identity">
              @if (currentUser.picture) {
                <img class="user-avatar" [src]="currentUser.picture" [alt]="currentUser.name" referrerpolicy="no-referrer">
              }
              <div class="user-info">
                <div class="user-name">{{ currentUser.name }}</div>
                <div class="user-email">{{ currentUser.email }}</div>
              </div>
            </div>
            <button class="logout-btn" (click)="logout()">
              <span class="logout-icon" [innerHTML]="icons.logout | safeHtml"></span>
              <span class="logout-label">Sign out</span>
            </button>
          </div>
        }

      </nav>

      <!-- Main content -->
      <main class="content">
        <router-outlet />
      </main>

      <!-- Bottom nav (mobile only) -->
      <nav class="bottom-nav">
        <a routerLink="/chat"     routerLinkActive="active" class="bottom-item nav-chat"     title="Chat">
          <span [innerHTML]="icons.chat | safeHtml"></span>
          <span>Chat</span>
        </a>
        <a routerLink="/image"    routerLinkActive="active" class="bottom-item nav-image"    title="Image">
          <span [innerHTML]="icons.image | safeHtml"></span>
          <span>Image</span>
        </a>
        <a routerLink="/video"    routerLinkActive="active" class="bottom-item nav-video"    title="Video">
          <span [innerHTML]="icons.video | safeHtml"></span>
          <span>Video</span>
        </a>
        <a routerLink="/settings" routerLinkActive="active" class="bottom-item nav-settings" title="Settings">
          <span [innerHTML]="icons.settings | safeHtml"></span>
          <span>Settings</span>
        </a>
      </nav>

    </div>
  `,
  styles: [`
    .shell {
      display: flex;
      height: 100vh;
      max-height: 100vh;
      overflow: hidden;
    }

    /* ── Sidebar ─────────────────────────────────────────────────────────────── */
    .sidebar {
      width: 220px;
      flex-shrink: 0;
      background: var(--page-surface);
      border-right: 1px solid var(--page-card-border);
      display: flex;
      flex-direction: column;
      padding: 20px 12px;
      gap: 8px;
      transition: width 0.25s ease, background 0.3s, border-color 0.3s;
      overflow: hidden;
    }
    .sidebar.collapsed { width: 60px; }
    .sidebar.collapsed .nav-label,
    .sidebar.collapsed .logo-text,
    .sidebar.collapsed .side-panels,
    .sidebar.collapsed .job-card,
    .sidebar.collapsed .user-info,
    .sidebar.collapsed .logout-btn { display: none; }
    .sidebar.collapsed .nav-item { justify-content: center; padding: 9px 0; }
    .sidebar.collapsed .user-panel { justify-content: center; padding: 8px 6px; }
    .sidebar.collapsed .user-identity { justify-content: center; }

    .logo {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 4px 8px 16px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 8px;
      cursor: pointer;
      user-select: none;
    }
    .logo-icon { width: 22px; height: 22px; display: flex; align-items: center; flex-shrink: 0; color: var(--page-accent); }
    .logo-text  { font-size: 16px; font-weight: 600; color: var(--accent2); white-space: nowrap; }

    .nav-links { display: flex; flex-direction: column; gap: 4px; flex: 1; }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 12px;
      border-radius: var(--radius-sm);
      color: var(--text-dim);
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .nav-item:hover { background: var(--surface2); color: var(--text); }
    .nav-icon { width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }

    .nav-chat.active    { background: rgba(59,130,246,0.15);  color: #60a5fa; }
    .nav-image.active   { background: rgba(236,72,153,0.15);  color: #f472b6; }
    .nav-video.active   { background: rgba(245,158,11,0.15);  color: #fbbf24; }
    .nav-settings.active{ background: rgba(124,106,247,0.15); color: #a78bfa; }

    .user-panel {
      margin-top: auto;
      flex-shrink: 0;
      background: var(--page-surface2);
      border: 1px solid var(--page-card-border);
      border-radius: var(--radius-sm);
      padding: 8px 10px;
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      overflow: hidden;
    }
    .user-identity {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 0;
      overflow: hidden;
    }
    .user-avatar {
      width: 28px;
      height: 28px;
      border-radius: 4px;
      flex-shrink: 0;
      object-fit: cover;
    }
    .user-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .user-name {
      font-size: 11px;
      font-weight: 600;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.4;
    }
    .user-email {
      font-size: 10px;
      color: var(--text-dim);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.3;
    }
    .logout-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 26px;
      height: 26px;
      border-radius: 6px;
      border: 1px solid var(--page-card-border);
      background: transparent;
      color: var(--text-dim);
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
      padding: 0;
    }
    .logout-btn:hover {
      background: rgba(248,113,113,0.1);
      border-color: rgba(248,113,113,0.3);
      color: #f87171;
    }
    .logout-icon {
      display: flex;
      align-items: center;
    }
    .logout-label { display: none; }

    .job-card {
      background: var(--page-surface2);
      border: 1px solid var(--page-card-border);
      border-radius: var(--radius-sm);
      padding: 10px 10px;
      transition: border-color 0.3s;
    }
    .job-done  { border-color: rgba(52,211,153,0.4); }
    .job-error { border-color: rgba(248,113,113,0.4); }
    .job-row { display: flex; align-items: flex-start; gap: 8px; }
    .job-icon {
      font-size: 13px;
      font-weight: 700;
      flex-shrink: 0;
      padding-top: 1px;
      color: var(--text-dim);
    }
    .job-done  .job-icon { color: #34d399; }
    .job-error .job-icon { color: #f87171; }
    .job-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .job-label { font-size: 11px; font-weight: 600; color: var(--text); text-transform: capitalize; }
    .job-prompt { font-size: 10px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    @keyframes job-spin { to { transform: rotate(360deg); } }
    .job-spinner {
      display: inline-block;
      width: 11px; height: 11px;
      border: 1.5px solid var(--page-card-border);
      border-top-color: var(--page-accent);
      border-radius: 50%;
      animation: job-spin 0.7s linear infinite;
      vertical-align: middle;
    }

    .side-panels { display: flex; flex-direction: column; gap: 8px; }

    .status-panel, .model-progress-panel {
      background: var(--page-surface2);
      border: 1px solid var(--page-card-border);
      border-radius: var(--radius-sm);
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .status-title { font-size: 10px; font-weight: 600; text-transform: uppercase;
                    letter-spacing: 0.08em; color: var(--text-dim); margin-bottom: 2px; }
    .status-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .status-label { white-space: nowrap; }
    .ml-auto { margin-left: auto; }
    .model-badge {
      margin-top: 4px;
      background: rgba(124,106,247,0.15);
      color: var(--accent2);
      border-radius: 4px;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 500;
      text-align: center;
    }
    .model-progress-panel { gap: 10px; }
    .model-row { display: flex; flex-direction: column; gap: 5px; }
    .model-row-header { display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
    .badge-ready   { font-size: 10px; color: var(--green, #34d399); font-weight: 600; }
    .badge-loading { font-size: 10px; color: var(--blue, #60a5fa);  font-weight: 600; }
    .prog-track { height: 3px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden; }
    .prog-fill  { height: 100%; border-radius: 2px; transition: width 0.4s ease; }
    .prog-blue   { background: var(--blue, #60a5fa); }
    .prog-purple { background: var(--accent2, #7c6af7); }

    /* ── Content ─────────────────────────────────────────────────────────────── */
    .content {
      flex: 1;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }

    /* ── Bottom nav (mobile) ─────────────────────────────────────────────────── */
    .bottom-nav { display: none; }

    /* ── Tablet (≤ 900px): collapse sidebar to icons ─────────────────────────── */
    @media (max-width: 900px) {
      .sidebar { width: 60px; }
      .sidebar .nav-label,
      .sidebar .logo-text,
      .sidebar .side-panels { display: none; }
      .sidebar .nav-item { justify-content: center; padding: 9px 0; }
      .sidebar .logo { justify-content: center; padding: 4px 0 16px; }
    }

    /* ── Mobile (≤ 600px): hide sidebar, show bottom nav ─────────────────────── */
    @media (max-width: 600px) {
      .sidebar { display: none; }
      .shell   { flex-direction: column; }
      .content { height: calc(100vh - 60px); }

      .bottom-nav {
        display: flex;
        position: fixed;
        bottom: 0; left: 0; right: 0;
        height: 60px;
        background: var(--page-surface);
        border-top: 1px solid var(--page-card-border);
        z-index: 100;
        transition: background 0.3s, border-color 0.3s;
      }
      .bottom-item {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 3px;
        color: var(--text-dim);
        text-decoration: none;
        font-size: 10px;
        font-weight: 500;
        transition: color 0.15s;
      }
      .bottom-item span:first-child { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; }
      .nav-chat.active    { color: #60a5fa; }
      .nav-image.active   { color: #f472b6; }
      .nav-video.active   { color: #fbbf24; }
      .nav-settings.active{ color: #a78bfa; }
    }
  `]
})
export class AppComponent implements OnInit {
  icons = ICONS;
  status: StatusResponse | null = null;
  imageStatus: ModelStatus | null = null;
  videoStatus: ModelStatus | null = null;
  sidebarCollapsed = false;
  currentUser: AuthUser | null = null;
  activeJobs: GenerationJob[] = [];

  constructor(private ai: AiService, private router: Router, private auth: AuthService, private gen: GenerationService) {}

  ngOnInit() {
    this.auth.user$.subscribe(u => this.currentUser = u);
    this.gen.jobs$.subscribe(j => this.activeJobs = j);
    this.refreshStatus();
    this.refreshModelStatuses();
    setInterval(() => this.refreshStatus(), 15000);
    setInterval(() => this.refreshModelStatuses(), 3000);

    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe((e: any) => {
      document.body.className = '';
      if (e.urlAfterRedirects.startsWith('/chat'))  document.body.classList.add('page-chat');
      if (e.urlAfterRedirects.startsWith('/image')) document.body.classList.add('page-image');
      if (e.urlAfterRedirects.startsWith('/video')) document.body.classList.add('page-video');
    });
    const url = this.router.url;
    if (url.startsWith('/chat'))  document.body.classList.add('page-chat');
    if (url.startsWith('/image')) document.body.classList.add('page-image');
    if (url.startsWith('/video')) document.body.classList.add('page-video');
  }

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  logout() {
    this.auth.logout();
  }

  refreshStatus() {
    this.ai.getStatus().subscribe({
      next: s  => this.status = s,
      error: () => this.status = { ollama: false, stableDiffusion: false, video: false, model: '?' }
    });
  }

  refreshModelStatuses() {
    this.ai.getImageStatus().subscribe({ next: s => this.imageStatus = s, error: () => {} });
    this.ai.getVideoStatus().subscribe({ next: s => this.videoStatus = s, error: () => {} });
  }
}

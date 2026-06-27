import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AiService } from '../../services/ai.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page-shell">

      <div class="page-header">
        <div>
          <div class="page-title">Settings</div>
          <div class="text-dim text-sm">Configure models and server connections</div>
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

        <!-- Model selection -->
        <div class="card section">
          <div class="section-title">Language Model</div>
          <div class="field">
            <label>Active Model</label>
            <div class="flex gap-2">
              <select class="input" [(ngModel)]="selectedModel" (change)="saveModel()">
                @for (m of availableModels; track m) {
                  <option [value]="m">{{ m }}</option>
                }
                @if (availableModels.length === 0) {
                  <option value="mistral">mistral (default)</option>
                }
              </select>
              <button class="btn btn-ghost" (click)="loadModels()">↻ Refresh</button>
            </div>
          </div>
          <div class="hint text-dim text-sm">
            Pull more models with: <code>docker exec -it ollama ollama pull llama3</code>
          </div>
        </div>

        <!-- Server URLs -->
        <div class="card section">
          <div class="section-title">Server Endpoints</div>
          <div class="field">
            <label>LLM (Ollama)</label>
            <input class="input" value="http://ollama:11434" disabled />
          </div>
          <div class="field">
            <label>Stable Diffusion WebUI</label>
            <input class="input" value="http://localhost:7860" disabled />
          </div>
          <div class="field">
            <label>Video Server (ComfyUI / SVD)</label>
            <input class="input" value="http://localhost:8188" disabled />
          </div>
          <div class="hint text-dim text-sm">
            Server URLs are configured via environment variables in <code>docker-compose.yml</code>.
          </div>
        </div>

        <!-- Quick commands -->
        <div class="card section">
          <div class="section-title">Useful Docker Commands</div>
          <div class="commands">
            @for (cmd of commands; track cmd.label) {
              <div class="cmd-row">
                <div class="cmd-label">{{ cmd.label }}</div>
                <code class="cmd-code">{{ cmd.command }}</code>
              </div>
            }
          </div>
        </div>

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

    .section       { display: flex; flex-direction: column; gap: 14px; }
    .section-title { font-size: 14px; font-weight: 600; padding-bottom: 8px; border-bottom: 1px solid var(--page-card-border); }
    .field         { display: flex; flex-direction: column; gap: 6px; }
    label          { font-size: 12px; font-weight: 500; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }
    .hint          { margin-top: -4px; }
    code           { background: var(--page-surface2); padding: 2px 6px; border-radius: 4px; font-size: 11px; }

    .commands { display: flex; flex-direction: column; gap: 10px; }
    .cmd-row  { display: flex; flex-direction: column; gap: 4px; }
    .cmd-label { font-size: 12px; color: var(--text-dim); }
    .cmd-code {
      background: var(--page-surface2);
      border: 1px solid var(--page-card-border);
      border-radius: var(--radius-sm);
      padding: 8px 12px;
      font-size: 12px;
      word-break: break-all;
      display: block;
    }
  `]
})
export class SettingsComponent implements OnInit {
  selectedModel    = localStorage.getItem('selectedModel') || 'mistral';
  availableModels: string[] = [];

  commands = [
    { label: 'Pull a new model',         command: 'docker exec -it ollama ollama pull llama3' },
    { label: 'List downloaded models',   command: 'docker exec -it ollama ollama list' },
    { label: 'Restart all containers',   command: 'docker compose restart' },
    { label: 'View backend logs',        command: 'docker logs ai-backend -f' },
    { label: 'Change model in .env',     command: 'OLLAMA_MODEL=llama3  (edit .env file)' },
  ];

  constructor(private ai: AiService, public auth: AuthService) {}

  ngOnInit() { this.loadModels(); }

  loadModels() {
    this.ai.getModels().subscribe({
      next: r => {
        this.availableModels = r.models?.map((m: any) => m.name) || [];
        if (!this.availableModels.includes(this.selectedModel) && this.availableModels.length)
          this.selectedModel = this.availableModels[0];
      },
      error: () => { this.availableModels = []; }
    });
  }

  saveModel() {
    localStorage.setItem('selectedModel', this.selectedModel);
  }
}

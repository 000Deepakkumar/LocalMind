import { Component, ElementRef, ViewChild, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AiService, ChatMessage } from '../../services/ai.service';
import { ICONS } from '../../shared/icons';
import { SafeHtmlPipe } from '../../shared/safe-html.pipe';

const STORAGE_KEY = 'chat_history';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, SafeHtmlPipe],
  template: `
    <div class="chat-shell">

      <!-- Header -->
      <div class="chat-header">
        <div>
          <div class="page-title">Chat</div>
          <div class="text-dim text-sm">Multi-turn conversation with your local LLM</div>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-ghost icon-btn" (click)="saveChat()" [disabled]="messages.length === 0" title="Save chat">
            <span [innerHTML]="icons.save | safeHtml"></span> Save
          </button>
          <button class="btn btn-danger icon-btn" (click)="clearChat()" [disabled]="messages.length === 0" title="Clear chat">
            <span [innerHTML]="icons.trash | safeHtml"></span> Clear
          </button>
        </div>
      </div>

      <!-- Messages -->
      <div class="messages" #messagesEl>
        @if (messages.length === 0) {
          <div class="empty-state">
            <div class="empty-icon">💬</div>
            <div class="empty-title">Start a conversation</div>
            <div class="text-dim text-sm">Type a message below to chat with your LocalMind</div>
          </div>
        }

        @for (msg of messages; track $index) {
          <div [class]="'message fade-in ' + msg.role">
            <div class="message-role">{{ msg.role === 'user' ? 'You' : 'AI' }}</div>
            <div class="message-content" [innerHTML]="formatContent(msg.content)"></div>
          </div>
        }

        @if (streaming) {
          <div class="message fade-in assistant">
            <div class="message-role">AI</div>
            <div class="message-content">
              {{ streamBuffer }}<span class="cursor">▋</span>
            </div>
          </div>
        }
      </div>

      <!-- Input bar -->
      <div class="input-bar">
        <textarea
          class="textarea chat-input"
          [(ngModel)]="userInput"
          (keydown.enter)="onEnter($event)"
          placeholder="Message your AI… (Enter to send, Shift+Enter for newline)"
          rows="1"
          [disabled]="streaming"
          #inputEl
        ></textarea>
        <button
          class="btn btn-primary send-btn"
          (click)="send()"
          [disabled]="!userInput.trim() || streaming"
          title="Send message"
        >
          @if (streaming) {
            <div class="spinner"></div>
          } @else {
            <span [innerHTML]="icons.send | safeHtml"></span>
          }
        </button>
      </div>

    </div>
  `,
  styles: [`
    .chat-shell {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      background: var(--page-bg);
      transition: background 0.3s;
    }
    /* Mobile: leave room for the bottom nav */
    @media (max-width: 600px) {
      .chat-shell  { height: calc(100vh - 60px); }
    }

    .chat-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      padding: 16px 20px 12px;
      border-bottom: 1px solid var(--page-card-border);
      /* NEVER shrink or scroll — always visible */
      flex-shrink: 0;
      background: var(--page-header-bg);
      position: relative;
      transition: background 0.3s, border-color 0.3s;
    }
    .chat-header::before {
      content: '';
      display: block;
      width: 3px;
      height: 100%;
      background: var(--page-accent);
      position: absolute;
      left: 0; top: 0;
      border-radius: 0 2px 2px 0;
      opacity: 0.7;
    }
    .page-title { font-size: 18px; font-weight: 600; }

    /* Messages — the ONLY scrollable part */
    .messages {
      flex: 1;
      min-height: 0;      /* required: lets flexbox shrink below content size */
      overflow-y: auto;
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      background: var(--page-bg);
    }

    .empty-state {
      margin: auto;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .empty-icon  { font-size: 48px; margin-bottom: 8px; }
    .empty-title { font-size: 16px; font-weight: 500; }

    .message {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-width: 80%;
    }
    .message.user      { align-self: flex-end; align-items: flex-end; }
    .message.assistant { align-self: flex-start; }

    .message-role {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-dim);
      padding: 0 4px;
    }

    .message-content {
      padding: 12px 16px;
      border-radius: 12px;
      line-height: 1.6;
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .message.user      .message-content {
      background: var(--page-accent);
      color: #fff;
      border-bottom-right-radius: 4px;
    }
    .message.assistant .message-content {
      background: var(--page-surface2);
      border: 1px solid var(--border);
      border-bottom-left-radius: 4px;
    }

    .cursor {
      display: inline-block;
      animation: blink 1s step-end infinite;
      color: var(--page-accent2);
    }
    @keyframes blink { 50% { opacity: 0; } }

    /* Input bar — NEVER shrink or scroll */
    .input-bar {
      display: flex;
      gap: 10px;
      padding: 12px 20px 16px;
      border-top: 1px solid var(--page-card-border);
      background: var(--page-header-bg);
      flex-shrink: 0;
      align-items: flex-end;
      /* extra safety on mobile */
      position: relative;
      z-index: 1;
    }

    .chat-input {
      flex: 1;
      min-height: 44px;
      max-height: 140px;
      resize: none;
    }

    .send-btn {
      height: 44px;
      width: 44px;
      padding: 0;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--radius-sm);
    }
    .icon-btn { display: flex; align-items: center; gap: 6px; }
    .icon-btn span { display: flex; align-items: center; }

    /* ── Responsive ── */
    @media (max-width: 600px) {
      .message { max-width: 92%; }
      .input-bar { padding: 10px 12px 12px; gap: 8px; }
      .chat-header { padding: 12px 12px 10px; }
      .messages { padding: 12px; }
    }

    /* Code blocks inside messages */
    :host ::ng-deep pre {
      background: rgba(0,0,0,0.3);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
      overflow-x: auto;
      margin: 8px 0;
      font-size: 12px;
    }
    :host ::ng-deep code { font-family: 'Consolas', monospace; }
  `]
})
export class ChatComponent implements AfterViewChecked {
  @ViewChild('messagesEl') messagesEl!: ElementRef<HTMLDivElement>;
  icons = ICONS;

  messages: ChatMessage[] = [];
  userInput    = '';
  streaming    = false;
  streamBuffer = '';

  constructor(private ai: AiService) {
    // Restore chat history from sessionStorage on load.
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) this.messages = JSON.parse(saved);
    } catch { /* ignore parse errors */ }
  }

  ngAfterViewChecked() {
    this.scrollToBottom();
  }

  private scrollToBottom() {
    try {
      const el = this.messagesEl.nativeElement;
      el.scrollTop = el.scrollHeight;
    } catch { /* ignore */ }
  }

  onEnter(event: Event) {
    const ke = event as KeyboardEvent;
    if (!ke.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  async send() {
    const text = this.userInput.trim();
    if (!text || this.streaming) return;

    this.messages.push({ role: 'user', content: text });
    this.persist();
    this.userInput    = '';
    this.streaming    = true;
    this.streamBuffer = '';

    // Build the payload (include a light system prompt).
    const payload: ChatMessage[] = [
      { role: 'system', content: 'You are a helpful, concise LocalMind assistant running entirely offline.' },
      ...this.messages,
    ];

    try {
      const model = localStorage.getItem('selectedModel') || 'mistral';
      for await (const event of this.ai.streamChatFetch(payload, model)) {
        if (event.token) {
          this.streamBuffer += event.token;
        }
        if (event.done || event.error) {
          this.messages.push({
            role: 'assistant',
            content: event.error ? `Error: ${event.error}` : this.streamBuffer
          });
          this.persist();
          this.streamBuffer = '';
          this.streaming    = false;
          break;
        }
      }
    } catch (e: any) {
      this.messages.push({ role: 'assistant', content: `Error: ${e.message}` });
      this.streaming = false;
    }
  }

  private persist() {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.messages));
  }

  clearChat() {
    this.messages = [];
    sessionStorage.removeItem(STORAGE_KEY);
  }

  saveChat() {
    this.ai.saveChat(this.messages).subscribe({
      next: r  => alert(`Chat saved as ${r.filename}`),
      error: () => alert('Save failed — is the backend running?')
    });
  }

  // Simple markdown-lite: wrap ```code``` blocks and newlines.
  formatContent(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }
}

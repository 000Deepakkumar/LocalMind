import { Component, AfterViewInit, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

declare const google: any;

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="login-shell">
      <div class="login-card">
        <div class="logo-section">
          <div class="logo-icon">⚡</div>
          <h1 class="logo-title">LocalMind</h1>
          <p class="logo-sub">Your private AI assistant</p>
        </div>

        <div class="divider"></div>

        @if (error) {
          <div class="error-msg">{{ error }}</div>
        }

        @if (loading) {
          <div class="loading-spinner">Signing in…</div>
        } @else {
          <div class="google-btn-wrapper">
            <div id="google-signin-btn"></div>
          </div>

          @if (!gsiReady) {
            <div class="gsi-fallback">Loading Google Sign-In…</div>
          }

          <p class="hint">Sign in to save your chats to your account.</p>
        }
      </div>
    </div>
  `,
  styles: [`
    .login-shell {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--page-bg, #0f1117);
    }
    .login-card {
      background: var(--page-surface, #1a1d27);
      border: 1px solid var(--page-card-border, rgba(255,255,255,0.08));
      border-radius: 16px;
      padding: 40px 36px;
      width: 360px;
      max-width: 90vw;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
    }
    .logo-section { display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .logo-icon  { font-size: 40px; line-height: 1; }
    .logo-title { font-size: 24px; font-weight: 700; color: var(--text, #e2e8f0); margin: 0; }
    .logo-sub   { font-size: 13px; color: var(--text-dim, #64748b); margin: 0; }
    .divider    { width: 100%; height: 1px; background: var(--page-card-border, rgba(255,255,255,0.08)); }
    .google-btn-wrapper { display: flex; justify-content: center; min-height: 44px; width: 100%; }
    .gsi-fallback { font-size: 13px; color: var(--text-dim, #64748b); }
    .hint {
      font-size: 12px;
      color: var(--text-dim, #64748b);
      text-align: center;
      margin: 0;
      line-height: 1.5;
    }
    .error-msg {
      background: rgba(239,68,68,0.12);
      border: 1px solid rgba(239,68,68,0.3);
      color: #f87171;
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 13px;
      width: 100%;
      text-align: center;
    }
    .loading-spinner { color: var(--text-dim, #64748b); font-size: 14px; padding: 12px; }
  `]
})
export class LoginComponent implements AfterViewInit {
  loading  = false;
  error    = '';
  gsiReady = false;

  constructor(
    private auth: AuthService,
    private router: Router,
    private zone: NgZone,
  ) {}

  ngAfterViewInit() {
    if (this.auth.isAuthenticated) {
      this.router.navigate(['/chat']);
      return;
    }
    this.waitForGSI(0);
  }

  private waitForGSI(attempts: number) {
    if (attempts > 30) {
      this.error = 'Google Sign-In failed to load. Check your internet connection.';
      return;
    }
    if (typeof google === 'undefined' || !google?.accounts?.id) {
      setTimeout(() => this.waitForGSI(attempts + 1), 300);
      return;
    }
    this.initGSI();
  }

  private initGSI() {
    const clientId = (window as any).__GOOGLE_CLIENT_ID__ || '';
    if (!clientId) {
      this.error = 'Google Client ID not configured. Set __GOOGLE_CLIENT_ID__ in assets/config.js.';
      return;
    }

    google.accounts.id.initialize({
      client_id: clientId,
      callback: (response: { credential: string }) => {
        this.zone.run(() => this.handleCredential(response.credential));
      },
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    const btnEl = document.getElementById('google-signin-btn');
    if (btnEl) {
      google.accounts.id.renderButton(btnEl, {
        theme: 'filled_black',
        size: 'large',
        shape: 'pill',
        text: 'signin_with',
        width: 280,
      });
      this.gsiReady = true;
    }
  }

  private handleCredential(credential: string) {
    this.loading = true;
    this.error   = '';
    this.auth.loginWithGoogle(credential).subscribe({
      next: () => this.router.navigate(['/chat']),
      error: (e) => {
        this.loading = false;
        this.error   = e?.error?.error || 'Sign-in failed. Please try again.';
      },
    });
  }
}

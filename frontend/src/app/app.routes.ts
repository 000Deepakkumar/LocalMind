import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'chat', pathMatch: 'full' },
  {
    path: 'chat',
    loadComponent: () => import('./pages/chat/chat.component').then(m => m.ChatComponent)
  },
  {
    path: 'image',
    loadComponent: () => import('./pages/image/image.component').then(m => m.ImageComponent)
  },
  {
    path: 'video',
    loadComponent: () => import('./pages/video/video.component').then(m => m.VideoComponent)
  },
  {
    path: 'settings',
    loadComponent: () => import('./pages/settings/settings.component').then(m => m.SettingsComponent)
  },
];

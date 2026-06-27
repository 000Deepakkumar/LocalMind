import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface GenerationJob {
  id: string;
  type: 'image' | 'video';
  prompt: string;
  status: 'generating' | 'done' | 'error';
  startedAt: number;
}

@Injectable({ providedIn: 'root' })
export class GenerationService {
  private jobsSubject = new BehaviorSubject<GenerationJob[]>([]);
  jobs$ = this.jobsSubject.asObservable();

  start(type: 'image' | 'video', prompt: string): string {
    const id = `${type}-${Date.now()}`;
    const job: GenerationJob = { id, type, prompt, status: 'generating', startedAt: Date.now() };
    this.jobsSubject.next([...this.jobsSubject.value, job]);
    return id;
  }

  finish(id: string) {
    this.update(id, 'done');
    setTimeout(() => this.remove(id), 3000);
  }

  fail(id: string) {
    this.update(id, 'error');
    setTimeout(() => this.remove(id), 4000);
  }

  private update(id: string, status: GenerationJob['status']) {
    this.jobsSubject.next(
      this.jobsSubject.value.map(j => j.id === id ? { ...j, status } : j)
    );
  }

  private remove(id: string) {
    this.jobsSubject.next(this.jobsSubject.value.filter(j => j.id !== id));
  }
}

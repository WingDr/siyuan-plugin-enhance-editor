import type { Completion } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import PluginEnhanceEditor from "../index";

const STORAGE_KEY = "completion-frequency";
const SAVE_DEBOUNCE_MS = 300;

export class CompletionFrequencyStore {
  private freq: Record<string, number> = {};
  private saveTimer: number | null = null;
  private loaded = false;

  constructor(private plugin: PluginEnhanceEditor) {}

  public async load(): Promise<void> {
    const stored = await this.plugin.loadData(STORAGE_KEY);
    if (stored && typeof stored === "object") {
      this.freq = stored as Record<string, number>;
    }
    this.loaded = true;
  }

  public getCount(label: string): number {
    return this.freq[label] ?? 0;
  }

  public wrapCompletion(completion: Completion): Completion {
    const label = String(completion.label ?? "");
    const originalApply = completion.apply;

    return {
      ...completion,
      apply: (view: EditorView, completionObj: Completion, from: number, to: number) => {
        this.increment(label);
        if (typeof originalApply === "function") {
          return originalApply(view, completionObj, from, to);
        }
        if (typeof originalApply === "string") {
          view.dispatch({
            changes: { from, to, insert: originalApply }
          });
          return;
        }
        view.dispatch({
          changes: { from, to, insert: String(completionObj.label ?? "") }
        });
      }
    };
  }

  private increment(label: string): void {
    if (!label) return;
    this.freq[label] = (this.freq[label] ?? 0) + 1;
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (!this.loaded) return;
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      void this.flush();
    }, SAVE_DEBOUNCE_MS);
  }

  private async flush(): Promise<void> {
    await this.plugin.saveData(STORAGE_KEY, this.freq);
  }
}

export type GenerationJob = {
  id: number;
  label: string;
  status: "waiting" | "running" | "failed";
  message: string;
  startedAt?: number;
};

/** Serializes whole Studio jobs, including uploads, batches and postprocessing. */
export function createGenerationQueue(onChange: (jobs: GenerationJob[]) => void) {
  let nextId = 1;
  let running = false;
  const entries: { job: GenerationJob; run: (onStatus: (message: string) => void) => Promise<void>; onDiscard?: () => void }[] = [];
  const publish = () => onChange(entries.map(({ job }) => ({ ...job })));

  async function drain() {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const entry = entries.find(({ job }) => job.status === "waiting");
        if (!entry) break;
        entry.job.status = "running";
        entry.job.startedAt = Date.now();
        entry.job.message = "正在準備生成…";
        publish();
        try {
          await entry.run((message) => {
            entry.job.message = message;
            publish();
          });
          entries.splice(entries.indexOf(entry), 1);
        } catch (error) {
          entry.job.status = "failed";
          entry.job.message = error instanceof Error ? error.message : "生成失敗，請查看 ComfyUI 視窗。";
        }
        publish();
      }
    } finally {
      running = false;
    }
  }

  return {
    add(label: string, run: (onStatus: (message: string) => void) => Promise<void>, onDiscard?: () => void) {
      const id = nextId++;
      entries.push({ job: { id, label, status: "waiting", message: "等待前一筆任務完成" }, run, onDiscard });
      publish();
      void drain();
      return id;
    },
    remove(id: number) {
      const index = entries.findIndex(({ job }) => job.id === id && job.status !== "running");
      if (index === -1) return;
      if (entries[index].job.status === "waiting") entries[index].onDiscard?.();
      entries.splice(index, 1);
      publish();
    },
  };
}

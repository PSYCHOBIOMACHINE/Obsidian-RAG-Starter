import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { WorkingMemory, WorkingMemoryDelta,  } from '@/lib/workingMemory';
import { Message } from '@/app/page';

export interface WorkingMemoryStore {
  memory: WorkingMemory;
  isUpdatingMemory: boolean;
  applyMemoryDelta: (delta: WorkingMemoryDelta) => void;
  findMemoryDelta: (recentMessages: Message[]) => Promise<void>;
}

export const useWorkingMemoryStore = create<WorkingMemoryStore>()(
  persist(
    (set, get) => ({
      memory: new WorkingMemory(),
      isUpdatingMemory: false,

      // synchronous — just mutates + notifies
      applyMemoryDelta: (delta) => {
        const mem = get().memory;
        mem.applyDelta(delta);
        set({ memory: mem });
      },

      // async — fetches, then delegates to applyMemorydelta
      findMemoryDelta: async (recentMessages) => {
        set({ isUpdatingMemory: true });
        try {
          const bgRes = await fetch('/api/wm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              snapshot: get().memory.toJSON(),
              recentMessages,
            }),
          });
          if (!bgRes.ok) throw new Error(`memory-update failed: ${bgRes.status}`);
          const delta: WorkingMemoryDelta = await bgRes.json();
          get().applyMemoryDelta(delta);
        } catch (err) {
          console.error('Memory update failed:', err);
          // deliberately no set() here — bad fetch shouldn't corrupt existing memory
        } finally {
          set({ isUpdatingMemory: false });
        }
      },
    }),
    {
      name: 'working-memory',
      storage: createJSONStorage(() => localStorage),
      merge: (persisted: any, current) => ({
        ...current,
        memory: new WorkingMemory(persisted.memory),
      }),
    }
  )
);

//persisted -> whatever is pulled from localStorage, 
// current -> fresh initial state store creater function produced
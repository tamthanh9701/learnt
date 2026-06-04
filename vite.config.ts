import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Silence the "chunks larger than 500 kB" warning for the 23.5 MB
    // WASM chunk (unavoidable size, only loaded by the lazy Pronunciation
    // feature on first use). 1 MB threshold covers the typical lazy-chunk
    // case without hiding genuinely oversized bundles.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // NFR-11 (bundle isolation, HARD VETO): phoneme engine + WASM runtime
        // MUST NOT be bundled into the main chunk. Without manualChunks,
        // Vite's auto-splitting is heuristic and could regress if a future
        // change to phonemeScorer.ts drops the dynamic import. Pinning
        // explicitly here is a safety net that documents the constraint
        // in code and is verified by the build output.
        //
        // Also split out supabase-js (~100KB) to keep the main chunk under
        // Vite's 500KB warning threshold. React + react-dom + app code
        // remain in the main chunk (Vite default, no need to split).
        manualChunks(id) {
          if (id.includes('@huggingface/transformers')) return 'phoneme-engine'
          if (id.includes('@supabase/supabase-js')) return 'supabase-client'
          return undefined
        },
      },
    },
  },
})

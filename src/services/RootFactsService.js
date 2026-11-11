import { pipeline, env } from '@huggingface/transformers';
import { TONE_CONFIG } from '../utils/config.js';
import { isWebGPUSupported } from '../utils/common.js';

const MODEL_ID = 'Xenova/LaMini-Flan-T5-77M';

const TONE_INSTRUCTIONS = {
  normal: 'in a clear and informative way',
  funny: 'in a funny, playful way with a joke or a pun',
  professional: 'in a formal, professional tone like a botanist',
  casual: 'in a relaxed, casual way like talking to a friend',
};

const GENERATION_OPTIONS = {
  max_new_tokens: 100,
  temperature: 0.7,
  top_p: 0.9,
  do_sample: true,
  repetition_penalty: 1.2,
};

export class RootFactsService {
  constructor() {
    this.generator = null;
    this.isModelLoaded = false;
    this.isGenerating = false;
    this.config = { modelId: MODEL_ID, dtype: 'q4' };
    this.currentBackend = null;
    this.currentTone = TONE_CONFIG.defaultTone;
  }

  createPipeline(device, onProgress) {
    const files = {};

    return pipeline('text2text-generation', this.config.modelId, {
      device,
      dtype: this.config.dtype,
      progress_callback: (info) => {
        if (info.status === 'progress' && info.total) {
          files[info.file] = { loaded: info.loaded, total: info.total };
          const all = Object.values(files);
          const loaded = all.reduce((sum, file) => sum + file.loaded, 0);
          const total = all.reduce((sum, file) => sum + file.total, 0);
          onProgress?.(Math.min(99, Math.round((loaded / total) * 100)));
        }
      },
    });
  }

  // Device adaptif: WebGPU bila tersedia, fallback ke WebAssembly.
  async loadModel(onProgress) {
    env.allowLocalModels = false;

    const devices = isWebGPUSupported() ? ['webgpu', 'wasm'] : ['wasm'];
    let lastError = null;

    for (const device of devices) {
      try {
        this.generator = await this.createPipeline(device, onProgress);
        this.currentBackend = device;
        this.isModelLoaded = true;
        onProgress?.(100);
        return;
      } catch (error) {
        console.warn(`Device ${device} gagal, mencoba berikutnya.`, error);
        lastError = error;
      }
    }

    throw lastError ?? new Error('Gagal memuat model Generative AI');
  }

  setTone(tone) {
    this.currentTone = TONE_INSTRUCTIONS[tone] ? tone : TONE_CONFIG.defaultTone;
  }

  buildPrompt(vegetableName) {
    const style = TONE_INSTRUCTIONS[this.currentTone];
    return `Write one short and interesting fun fact about ${vegetableName} ${style}.`;
  }

  async generateFacts(vegetableName) {
    if (!this.isReady()) {
      throw new Error('Model Generative AI belum siap');
    }

    this.isGenerating = true;
    try {
      const output = await this.generator(
        this.buildPrompt(vegetableName),
        GENERATION_OPTIONS,
      );
      const text = output?.[0]?.generated_text?.trim();
      if (!text) throw new Error('Hasil generasi kosong');
      return text;
    } finally {
      this.isGenerating = false;
    }
  }

  isReady() {
    return this.isModelLoaded && this.generator !== null && !this.isGenerating;
  }
}

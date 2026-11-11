import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgpu';
import { isWebGPUSupported, validateModelMetadata } from '../utils/common.js';

const BASE_URL = import.meta.env.BASE_URL;

export class DetectionService {
  constructor() {
    this.model = null;
    this.labels = [];
    this.backend = null;
    this.config = {
      modelUrl: `${BASE_URL}model/model.json`,
      metadataUrl: `${BASE_URL}model/metadata.json`,
      imageSize: 224,
    };
  }

  // Backend adaptif: WebGPU diprioritaskan, fallback ke WebGL, lalu CPU.
  async setupBackend() {
    const candidates = isWebGPUSupported() ? ['webgpu', 'webgl', 'cpu'] : ['webgl', 'cpu'];

    for (const backend of candidates) {
      try {
        const success = await tf.setBackend(backend);
        if (success) {
          await tf.ready();
          this.backend = backend;
          return backend;
        }
      } catch (error) {
        console.warn(`Backend ${backend} tidak tersedia, mencoba berikutnya.`, error);
      }
    }

    throw new Error('Tidak ada backend TensorFlow.js yang tersedia');
  }

  async loadModel(onProgress) {
    await this.setupBackend();

    const [model, metadata] = await Promise.all([
      tf.loadLayersModel(this.config.modelUrl, {
        onProgress: (fraction) => onProgress?.(Math.round(fraction * 100)),
      }),
      fetch(this.config.metadataUrl).then((response) => {
        if (!response.ok) throw new Error('Gagal memuat metadata model');
        return response.json();
      }),
    ]);

    if (!validateModelMetadata(metadata)) {
      model.dispose();
      throw new Error('Metadata model tidak valid');
    }

    this.model = model;
    this.labels = metadata.labels;
    this.config.imageSize = metadata.imageSize || this.config.imageSize;

    // Warm-up agar prediksi pertama tidak lambat.
    const warmup = tf.tidy(() =>
      this.model.predict(tf.zeros([1, this.config.imageSize, this.config.imageSize, 3])),
    );
    await warmup.data();
    warmup.dispose();

    onProgress?.(100);
  }

  async predict(imageElement) {
    if (!this.isLoaded()) {
      throw new Error('Model deteksi belum dimuat');
    }

    const size = this.config.imageSize;

    // tf.tidy membersihkan seluruh tensor perantara; hanya hasil akhir yang dikembalikan.
    const output = tf.tidy(() => {
      const pixels = tf.browser.fromPixels(imageElement);
      const [height, width] = pixels.shape;
      const side = Math.min(height, width);
      const top = Math.floor((height - side) / 2);
      const left = Math.floor((width - side) / 2);

      const input = tf.image
        .resizeBilinear(pixels.slice([top, left, 0], [side, side, 3]), [size, size])
        .toFloat()
        .div(127)
        .sub(1)
        .expandDims(0);

      return this.model.predict(input);
    });

    const scores = await output.data();
    output.dispose();

    let bestIndex = 0;
    for (let i = 1; i < scores.length; i++) {
      if (scores[i] > scores[bestIndex]) bestIndex = i;
    }

    const score = scores[bestIndex];
    return {
      className: this.labels[bestIndex] ?? 'Unknown',
      score,
      confidence: score * 100,
      isValid: bestIndex < this.labels.length,
    };
  }

  isLoaded() {
    return this.model !== null && this.labels.length > 0;
  }
}

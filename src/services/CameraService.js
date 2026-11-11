import { getCameraErrorMessage } from '../utils/common.js';

const FRONT_CAMERA = 'front';
const DEFAULT_CAMERA = 'default';

export class CameraService {
  constructor() {
    this.stream = null;
    this.video = null;
    this.canvas = null;
    this.cameras = [];
    this.config = {
      width: { ideal: 640 },
      height: { ideal: 480 },
      fps: 30,
    };
  }

  setVideoElement(videoElement) {
    this.video = videoElement;
  }

  setCanvasElement(canvasElement) {
    this.canvas = canvasElement;
  }

  async loadCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      this.cameras = [];
      return this.cameras;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    this.cameras = devices.filter((device) => device.kind === 'videoinput');
    return this.cameras;
  }

  getConstraints(selectedCameraId = DEFAULT_CAMERA) {
    const video = {
      width: this.config.width,
      height: this.config.height,
      frameRate: { ideal: this.config.fps },
    };

    if (selectedCameraId === FRONT_CAMERA) {
      video.facingMode = 'user';
    } else if (selectedCameraId === DEFAULT_CAMERA) {
      video.facingMode = { ideal: 'environment' };
    } else {
      video.deviceId = { exact: selectedCameraId };
    }

    return { video, audio: false };
  }

  async startCamera(selectedCameraId = DEFAULT_CAMERA) {
    if (!this.video) {
      throw new Error('Elemen video belum tersedia');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Peramban tidak mendukung akses kamera');
    }

    this.stopCamera();

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(
        this.getConstraints(selectedCameraId),
      );
    } catch (error) {
      throw new Error(getCameraErrorMessage(error));
    }

    this.video.srcObject = this.stream;
    await new Promise((resolve) => {
      if (this.video.readyState >= 1) {
        resolve();
        return;
      }
      this.video.onloadedmetadata = () => resolve();
    });
    await this.video.play();
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
  }

  setFPS(fps) {
    this.config.fps = fps;
    const track = this.stream?.getVideoTracks()[0];
    if (track) {
      track.applyConstraints({ frameRate: { ideal: fps } }).catch(() => {});
    }
  }

  getFrameInterval() {
    return 1000 / this.config.fps;
  }

  isActive() {
    return Boolean(this.stream && this.stream.active);
  }

  isReady() {
    return Boolean(
      this.video && this.video.readyState >= 2 && this.video.videoWidth > 0,
    );
  }
}

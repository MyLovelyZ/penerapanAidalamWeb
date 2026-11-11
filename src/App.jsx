import { useCallback, useEffect, useRef, useState } from 'react';
import Header from './components/Header';
import CameraSection from './components/CameraSection';
import InfoPanel from './components/InfoPanel';
import { useAppState } from './hooks/useAppState';
import { DetectionService } from './services/DetectionService';
import { CameraService } from './services/CameraService';
import { RootFactsService } from './services/RootFactsService';
import { logError } from './utils/common';
import { isValidDetection } from './utils/config';

function App() {
  const { state, actions } = useAppState();
  const detectionCleanupRef = useRef(null);
  const isRunningRef = useRef(false);
  const [currentTone, setCurrentTone] = useState('normal');

  const initStartedRef = useRef(false);
  const servicesRef = useRef({ detector: null, camera: null, generator: null });
  const { setServices, setModelStatus, setError, setRunning, setAppState,
    setDetectionResult, setFunFactData, resetResults } = actions;

  // Inisialisasi layanan deteksi, kamera, dan generator fakta saat aplikasi dimuat
  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;

    const detector = new DetectionService();
    const camera = new CameraService();
    const generator = new RootFactsService();
    servicesRef.current = { detector, camera, generator };
    setServices({ detector, camera, generator });

    const progress = { detector: 0, generator: 0 };
    const showProgress = () => {
      // Model deteksi kecil (bobot 20%), model bahasa lebih besar (bobot 80%).
      const total = Math.round(progress.detector * 0.2 + progress.generator * 0.8);
      setModelStatus(`Menunggu Model... ${total}%`);
    };

    const init = async () => {
      showProgress();
      try {
        await detector.loadModel((value) => {
          progress.detector = value;
          showProgress();
        });
      } catch (error) {
        logError('Gagal memuat model deteksi', error);
        setError('Gagal memuat model deteksi sayuran.');
        setModelStatus('Model AI Gagal');
        return;
      }

      try {
        await generator.loadModel((value) => {
          progress.generator = value;
          showProgress();
        });
      } catch (error) {
        // Deteksi tetap bisa dipakai; fun fact akan menampilkan pesan error.
        logError('Gagal memuat model Generative AI', error);
        setError('Model Generative AI gagal dimuat. Fun fact tidak tersedia.');
      }

      setModelStatus('Model AI Siap');
    };

    init();
  }, [setServices, setModelStatus, setError]);

  // Bersihkan sumber daya saat komponen ditinggalkan
  useEffect(() => () => {
    isRunningRef.current = false;
    detectionCleanupRef.current?.();
    servicesRef.current.camera?.stopCamera();
  }, []);

  const stopScanning = useCallback(() => {
    isRunningRef.current = false;
    detectionCleanupRef.current?.();
    detectionCleanupRef.current = null;
    servicesRef.current.camera?.stopCamera();
    setRunning(false);
  }, [setRunning]);

  const handleDetected = useCallback(async (result) => {
    stopScanning();
    setDetectionResult(result);
    setFunFactData(null);
    setAppState('result');

    try {
      const fact = await servicesRef.current.generator.generateFacts(result.className);
      setFunFactData(fact);
    } catch (error) {
      logError('Gagal menghasilkan fun fact', error);
      setFunFactData('error');
    }
  }, [stopScanning, setDetectionResult, setFunFactData, setAppState]);

  // Loop deteksi dengan pembatasan FPS
  const startDetectionLoop = useCallback(() => {
    const { detector, camera } = servicesRef.current;
    let rafId = null;
    let lastRun = 0;
    let busy = false;

    const tick = async (now) => {
      if (!isRunningRef.current) return;

      if (!busy && camera.isReady() && now - lastRun >= camera.getFrameInterval()) {
        lastRun = now;
        busy = true;
        let valid = null;
        try {
          const result = await detector.predict(camera.video);
          if (isValidDetection(result)) valid = result;
        } catch (error) {
          logError('Prediksi gagal', error);
        }
        busy = false;

        if (valid && isRunningRef.current) {
          handleDetected(valid);
          return;
        }
      }

      if (isRunningRef.current) rafId = requestAnimationFrame(tick);
    };

    detectionCleanupRef.current = () => cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }, [handleDetected]);

  // Memulai dan menghentikan kamera
  const handleToggleCamera = useCallback(async (cameraType) => {
    if (isRunningRef.current) {
      stopScanning();
      setAppState('idle');
      return;
    }

    const { camera } = servicesRef.current;
    resetResults();
    try {
      await camera.startCamera(cameraType);
      isRunningRef.current = true;
      setRunning(true);
      setAppState('analyzing');
      startDetectionLoop();
    } catch (error) {
      logError('Gagal memulai kamera', error);
      camera.stopCamera();
      setError(error.message);
    }
  }, [stopScanning, startDetectionLoop, resetResults, setRunning, setAppState, setError]);

  // Mengubah nada fakta yang dihasilkan
  const handleToneChange = useCallback((tone) => {
    setCurrentTone(tone);
    servicesRef.current.generator?.setTone(tone);
  }, []);

  // Menyalin fakta ke clipboard
  const handleCopyFact = useCallback(async () => {
    if (!state.funFactData || state.funFactData === 'error') return;
    try {
      await navigator.clipboard.writeText(state.funFactData);
    } catch (error) {
      logError('Gagal menyalin fakta', error);
      setError('Gagal menyalin teks ke clipboard.');
    }
  }, [state.funFactData, setError]);

  return (
    <div className="app-container">
      <Header modelStatus={state.modelStatus} />

      <main className="main-content">
        <CameraSection
          isRunning={state.isRunning}
          services={state.services}
          modelStatus={state.modelStatus}
          error={state.error}
          currentTone={currentTone}
          onToggleCamera={handleToggleCamera}
          onToneChange={handleToneChange}
        />

        <InfoPanel
          appState={state.appState}
          detectionResult={state.detectionResult}
          funFactData={state.funFactData}
          error={state.error}
          onCopyFact={handleCopyFact}
        />
      </main>

      <footer className="footer">
        <p>Powered by TensorFlow.js & Transformers.js</p>
      </footer>

      {state.error && (
        <div style={{
          position: 'fixed',
          bottom: '1rem',
          left: '50%',
          transform: 'translateX(-50%)',
          maxWidth: '380px',
          padding: '0.875rem 1rem',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 'var(--radius-md)',
          color: '#991b1b',
          fontSize: '0.8125rem',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          zIndex: 1000
        }}>
          <strong>Error:</strong> {state.error}
          <button
            onClick={() => actions.setError(null)}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: 'none',
              fontSize: '1.25rem',
              cursor: 'pointer',
              color: '#991b1b',
              padding: 0,
              lineHeight: 1
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export default App;

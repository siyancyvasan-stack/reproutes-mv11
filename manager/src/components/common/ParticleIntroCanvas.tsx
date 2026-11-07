import React, { useEffect, useRef } from 'react';

interface ParticleIntroCanvasProps {
  onComplete?: () => void;
  className?: string;
}

export const ParticleIntroCanvas: React.FC<ParticleIntroCanvasProps> = ({ onComplete, className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animFrame = 0;
    let completionTimer = 0;

    const resize = () => {
      canvas.width = canvas.parentElement?.clientWidth || window.innerWidth;
      canvas.height = canvas.parentElement?.clientHeight || window.innerHeight;
    };
    resize();

    const w = canvas.width;
    const h = canvas.height;

    // Create offscreen text canvas to sample points for REPROUTES
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;

    offCtx.fillStyle = '#FFFFFF';
    const fontSize = Math.min(w * 0.12, 100);
    offCtx.font = `900 ${fontSize}px "Plus Jakarta Sans", sans-serif`;
    offCtx.textAlign = 'center';
    offCtx.textBaseline = 'middle';
    offCtx.fillText('REPROUTES', w / 2, h / 2);

    const imgData = offCtx.getImageData(0, 0, w, h);
    const targetPoints: Array<{ x: number; y: number }> = [];

    // Keep the logo crisp while limiting particle work on large/high-DPI
    // displays. The intro should feel premium, not delay access to the app.
    const density = Math.floor(Math.max(6, Math.min(w, h) / 105));
    for (let y = 0; y < h; y += density) {
      for (let x = 0; x < w; x += density) {
        const idx = (y * w + x) * 4;
        if (imgData.data[idx + 3] > 128) {
          targetPoints.push({ x, y });
        }
      }
    }

    // Generate floating particles
    const maxParticles = w < 768 ? 650 : 1400;
    const pointStride = Math.max(1, Math.ceil(targetPoints.length / maxParticles));
    const sampledPoints = targetPoints.filter((_, index) => index % pointStride === 0);
    const particles = sampledPoints.map((tp) => {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * Math.max(w, h) * 0.55;
      return {
        x: w / 2 + Math.cos(angle) * dist,
        y: h / 2 + Math.sin(angle) * dist,
        tx: tp.x,
        ty: tp.y,
        size: Math.random() * 2 + 1.5,
        color: Math.random() > 0.3 ? '#06B6D4' : '#2563EB',
        alpha: Math.random() * 0.5 + 0.5,
      };
    });

    const startTime = Date.now();
    const durationMs = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 1
      : window.matchMedia('(max-width: 767px)').matches
        ? 950
        : 1250;

    const render = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / durationMs);

      // Easing function (cubic easeOut)
      const ease = 1 - Math.pow(1 - progress, 3);

      ctx.fillStyle = '#07111F';
      ctx.fillRect(0, 0, w, h);

      // Subtle cyan grid in background
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.05)';
      ctx.lineWidth = 1;
      const gridSize = 40;
      for (let gx = 0; gx < w; gx += gridSize) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }
      for (let gy = 0; gy < h; gy += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }

      // Draw assembling particles
      particles.forEach((p) => {
        const cx = p.x + (p.tx - p.x) * ease;
        const cy = p.y + (p.ty - p.y) * ease;

        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = progress > 0.8 ? 8 : 2;

        ctx.beginPath();
        ctx.arc(cx, cy, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // Outline effect when almost assembled
      if (progress > 0.6) {
        const glowAlpha = Math.sin((progress - 0.6) * Math.PI * 2.5) * 0.4;
        ctx.font = `900 ${fontSize}px "Plus Jakarta Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = `rgba(6, 182, 212, ${glowAlpha})`;
        ctx.lineWidth = 2;
        ctx.shadowColor = '#06B6D4';
        ctx.shadowBlur = 20;
        ctx.strokeText('REPROUTES', w / 2, h / 2);
        ctx.shadowBlur = 0;
      }

      if (progress < 1) {
        animFrame = requestAnimationFrame(render);
      } else {
        if (onComplete) {
          completionTimer = window.setTimeout(onComplete, 160);
        }
      }
    };

    render();

    return () => {
      cancelAnimationFrame(animFrame);
      window.clearTimeout(completionTimer);
    };
  }, [onComplete]);

  return (
    <div className={`relative w-full h-full ${className}`}>
      <canvas ref={canvasRef} className="w-full h-full block" aria-hidden="true" />
    </div>
  );
};

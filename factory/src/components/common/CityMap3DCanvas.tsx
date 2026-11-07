import React, { useEffect, useRef } from 'react';

interface CityMap3DCanvasProps {
  tiltX?: number;
  tiltY?: number;
  className?: string;
  onTiltChange?: (tiltX: number, tiltY: number) => void;
}

const MAX_PIXEL_RATIO = 2;

export const CityMap3DCanvas: React.FC<CityMap3DCanvasProps> = ({
  tiltX = 0,
  tiltY = 0,
  className = '',
  onTiltChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tiltRef = useRef({ x: tiltX, y: tiltY });
  const pointerRef = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    tiltRef.current = { x: tiltX, y: tiltY };
  }, [tiltX, tiltY]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId = 0;
    let time = 0;
    let cssWidth = 0;
    let cssHeight = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const nextWidth = Math.round(rect.width);
      const nextHeight = Math.round(rect.height);
      if (!nextWidth || !nextHeight || (nextWidth === cssWidth && nextHeight === cssHeight)) return;
      cssWidth = nextWidth;
      cssHeight = nextHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      canvas.width = Math.round(cssWidth * ratio);
      canvas.height = Math.round(cssHeight * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    // City grid configuration
    const gridCols = 10;
    const gridRows = 8;
    const cellWidth = 70;
    const cellHeight = 50;

    const pins = [
      { col: 2, row: 3, label: 'Kumar (Active)', color: '#06B6D4' },
      { col: 5, row: 2, label: 'Sanjay (Active)', color: '#10B981' },
      { col: 7, row: 5, label: 'Nimal (Break)', color: '#F59E0B' },
      { col: 3, row: 6, label: 'Kamal (Active)', color: '#2563EB' },
    ];

    const render = () => {
      if (document.hidden) return;
      time += 0.02;
      const w = cssWidth;
      const h = cssHeight;
      if (!w || !h) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      ctx.clearRect(0, 0, w, h);

      // Dark background with gradient spotlight
      const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, w * 0.8);
      bgGrad.addColorStop(0, '#0B1F3A');
      bgGrad.addColorStop(0.6, '#07111F');
      bgGrad.addColorStop(1, '#030811');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      // Apply 3D Perspective Transformation
      ctx.translate(w / 2 + tiltRef.current.y * 12, h / 2 - 20 + tiltRef.current.x * 10);
      
      // Isometric skewing matrix
      ctx.transform(1, -0.2, 0.4, 0.6, 0, 0);

      const startX = -(gridCols * cellWidth) / 2;
      const startY = -(gridRows * cellHeight) / 2;

      // Draw Grid Streets
      ctx.lineWidth = 1;
      for (let c = 0; c <= gridCols; c++) {
        const x = startX + c * cellWidth;
        ctx.strokeStyle = c % 2 === 0 ? 'rgba(6, 182, 212, 0.25)' : 'rgba(255, 255, 255, 0.05)';
        ctx.beginPath();
        ctx.moveTo(x, startY);
        ctx.lineTo(x, startY + gridRows * cellHeight);
        ctx.stroke();
      }

      for (let r = 0; r <= gridRows; r++) {
        const y = startY + r * cellHeight;
        ctx.strokeStyle = r % 2 === 0 ? 'rgba(37, 99, 235, 0.25)' : 'rgba(255, 255, 255, 0.05)';
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(startX + gridCols * cellWidth, y);
        ctx.stroke();
      }

      // Draw 3D City Building Blocks
      for (let c = 0; c < gridCols; c++) {
        for (let r = 0; r < gridRows; r++) {
          // Leave roads empty
          if (c % 2 === 0 || r % 2 === 0) continue;

          const bx = startX + c * cellWidth + 6;
          const by = startY + r * cellHeight + 6;
          const bw = cellWidth - 12;
          const bh = cellHeight - 12;

          // Pseudo-random building height
          const seed = (c * 17 + r * 31) % 5;
          const height = 15 + seed * 12 + Math.sin(time + c) * 3;

          // Building top face
          ctx.fillStyle = 'rgba(15, 30, 55, 0.8)';
          ctx.strokeStyle = 'rgba(6, 182, 212, 0.3)';
          ctx.lineWidth = 1;
          
          ctx.beginPath();
          ctx.rect(bx - height * 0.2, by - height * 0.4, bw, bh);
          ctx.fill();
          ctx.stroke();

          // Building side shadow
          ctx.fillStyle = 'rgba(7, 17, 31, 0.9)';
          ctx.beginPath();
          ctx.moveTo(bx - height * 0.2, by - height * 0.4 + bh);
          ctx.lineTo(bx, by + bh);
          ctx.lineTo(bx + bw, by + bh);
          ctx.lineTo(bx - height * 0.2 + bw, by - height * 0.4 + bh);
          ctx.closePath();
          ctx.fill();
        }
      }

      // Animated Glowing Active Route Path
      const routePoints = [
        { x: startX + 1 * cellWidth, y: startY + 1 * cellHeight },
        { x: startX + 1 * cellWidth, y: startY + 3 * cellHeight },
        { x: startX + 5 * cellWidth, y: startY + 3 * cellHeight },
        { x: startX + 5 * cellWidth, y: startY + 6 * cellHeight },
        { x: startX + 8 * cellWidth, y: startY + 6 * cellHeight },
      ];

      ctx.beginPath();
      ctx.moveTo(routePoints[0].x, routePoints[0].y);
      for (let i = 1; i < routePoints.length; i++) {
        ctx.lineTo(routePoints[i].x, routePoints[i].y);
      }
      ctx.strokeStyle = '#06B6D4';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#06B6D4';
      ctx.shadowBlur = 15;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Animated vehicle pulse moving along route
      const totalSeg = routePoints.length - 1;
      const progress = (time * 0.8) % totalSeg;
      const segIndex = Math.floor(progress);
      const segRatio = progress - segIndex;

      const p1 = routePoints[segIndex];
      const p2 = routePoints[segIndex + 1];
      if (p1 && p2) {
        const vx = p1.x + (p2.x - p1.x) * segRatio;
        const vy = p1.y + (p2.y - p1.y) * segRatio;

        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = '#06B6D4';
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(vx, vy, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Render 3D Location Pins with radar pulse
      pins.forEach((pin) => {
        const px = startX + pin.col * cellWidth;
        const py = startY + pin.row * cellHeight;

        // Pulse wave
        const pulse = (time * 2 + pin.col) % 2;
        ctx.beginPath();
        ctx.arc(px, py, 8 + pulse * 12, 0, Math.PI * 2);
        ctx.strokeStyle = pin.color;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = Math.max(0, 1 - pulse / 2);
        ctx.stroke();
        ctx.globalAlpha = 1.0;

        // Pin stem & head
        ctx.fillStyle = pin.color;
        ctx.shadowColor = pin.color;
        ctx.shadowBlur = 12;

        ctx.beginPath();
        ctx.arc(px, py - 18, 7, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(px, py - 12);
        ctx.lineTo(px - 4, py - 18);
        ctx.lineTo(px + 4, py - 18);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;

        // White core dot
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(px, py - 18, 2.5, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.restore();

      if (!reducedMotion) animationFrameId = requestAnimationFrame(render);
    };

    render();

    const handleVisibilityChange = () => {
      if (!document.hidden && !reducedMotion) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = requestAnimationFrame(render);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch' || !onTiltChange) return;
    pointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerRef.current;
    if (!start || start.id !== event.pointerId || !onTiltChange) return;
    const rotateY = Math.max(-7, Math.min(7, (event.clientX - start.x) / 14));
    const rotateX = Math.max(-6, Math.min(6, -(event.clientY - start.y) / 18));
    onTiltChange(rotateX, rotateY);
  };

  const releasePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerRef.current?.id !== event.pointerId) return;
    pointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onTiltChange?.(0, 0);
  };

  return (
    <div
      className={`relative w-full h-full overflow-hidden touch-pan-y ${className}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={releasePointer}
      onPointerCancel={releasePointer}
      aria-label="Interactive 3D live sales map"
      role="img"
    >
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
};

import React, { useRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface SparklesProps {
  id?: string;
  background?: string;
  minSize?: number;
  maxSize?: number;
  particleDensity?: number;
  className?: string;
  particleColor?: string;
  speed?: number;
}

export const SparklesCore = ({
  id = "sparkles",
  background = "transparent",
  minSize = 0.6,
  maxSize = 1.5,
  particleDensity = 120,
  className,
  particleColor = "#FFF",
  speed = 1,
}: SparklesProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [context, setContext] = useState<CanvasRenderingContext2D | null>(null);
  const particles = useRef<any[]>([]);

  useEffect(() => {
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      setContext(ctx);
    }
  }, []);

  useEffect(() => {
    if (!context || !canvasRef.current) return;

    const canvas = canvasRef.current;
    let animationFrameId: number;

    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      } else {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }
      initParticles();
    };

    const initParticles = () => {
      particles.current = [];
      const count = Math.floor(((canvas.width * canvas.height) / (10000 / particleDensity)) * 0.1);
      for (let i = 0; i < (count || 40); i++) {
        particles.current.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: Math.random() * (maxSize - minSize) + minSize,
          speedX: (Math.random() - 0.5) * speed * 0.3,
          speedY: (Math.random() - 0.5) * speed * 0.3,
          opacity: Math.random(),
          opacitySpeed: 0.005 + Math.random() * 0.01,
        });
      }
    };

    const draw = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);

      particles.current.forEach((p) => {
        p.x += p.speedX;
        p.y += p.speedY;

        if (p.x < 0 || p.x > canvas.width) p.speedX *= -1;
        if (p.y < 0 || p.y > canvas.height) p.speedY *= -1;

        p.opacity += p.opacitySpeed;
        if (p.opacity > 1 || p.opacity < 0.1) {
          p.opacitySpeed *= -1;
        }

        context.beginPath();
        context.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        context.fillStyle = `rgba(${hexToRgb(particleColor)}, ${p.opacity})`;
        context.fill();
      });

      animationFrameId = requestAnimationFrame(draw);
    };

    resizeCanvas();
    draw();

    window.addEventListener("resize", resizeCanvas);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [context, particleDensity, minSize, maxSize, particleColor, speed]);

  const hexToRgb = (hex: string) => {
    let r = 255,
      g = 255,
      b = 255;
    const cleanHex = hex.replace("#", "");
    if (cleanHex.length === 3) {
      r = parseInt(cleanHex[0] + cleanHex[0], 16);
      g = parseInt(cleanHex[1] + cleanHex[1], 16);
      b = parseInt(cleanHex[2] + cleanHex[2], 16);
    } else if (cleanHex.length === 6) {
      r = parseInt(cleanHex.slice(0, 2), 16);
      g = parseInt(cleanHex.slice(2, 4), 16);
      b = parseInt(cleanHex.slice(4, 6), 16);
    }
    return `${r}, ${g}, ${b}`;
  };

  return (
    <canvas
      ref={canvasRef}
      id={id}
      className={cn("pointer-events-none absolute inset-0 h-full w-full", className)}
    />
  );
};

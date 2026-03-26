import { useEffect, useRef } from 'react';

interface DotLottieLoaderProps {
  className?: string;
  size?: number;
}

export default function DotLottieLoader({ className = "", size = 100 }: DotLottieLoaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Validate size is a positive number to prevent injection
    const validatedSize = typeof size === 'number' && size > 0 && size <= 2000 && Number.isFinite(size) 
      ? Math.floor(size) 
      : 100;

    // Load the dotlottie-wc script if not already loaded
    if (!document.querySelector('script[src*="dotlottie-wc"]')) {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/@lottiefiles/dotlottie-wc@0.8.1/dist/dotlottie-wc.js';
      script.type = 'module';
      document.head.appendChild(script);
    }

    // Create the dotlottie element using DOM methods instead of innerHTML
    if (containerRef.current) {
      // Clear existing content safely
      containerRef.current.textContent = '';
      
      const dotlottieElement = document.createElement('dotlottie-wc');
      dotlottieElement.setAttribute('src', 'https://lottie.host/80b5bd1a-bb00-4ea6-b321-f13311c6bb04/Ty4VAFal7W.lottie');
      dotlottieElement.style.width = `${validatedSize}px`;
      dotlottieElement.style.height = `${validatedSize}px`;
      dotlottieElement.setAttribute('autoplay', '');
      dotlottieElement.setAttribute('loop', '');
      
      containerRef.current.appendChild(dotlottieElement);
    }
  }, [size]);

  return (
    <div 
      ref={containerRef} 
      className={`flex items-center justify-center ${className}`}
    />
  );
}
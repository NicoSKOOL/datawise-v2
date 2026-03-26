import { useEffect, useState } from 'react';
import Lottie from 'lottie-react';

interface LoadingAnimationProps {
  className?: string;
}

export default function LoadingAnimation({ className = "w-5 h-5" }: LoadingAnimationProps) {
  const [animationData, setAnimationData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadAnimation = async () => {
      try {
        // Try to load the Lottie file
        const response = await fetch('/loading.lottie');
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          
          // Try to parse if it's JSON
          try {
            const text = new TextDecoder().decode(arrayBuffer);
            const jsonData = JSON.parse(text);
            setAnimationData(jsonData);
          } catch {
            // If not JSON, it might be a dotLottie file
            // For now, fall back to CSS animation
            setAnimationData(null);
          }
        }
      } catch (error) {
        console.error('Failed to load animation:', error);
        setAnimationData(null);
      } finally {
        setLoading(false);
      }
    };

    loadAnimation();
  }, []);

  if (loading) {
    return <div className={`${className} border-2 border-primary/30 border-t-primary rounded-full animate-spin`} />;
  }

  if (animationData) {
    return (
      <Lottie 
        animationData={animationData}
        loop={true}
        className={className}
      />
    );
  }

  // Fallback: Custom CSS animation that looks professional
  return (
    <div className={`${className} relative`}>
      <div className="absolute inset-0 rounded-full border-2 border-primary/20"></div>
      <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin"></div>
      <div className="absolute inset-1 rounded-full border-2 border-transparent border-t-primary/60 animate-spin" style={{animationDuration: '0.8s', animationDirection: 'reverse'}}></div>
    </div>
  );
}
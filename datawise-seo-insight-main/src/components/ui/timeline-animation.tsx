import { motion, useInView, type Variants } from "motion/react";
import { type RefObject, type ReactNode } from "react";

interface TimelineContentProps {
  children: ReactNode;
  animationNum: number;
  timelineRef: RefObject<HTMLElement>;
  className?: string;
  as?: keyof JSX.IntrinsicElements;
  customVariants?: Variants;
}

export const TimelineContent = ({
  children,
  animationNum,
  timelineRef,
  className = "",
  as: Component = "div",
  customVariants,
}: TimelineContentProps) => {
  const isInView = useInView(timelineRef, { once: true, amount: 0.3 });

  const defaultVariants: Variants = {
    visible: (i: number) => ({
      y: 0,
      opacity: 1,
      transition: {
        delay: i * 0.2,
        duration: 0.5,
      },
    }),
    hidden: {
      y: 20,
      opacity: 0,
    },
  };

  const variants: Variants = customVariants || defaultVariants;

  return (
    <motion.div
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      custom={animationNum}
      variants={variants}
      className={className}
    >
      {Component === "div" ? children : <Component className={className}>{children}</Component>}
    </motion.div>
  );
};

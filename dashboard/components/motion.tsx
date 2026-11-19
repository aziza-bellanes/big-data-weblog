"use client";

// Small, restrained animation primitives. All of them honour "reduce motion" through the
// MotionConfig in the root layout.
import { animate, motion, MotionConfig, useMotionValue, useTransform } from "motion/react";
import { useEffect, type ReactNode } from "react";

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

const EASE = [0.22, 1, 0.36, 1] as const;

/** Children rise into place one after another. */
export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 10 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
      }}
    >
      {children}
    </motion.div>
  );
}

/** A number that glides to each new value instead of jumping. */
export function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const current = useMotionValue(value);
  const text = useTransform(current, (n) => format(n));
  useEffect(() => {
    const controls = animate(current, value, { duration: 0.9, ease: EASE });
    return () => controls.stop();
  }, [current, value]);
  return <motion.span>{text}</motion.span>;
}

/** Dots travelling along a connector while data flows through it. */
export function FlowDots({ active, vertical = false }: { active: boolean; vertical?: boolean }) {
  if (!active) return null;
  const axis = vertical ? "top" : "left";
  return (
    <span className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {[0, 0.5].map((delay) => (
        <motion.span
          key={delay}
          className="absolute size-1.5 rounded-full bg-primary"
          style={vertical ? { left: "calc(50% - 3px)" } : { top: "calc(50% - 3px)" }}
          initial={{ [axis]: "-10%", opacity: 0 }}
          animate={{ [axis]: "110%", opacity: [0, 1, 1, 0] }}
          transition={{ duration: 1.1, delay, repeat: Infinity, ease: "linear" }}
        />
      ))}
    </span>
  );
}

// =========================================================
// Спільний каркас модалки: оверлей + Esc + блокування скролу body + клік
// по оверлею. Якщо onClose не передано — модалка "обов'язкова" (перший
// вхід без ніка): Esc/клік поза вікном її не закривають.
// App не рендерить дві модалки одночасно, тож простий scroll-lock без
// лічильника вкладеності достатній.
// =========================================================

import { useEffect, useRef, type ReactNode } from 'react';

/** Стек відкритих модалок: Esc закриває лише ВЕРХНЮ (напр. розгорнутий
 * графік поверх фінального екрана), а не всі одразу. */
const modalStack: symbol[] = [];

export default function Modal({
  onClose,
  width,
  className,
  children,
}: {
  onClose?: () => void;
  /** Макс. ширина вікна в px (рендериться як min(width, 100%)). */
  width?: number;
  className?: string;
  children: ReactNode;
}) {
  const idRef = useRef<symbol | null>(null);
  if (!idRef.current) idRef.current = Symbol('modal');

  useEffect(() => {
    const id = idRef.current!;
    modalStack.push(id);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose && modalStack[modalStack.length - 1] === id) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      const i = modalStack.indexOf(id);
      if (i >= 0) modalStack.splice(i, 1);
      document.body.style.overflow = modalStack.length > 0 ? 'hidden' : prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div
        className={'modal' + (className ? ' ' + className : '')}
        role="dialog"
        aria-modal="true"
        style={width ? { width: `min(${width}px, 100%)` } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

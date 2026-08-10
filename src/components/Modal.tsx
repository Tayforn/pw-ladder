// =========================================================
// Спільний каркас модалки: оверлей + Esc + блокування скролу body + клік
// по оверлею. Якщо onClose не передано — модалка "обов'язкова" (перший
// вхід без ніка): Esc/клік поза вікном її не закривають.
// App не рендерить дві модалки одночасно, тож простий scroll-lock без
// лічильника вкладеності достатній.
// =========================================================

import { useEffect, type ReactNode } from 'react';

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
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
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

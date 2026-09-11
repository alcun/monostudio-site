import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface LightboxDetail {
  src: string;
  alt: string;
  thumb?: string;
  w?: number;
  h?: number;
}

export default function Lightbox() {
  const [photo, setPhoto] = useState<LightboxDetail | null>(null);
  const [closing, setClosing] = useState(false);
  const close = useCallback(() => setClosing(true), []);

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<LightboxDetail>).detail;
      if (!detail) return;
      setPhoto(detail);
      setClosing(false);
    };
    window.addEventListener('lightbox:open', open as EventListener);
    return () => window.removeEventListener('lightbox:open', open as EventListener);
  }, []);

  useEffect(() => {
    if (!photo) return;
    const keydown = (event: KeyboardEvent) => event.key === 'Escape' && close();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', keydown);
    };
  }, [photo, close]);

  if (!photo) return null;

  return createPortal(
    <div
      className={`lightbox${closing ? ' closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={photo.alt}
      onClick={close}
      onAnimationEnd={(event) => {
        if (closing && event.target === event.currentTarget) {
          setPhoto(null);
          setClosing(false);
        }
      }}
    >
      <img
        src={photo.src}
        alt={photo.alt}
        width={photo.w}
        height={photo.h}
        className="lightbox-img"
        onClick={(event) => event.stopPropagation()}
      />
      <button type="button" className="lightbox-close" onClick={close} aria-label="Close preview">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </button>
    </div>,
    document.body,
  );
}
